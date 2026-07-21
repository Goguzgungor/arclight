// Sağlayıcı tabanı: RPC'nin WS newHeads aboneliği bir bloğu, validator
// damgasından ne kadar sonra duyuruyor? (now - block.timestamp). Bu taban
// hiçbir indexer'ın kontrolünde değildir; freshness bütçesinin bağlamıdır.
import { PRIMARY_WS } from './freshness.ts';
import { latencyStats, type LatencyStats } from './stats.ts';

const HEADS = Number(process.env['BENCH_VISIBILITY_HEADS'] ?? 30);

export interface VisibilityResult {
  kind: 'visibility';
  url: string;
  samples: number[];
  stats: LatencyStats;
}

export async function run(): Promise<VisibilityResult> {
  const samples = await new Promise<number[]>((resolve, reject) => {
    const out: number[] = [];
    const ws = new WebSocket(PRIMARY_WS);
    const fail = (msg: string): void => {
      try { ws.close(); } catch { /* kapalı */ }
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail(`visibility zaman aşımı (${HEADS} head beklenirken)`), 120_000);
    ws.onopen = () =>
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as { params?: { result?: { timestamp?: string } } };
      const ts = m.params?.result?.timestamp;
      if (!ts) return;
      out.push(Math.round(Date.now() - Number(ts) * 1000));
      if (out.length >= HEADS) {
        clearTimeout(timer);
        ws.close();
        resolve(out);
      }
    };
    ws.onerror = () => { clearTimeout(timer); fail(`ws bağlantı hatası: ${PRIMARY_WS}`); };
  });
  return { kind: 'visibility', url: PRIMARY_WS, samples, stats: latencyStats(samples) };
}
