// bench senaryolarının ortak istatistik yardımcıları
export interface LatencyStats {
  count: number;
  min: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

export function latencyStats(samples: number[]): LatencyStats {
  if (samples.length === 0) throw new Error('boş örneklem');
  const s = [...samples].sort((a, b) => a - b);
  return {
    count: s.length,
    min: s[0]!,
    p50: percentile(s, 50),
    p90: percentile(s, 90),
    p99: percentile(s, 99),
    max: s[s.length - 1]!,
  };
}

// birim/sn; durationMs 0 ise 0 (bölme hatası yerine)
export function rate(units: number, durationMs: number): number {
  return durationMs > 0 ? (units * 1000) / durationMs : 0;
}
