import { createServer } from 'node:http';
import { pino } from 'pino';
import { K8s, WatchPhase } from 'kubernetes-fluent-client';
import { Indexer } from './kinds.js';
import { createKubeApi } from './kube.js';
import { reconcile, type ReconcileDeps } from './reconcile.js';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

async function main(): Promise<void> {
  const workerImage = process.env['WORKER_IMAGE'];
  if (!workerImage) throw new Error('WORKER_IMAGE zorunlu');
  const resyncMs = Number(process.env['RESYNC_INTERVAL_MS'] ?? 300_000);
  const healthPort = Number(process.env['HEALTH_PORT'] ?? 8080);

  const deps: ReconcileDeps = { kube: createKubeApi(), workerImage, log };

  const safeReconcile = async (cr: Indexer): Promise<void> => {
    try {
      await reconcile(deps, cr);
    } catch (err) {
      log.error({ err, indexer: cr.metadata?.name }, 'reconcile hatası');
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

  // silinen CR'ın temizliği ownerReferences + GC'de; Deleted'da iş yok
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
      .catch((err: unknown) => log.error({ err }, 'resync hatası'));
  }, resyncMs);

  const shutdown = (): void => {
    log.info('kapanma sinyali alındı');
    clearInterval(resync);
    watcher.close();
    health.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  log.info({ workerImage, resyncMs }, 'arclight operatör başladı');
}

main().catch((err: unknown) => {
  log.fatal({ err }, 'operatör başlatılamadı');
  process.exit(1);
});
