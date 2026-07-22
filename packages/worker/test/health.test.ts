import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetrics } from '../src/metrics.js';
import { PhaseTracker } from '../src/status.js';
import { startHealthServer } from '../src/health.js';

describe('health + metrics', () => {
  const metrics = createMetrics('demo');
  const phase = new PhaseTracker();
  const server = startHealthServer(metrics, phase, 0);
  const port = () => (server.address() as { port: number }).port;

  beforeAll(() =>
    new Promise<void>((r) => (server.listening ? r() : server.once('listening', () => r()))),
  );
  afterAll(() => server.close());

  it('/healthz: Provisioning 200, Degraded 503', async () => {
    expect((await fetch(`http://127.0.0.1:${port()}/healthz`)).status).toBe(200);
    phase.set('Degraded', 'rpc is down');
    const res = await fetch(`http://127.0.0.1:${port()}/healthz`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ phase: 'Degraded', lastError: 'rpc is down' });
    phase.set('Live');
  });

  it('/metrics: arckive metrics carry the indexer label', async () => {
    metrics.eventsIngested.inc(5);
    const body = await (await fetch(`http://127.0.0.1:${port()}/metrics`)).text();
    expect(body).toContain('arckive_events_ingested_total{indexer="demo"} 5');
    expect(body).toContain('arckive_blocks_behind');
  });
});
