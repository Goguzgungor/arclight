import { readFileSync } from 'node:fs';
import pg from 'pg';
import { pino } from 'pino';
import {
  extractEventDefs, parseWorkerConfig, schemaName, type EventDef,
} from '@arclight/core';
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
  if (!dsn) throw new Error('DATABASE_URL zorunlu');
  const configPath = process.env['CONFIG_PATH'] ?? '/etc/arclight/config.json';
  const cfg = parseWorkerConfig(JSON.parse(readFileSync(configPath, 'utf8')));

  const metrics = createMetrics(cfg.indexerName);
  const phase = new PhaseTracker();
  const healthPort = Number(process.env['HEALTH_PORT'] ?? 9090);
  const server = startHealthServer(metrics, phase, healthPort);

  const defs: EventDef[] = cfg.contracts.flatMap((c) => {
    const abi = JSON.parse(readFileSync(c.abiPath, 'utf8')) as unknown;
    return extractEventDefs(c.name, c.address, abi, c.events.length ? c.events : undefined);
  });

  // chainId uyuşmayan/ölü uçlar havuzdan düşer; hiçbiri kalmazsa Degraded bekle-yeniden-dene
  let rpcs = await filterHealthyRpcs(cfg.network.rpc, cfg.network.chainId);
  while (rpcs.length === 0) {
    phase.set('Degraded', `hiçbir RPC ucu chainId ${cfg.network.chainId} ile eşleşmedi`);
    log.error({ rpc: cfg.network.rpc }, 'sağlıklı RPC yok — 30 sn sonra yeniden denenecek');
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

  // ws ucu varsa newHeads aboneliği pipeline'ı anında uyandırır;
  // polling intervalMs güvenlik ağı olarak kalır
  const { ws: wsUrls } = splitRpcUrls(rpcs);
  const subscription = wsUrls.length
    ? subscribeNewHeads({
        wsUrls,
        onHead: (head, primary) => {
          metrics.headNotifications.inc();
          headSignal.notify(head ?? undefined, primary);
        },
        onStateChange: (connected) => metrics.wsConnected.set(connected ? 1 : 0),
        log,
      })
    : null;
  if (!wsUrls.length) log.info('ws RPC ucu yok — salt polling modu');
  let crTarget: CrStatusTarget | null = null;
  try {
    crTarget = crStatusTargetFromEnv();
  } catch (err) {
    log.warn({ err }, 'CR status hedefi kurulamadı — status patch kapalı');
  }
  const stopCrStatus = crTarget ? startCrStatusLoop(crTarget, phase, log) : (): void => {};
  if (crTarget) log.info({ cr: `${crTarget.namespace}/${crTarget.name}` }, 'CR status patch açık');
  log.info({ indexer: cfg.indexerName, schema: deps.schema, rpcs }, 'arclight worker başladı');

  const ctrl = new AbortController();
  const shutdown = () => {
    log.info('kapanma sinyali alındı');
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
  log.fatal({ err }, 'worker başlatılamadı');
  process.exit(1);
});
