// Scenario 3 — Burst: the ceiling of the decode+SQL write path on local anvil.
// Automine is turned off and N events are seeded into a few dense blocks; the
// worker is cold-started and the time to reach Live is measured.
import pg from 'pg';
import {
  ANVIL_CHAIN_ID, ANVIL_URL, currentNonce, deployEmitter, mine, rpcCall,
  sendPings, setAutomine, setIntervalMining,
} from './anvil.ts';
import { rate } from './stats.ts';
import { healthz, metricValue, spawnWorker, stopWorker, waitFor, writeWorkerFiles } from './worker-proc.ts';

const PORT = 9303;
const TARGET_EVENTS = Number(process.env['BENCH_BURST_EVENTS'] ?? 2000);
const PER_BLOCK = Number(process.env['BENCH_BURST_PER_BLOCK'] ?? 250);

const EMITTER_ABI_EVENTS = ['Ping'];

export interface BurstResult {
  kind: 'burst';
  network: 'local';
  seededEvents: number;
  seededBlocks: number;
  seedDurationMs: number;
  ingestedEvents: number;
  ingestDurationMs: number;
  eventsPerSec: number;
  avgWriteLatencyMs: number | null;
}

export async function run(databaseUrl: string): Promise<BurstResult> {
  try {
    await rpcCall('eth_chainId');
  } catch {
    throw new Error(
      `local anvil unreachable (${ANVIL_URL}) — run: docker compose -f docker-compose.dev.yml up -d postgres anvil`,
    );
  }

  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query('DROP SCHEMA IF EXISTS idx_bench_burst CASCADE');

  const seedT0 = performance.now();
  const emitter = await deployEmitter();
  await setAutomine(false);
  await setIntervalMining(0);
  let seeded = 0;
  let blocks = 0;
  try {
    let nonce = await currentNonce(emitter);
    while (seeded < TARGET_EVENTS) {
      const n = Math.min(PER_BLOCK, TARGET_EVENTS - seeded);
      nonce = await sendPings(emitter, seeded + 1, n, nonce);
      await mine(1);
      seeded += n;
      blocks += 1;
    }
  } finally {
    await setAutomine(true); // leave anvil close to the mode we found it in
    await setIntervalMining(1);
  }
  const seedDurationMs = Math.round(performance.now() - seedT0);

  const configPath = writeWorkerFiles('burst', { 'emitter-abi.json': emitter.abi }, (dir) => ({
    indexerName: 'bench-burst',
    network: { chainId: ANVIL_CHAIN_ID, rpc: [ANVIL_URL], finalityTag: 'latest' },
    contracts: [
      {
        name: 'emitter', address: emitter.address, abiPath: `${dir}/emitter-abi.json`,
        startBlock: Number(emitter.deployBlock), events: EMITTER_ABI_EVENTS,
      },
    ],
    polling: { batchBlocks: 1000, intervalMs: 500 },
  }));

  const worker = spawnWorker(configPath, databaseUrl, PORT);
  const t0 = performance.now();
  try {
    await waitFor(
      'burst reached Live',
      async () => {
        const h = await healthz(PORT);
        if (h?.phase === 'Degraded') throw new Error(`worker Degraded: ${h.lastError ?? '?'}`);
        if (h?.phase !== 'Live') return false;
        const r = await db.query('SELECT count(*)::int AS n FROM idx_bench_burst.emitter_ping');
        return Number(r.rows[0]!.n) >= seeded;
      },
      10 * 60_000,
      250,
    );
    const ingestDurationMs = Math.round(performance.now() - t0);

    const count = await db.query('SELECT count(*)::int AS n FROM idx_bench_burst.emitter_ping');
    const ingested = Number(count.rows[0]!.n);
    const wSum = await metricValue(PORT, 'arclight_write_latency_seconds_sum');
    const wCount = await metricValue(PORT, 'arclight_write_latency_seconds_count');
    return {
      kind: 'burst',
      network: 'local',
      seededEvents: seeded,
      seededBlocks: blocks,
      seedDurationMs,
      ingestedEvents: ingested,
      ingestDurationMs,
      eventsPerSec: Math.round(rate(ingested, ingestDurationMs)),
      avgWriteLatencyMs:
        wSum !== null && wCount !== null && wCount > 0 ? Math.round((wSum / wCount) * 1000) : null,
    };
  } finally {
    await stopWorker(worker);
    await db.end();
  }
}
