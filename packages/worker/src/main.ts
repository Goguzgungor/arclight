import { readFileSync } from 'node:fs';
import pg from 'pg';
import { pino } from 'pino';
import {
  extractEventDefs, parseWorkerConfig, schemaName, type EventDef,
} from '@arckive/core';
import { createMetrics } from './metrics.js';
import { bootstrapIndexer, runLoop, type PipelineDeps } from './pipeline.js';
import { createRpc, filterHealthyRpcs, splitRpcUrls } from './rpc.js';
import { startHealthServer } from './health.js';
import { HeadSignal } from './signal.js';
import { PhaseTracker } from './status.js';
import { subscribeNewHeads } from './ws.js';
import { crStatusTargetFromEnv, startCrStatusLoop, type CrStatusTarget } from './crstatus.js';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

async function main(): Promise<void> {
  const dsn = process.env['DATABASE_URL'];
  if (!dsn) throw new Error('DATABASE_URL is required');
  const configPath = process.env['CONFIG_PATH'] ?? '/etc/arckive/config.json';
  const cfg = parseWorkerConfig(JSON.parse(readFileSync(configPath, 'utf8')));

  const metrics = createMetrics(cfg.indexerName);
  const phase = new PhaseTracker();
  const healthPort = Number(process.env['HEALTH_PORT'] ?? 9090);
  const server = startHealthServer(metrics, phase, healthPort);

  const defs: EventDef[] = cfg.contracts.flatMap((c) => {
    const abi = JSON.parse(readFileSync(c.abiPath, 'utf8')) as unknown;
    return extractEventDefs(c.name, c.address, abi, c.events.length ? c.events : undefined);
  });

  // Endpoints with a mismatched chainId or that are dead drop out of the pool;
  // if none remain, go Degraded and wait-retry
  let rpcs = await filterHealthyRpcs(cfg.network.rpc, cfg.network.chainId);
  while (rpcs.length === 0) {
    phase.set('Degraded', `no RPC endpoint matched chainId ${cfg.network.chainId}`);
    log.error({ rpc: cfg.network.rpc }, 'no healthy RPC — retrying in 30 s');
    await new Promise((r) => setTimeout(r, 30_000));
    rpcs = await filterHealthyRpcs(cfg.network.rpc, cfg.network.chainId);
  }

  const pool = new pg.Pool({ connectionString: dsn });
  const headSignal = new HeadSignal();
  const deps: PipelineDeps = {
    client: createRpc(rpcs),
    pool,
    cfg,
    defs,
    schema: schemaName(cfg.indexerName),
    metrics,
    phase,
    headSignal,
    log,
  };
  await bootstrapIndexer(deps);

  // When a ws endpoint exists, the newHeads subscription wakes the pipeline
  // immediately; polling intervalMs remains as a safety net. announceRpc
  // endpoints only listen (they never join the query pool) and, being at the
  // front of the list, are the primary signal source.
  const { ws: wsUrls } = splitRpcUrls(rpcs);
  const announceUrls = [...new Set([...cfg.network.announceRpc, ...wsUrls])];
  const subscription = announceUrls.length
    ? subscribeNewHeads({
        wsUrls: announceUrls,
        onHead: (head, primary) => {
          metrics.headNotifications.inc();
          headSignal.notify(head ?? undefined, primary);
        },
        onStateChange: (connected) => metrics.wsConnected.set(connected ? 1 : 0),
        log,
      })
    : null;
  if (!announceUrls.length) log.info('no ws RPC endpoint — polling-only mode');
  let crTarget: CrStatusTarget | null = null;
  try {
    crTarget = crStatusTargetFromEnv();
  } catch (err) {
    log.warn({ err }, 'could not set up CR status target — status patching disabled');
  }
  const stopCrStatus = crTarget ? startCrStatusLoop(crTarget, phase, log) : (): void => {};
  if (crTarget) log.info({ cr: `${crTarget.namespace}/${crTarget.name}` }, 'CR status patching enabled');
  log.info({ indexer: cfg.indexerName, schema: deps.schema, rpcs }, 'arckive worker started');

  const ctrl = new AbortController();
  const shutdown = () => {
    log.info('shutdown signal received');
    ctrl.abort();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await runLoop(deps, ctrl.signal);
  subscription?.close();
  stopCrStatus();
  server.close();
  await pool.end();
}

main().catch((err: unknown) => {
  log.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
