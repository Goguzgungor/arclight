import type pg from 'pg';
import type { Logger } from 'pino';
import type { PublicClient } from 'viem';
import {
  buildControlTables, buildEventTable, decodeLogToRow, planRange,
  type DecodedRow, type EventDef, type RawLog, type WorkerConfig,
} from '@arclight/core';
import { bootstrap, commitBatch, getCursor, initCursor, type DeadLetterEntry } from './db.js';
import { fetchLogs, getBlockTimes, getFinalizedBlockNumber } from './rpc.js';
import type { Metrics } from './metrics.js';
import type { PhaseTracker } from './status.js';

export interface PipelineDeps {
  client: PublicClient;
  pool: pg.Pool;
  cfg: WorkerConfig;
  defs: EventDef[];
  schema: string;
  metrics: Metrics;
  phase: PhaseTracker;
  log: Logger;
}

export async function bootstrapIndexer(deps: PipelineDeps): Promise<void> {
  const tables = deps.defs.map((d) => buildEventTable(deps.schema, d));
  await bootstrap(deps.pool, buildControlTables(deps.schema), tables);
  const minStart = deps.cfg.contracts.reduce(
    (min, c) => (BigInt(c.startBlock) < min ? BigInt(c.startBlock) : min),
    BigInt(deps.cfg.contracts[0]!.startBlock),
  );
  await initCursor(deps.pool, deps.schema, minStart - 1n);
}

export async function runOnce(deps: PipelineDeps): Promise<boolean> {
  const { client, pool, cfg, defs, schema, metrics, phase } = deps;
  const finalized = await getFinalizedBlockNumber(client, cfg.network.finalityTag);
  const cursor = await getCursor(pool, schema);
  if (cursor === null) throw new Error('cursor yok — önce bootstrapIndexer çağrılmalı');
  metrics.blocksBehind.set(Number(finalized - cursor));
  phase.setBlocks(cursor, finalized);

  const range = planRange(cursor, finalized, cfg.polling.batchBlocks);
  if (!range) {
    phase.set('Live');
    return false;
  }
  phase.set('Backfilling');

  const byKey = new Map(defs.map((d) => [`${d.address}:${d.topic0}`, d]));
  const startBlocks = new Map(cfg.contracts.map((c) => [c.address.toLowerCase(), BigInt(c.startBlock)]));
  const addresses = [...new Set(defs.map((d) => d.address))];

  const logs = await fetchLogs(client, addresses, range.fromBlock, range.toBlock);
  const times = await getBlockTimes(client, logs.map((l) => l.blockNumber!));

  const rows: DecodedRow[] = [];
  const dead: DeadLetterEntry[] = [];
  for (const log of logs) {
    const address = log.address.toLowerCase() as `0x${string}`;
    const def = byKey.get(`${address}:${log.topics[0]}`);
    if (!def) continue; // izlenmeyen event
    if (log.blockNumber! < (startBlocks.get(address) ?? 0n)) continue;
    try {
      rows.push(decodeLogToRow(def, log as unknown as RawLog, times.get(log.blockNumber!)!));
    } catch (err) {
      dead.push({
        blockNumber: log.blockNumber, txHash: log.transactionHash,
        logIndex: log.logIndex, address,
        topics: [...log.topics], data: log.data,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const end = deps.metrics.writeLatency.startTimer();
  const inserted = await commitBatch(pool, schema, rows, dead, range.toBlock);
  end();

  metrics.eventsIngested.inc(inserted);
  metrics.deadLetters.inc(dead.length);
  metrics.lastProcessedBlock.set(Number(range.toBlock));
  metrics.blocksBehind.set(Number(finalized - range.toBlock));
  phase.setBlocks(range.toBlock, finalized);
  if (range.toBlock === finalized) phase.set('Live');
  deps.log.info(
    { fromBlock: range.fromBlock, toBlock: range.toBlock, inserted, dead: dead.length },
    'aralık işlendi',
  );
  return true;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

export async function runLoop(deps: PipelineDeps, signal: AbortSignal): Promise<void> {
  let backoffMs = 1000;
  while (!signal.aborted) {
    try {
      const progressed = await runOnce(deps);
      backoffMs = 1000;
      if (!progressed) await sleep(deps.cfg.polling.intervalMs, signal);
    } catch (err) {
      deps.metrics.rpcErrors.inc();
      deps.phase.set('Degraded', err instanceof Error ? err.message : String(err));
      deps.log.error({ err }, 'pipeline hatası — backoff ile yeniden denenecek');
      await sleep(backoffMs, signal);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    }
  }
}
