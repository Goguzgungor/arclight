// Senaryo 1 — Tazelik: canlı ağda blok kapanışı → SQL satırı.
// Worker gerçek USDC trafiğini WS newHeads DİNLEME modunda tail'ler (polling
// yalnızca güvenlik ağı) ve gecikme ürünün kendi meta kolonlarından okunur:
// _ingested_at - block_time. Emitter yok: üçüncü şahıs trafiği ölçülür.
// Ağ seçimi: BENCH_FRESH_NETWORK=arc-testnet (varsayılan) | base-mainnet
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { latencyStats, type LatencyStats } from './stats.ts';
import { healthz, metricValue, spawnWorker, stopWorker, waitFor, writeWorkerFiles } from './worker-proc.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');

export const NETWORKS = {
  'arc-testnet': {
    chainId: 5042002,
    // birincil ws = resmi uç (ölçümde her blokta ilk duyuran); drpc yedeklilik
    rpc: [
      'wss://rpc.testnet.arc.network',
      'wss://arc-testnet.drpc.org',
      'https://rpc.testnet.arc.network',
    ],
    usdc: '0x3600000000000000000000000000000000000000',
  },
  'base-mainnet': {
    chainId: 8453,
    rpc: [
      'wss://base-rpc.publicnode.com',
      'wss://base.drpc.org',
      'https://base-rpc.publicnode.com',
    ],
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
} as const;

export type FreshNetwork = keyof typeof NETWORKS;
export const FRESH_NETWORK = (process.env['BENCH_FRESH_NETWORK'] ?? 'arc-testnet') as FreshNetwork;
if (!(FRESH_NETWORK in NETWORKS)) throw new Error(`bilinmeyen ağ: ${FRESH_NETWORK}`);
export const PRIMARY_WS = NETWORKS[FRESH_NETWORK].rpc[0];

const PORT = 9301;
const SAMPLES = Number(process.env['BENCH_FRESH_SAMPLES'] ?? 40);
const WINDOW_MS = Number(process.env['BENCH_FRESH_WINDOW_MS'] ?? 240_000);

export async function rpcHead(url: string): Promise<number> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { result?: string };
  if (!body.result) throw new Error(`eth_blockNumber boş döndü: ${url}`);
  return Number(body.result);
}

export function usdcAbi(): unknown {
  return JSON.parse(readFileSync(resolve(ROOT, 'manifests/arc-testnet/usdc-abi.json'), 'utf8'));
}

export interface FreshnessResult {
  kind: 'freshness';
  network: FreshNetwork;
  rpc: readonly string[];
  contractAddress: string;
  mode: 'ws-listening';
  headNotifications: number;
  emitter: 'third-party traffic';
  stats: LatencyStats;
  samplesMs: number[];
  blockSpan: { from: number; to: number };
  durationMs: number;
}

export async function run(databaseUrl: string): Promise<FreshnessResult> {
  const net = NETWORKS[FRESH_NETWORK];
  const httpUrl = net.rpc.find((u) => u.startsWith('http'))!;
  const head = await rpcHead(httpUrl);

  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query('DROP SCHEMA IF EXISTS idx_bench_fresh CASCADE');

  const configPath = writeWorkerFiles('fresh', { 'usdc-abi.json': usdcAbi() }, (dir) => ({
    indexerName: 'bench-fresh',
    network: { chainId: net.chainId, rpc: net.rpc, finalityTag: 'latest' },
    contracts: [
      { name: 'usdc', address: net.usdc, abiPath: `${dir}/usdc-abi.json`, startBlock: head, events: ['Transfer'] },
    ],
    polling: { batchBlocks: 1000, intervalMs: 2000 }, // WS varken interval güvenlik ağı
  }));

  const worker = spawnWorker(configPath, databaseUrl, PORT);
  const t0 = performance.now();
  try {
    await waitFor('worker healthz up', async () => (await healthz(PORT)) !== null, 60_000);
    // dinleme modu şart: WS bağlanmadıysa bench polling sayısı raporlamaz, düşer
    await waitFor(
      'ws newHeads aboneliği (arclight_ws_connected=1)',
      async () => ((await metricValue(PORT, 'arclight_ws_connected')) ?? 0) === 1,
      30_000,
      500,
    );

    await waitFor(
      `pencerede ${SAMPLES} usdc transfer satırı`,
      async () => {
        const h = await healthz(PORT);
        if (h?.phase === 'Degraded') throw new Error(`worker Degraded: ${h.lastError ?? '?'}`);
        try {
          const r = await db.query('SELECT count(*)::int AS n FROM idx_bench_fresh.usdc_transfer');
          return Number(r.rows[0]!.n) >= SAMPLES;
        } catch {
          return false; // tablo bootstrap edilmemiş olabilir
        }
      },
      WINDOW_MS,
      1000,
    );
    await new Promise((r) => setTimeout(r, 2000)); // kuyruk payı

    const wsStill = (await metricValue(PORT, 'arclight_ws_connected')) ?? 0;
    if (wsStill !== 1) throw new Error('pencere sonunda WS bağlantısı kopuktu — koşu geçersiz');
    const headNotifications = (await metricValue(PORT, 'arclight_head_notifications_total')) ?? 0;

    const rows = await db.query(
      `SELECT EXTRACT(EPOCH FROM (_ingested_at - block_time)) * 1000 AS ms, block_number
         FROM idx_bench_fresh.usdc_transfer ORDER BY block_number`,
    );
    const samplesMs = rows.rows.map((r) => Math.round(Number(r.ms)));
    const blocks = rows.rows.map((r) => Number(r.block_number));
    return {
      kind: 'freshness',
      network: FRESH_NETWORK,
      rpc: net.rpc,
      contractAddress: net.usdc,
      mode: 'ws-listening',
      headNotifications,
      emitter: 'third-party traffic',
      stats: latencyStats(samplesMs),
      samplesMs,
      blockSpan: { from: Math.min(...blocks), to: Math.max(...blocks) },
      durationMs: Math.round(performance.now() - t0),
    };
  } finally {
    await stopWorker(worker);
    await db.end();
  }
}
