import { createServer } from 'node:http';
import { pino } from 'pino';
import { K8s } from 'kubernetes-fluent-client';
import { WatchPhase } from 'kubernetes-fluent-client/dist/fluent/shared-types.js';
import { Indexer } from './kinds.js';
import { createKubeApi } from './kube.js';
import { reconcile, type ReconcileDeps } from './reconcile.js';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

async function main(): Promise<void> {
  const workerImage = process.env['WORKER_IMAGE'];
  if (!workerImage) throw new Error('WORKER_IMAGE is required');
  const resyncMs = Number(process.env['RESYNC_INTERVAL_MS'] ?? 300_000);
  const healthPort = Number(process.env['HEALTH_PORT'] ?? 8080);

  const deps: ReconcileDeps = { kube: createKubeApi(), workerImage, log };

  const safeReconcile = async (cr: Indexer): Promise<void> => {
    try {
      await reconcile(deps, cr);
    } catch (err) {
      log.error({ err, indexer: cr.metadata?.name }, 'reconcile error');
    }
  };

  const health = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.end('ok');
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  health.listen(healthPort);

  // cleanup of deleted CRs is handled by ownerReferences + GC; nothing to do on Deleted
  const watcher = K8s(Indexer).Watch((cr, phase) => {
    if (phase === WatchPhase.Deleted) return;
    void safeReconcile(cr);
  });
  await watcher.start();

  const resync = setInterval(() => {
    deps.kube
      .listIndexers()
      .then(async (crs) => {
        for (const cr of crs) await safeReconcile(cr);
      })
      .catch((err: unknown) => log.error({ err }, 'resync error'));
  }, resyncMs);

  const shutdown = (): void => {
    log.info('shutdown signal received');
    clearInterval(resync);
    watcher.close();
    health.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  log.info({ workerImage, resyncMs }, 'arckive operator started');
}

main().catch((err: unknown) => {
  log.fatal({ err }, 'operator failed to start');
  process.exit(1);
});
