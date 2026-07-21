import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export function createMetrics(indexerName: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ indexer: indexerName });
  return {
    registry,
    blocksBehind: new Gauge({
      name: 'arclight_blocks_behind',
      help: 'block gap between the finalized head and the cursor',
      registers: [registry],
    }),
    lastProcessedBlock: new Gauge({
      name: 'arclight_last_processed_block',
      help: 'last processed block number',
      registers: [registry],
    }),
    eventsIngested: new Counter({
      name: 'arclight_events_ingested_total',
      help: 'total number of events written',
      registers: [registry],
    }),
    rpcErrors: new Counter({
      name: 'arclight_rpc_errors_total',
      help: 'number of RPC errors',
      registers: [registry],
    }),
    deadLetters: new Counter({
      name: 'arclight_dead_letter_total',
      help: 'number of logs sent to the dead-letter table',
      registers: [registry],
    }),
    wsConnected: new Gauge({
      name: 'arclight_ws_connected',
      help: 'whether the newHeads WS subscription is connected (0/1)',
      registers: [registry],
    }),
    headNotifications: new Counter({
      name: 'arclight_head_notifications_total',
      help: 'number of newHeads notifications received',
      registers: [registry],
    }),
    writeLatency: new Histogram({
      name: 'arclight_write_latency_seconds',
      help: 'batch commit duration',
      registers: [registry],
    }),
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
