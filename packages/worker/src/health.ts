import { createServer, type Server } from 'node:http';
import type { Metrics } from './metrics.js';
import type { PhaseTracker } from './status.js';

export function startHealthServer(metrics: Metrics, phase: PhaseTracker, port: number): Server {
  const server = createServer((req, res) => {
    if (req.url === '/metrics') {
      void metrics.registry.metrics().then((body) => {
        res.setHeader('content-type', metrics.registry.contentType);
        res.end(body);
      });
    } else if (req.url === '/healthz') {
      res.statusCode = phase.healthy ? 200 : 503;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ phase: phase.phase, lastError: phase.lastError ?? null }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  server.listen(port);
  return server;
}
