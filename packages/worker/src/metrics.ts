import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export function createMetrics(indexerName: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ indexer: indexerName });
  return {
    registry,
    blocksBehind: new Gauge({
      name: 'arclight_blocks_behind',
      help: 'finalized head ile cursor arasındaki blok farkı',
      registers: [registry],
    }),
    lastProcessedBlock: new Gauge({
      name: 'arclight_last_processed_block',
      help: 'işlenen son blok numarası',
      registers: [registry],
    }),
    eventsIngested: new Counter({
      name: 'arclight_events_ingested_total',
      help: 'yazılan toplam event sayısı',
      registers: [registry],
    }),
    rpcErrors: new Counter({
      name: 'arclight_rpc_errors_total',
      help: 'RPC hata sayısı',
      registers: [registry],
    }),
    deadLetters: new Counter({
      name: 'arclight_dead_letter_total',
      help: 'dead-letter tablosuna düşen log sayısı',
      registers: [registry],
    }),
    writeLatency: new Histogram({
      name: 'arclight_write_latency_seconds',
      help: 'batch commit süresi',
      registers: [registry],
    }),
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
