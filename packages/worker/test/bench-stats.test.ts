import { describe, expect, it } from 'vitest';
import { latencyStats, rate } from '../scripts/bench/stats.ts';

describe('latencyStats', () => {
  it('single sample: every field has the same value', () => {
    const s = latencyStats([42]);
    expect(s).toEqual({ count: 1, min: 42, p50: 42, p90: 42, p99: 42, max: 42 });
  });

  it('1..100: classic percentiles', () => {
    const s = latencyStats(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(s.min).toBe(1);
    expect(s.p50).toBe(50);
    expect(s.p90).toBe(90);
    expect(s.p99).toBe(99);
    expect(s.max).toBe(100);
  });

  it('unordered input is sorted, input is not mutated', () => {
    const input = [3, 1, 2];
    expect(latencyStats(input).p50).toBe(2);
    expect(input).toEqual([3, 1, 2]);
  });

  it('empty sample set throws', () => {
    expect(() => latencyStats([])).toThrow('empty sample set');
  });
});

describe('rate', () => {
  it('1000 units / 2000ms = 500/s', () => {
    expect(rate(1000, 2000)).toBe(500);
  });
  it('returns 0 when duration is 0', () => {
    expect(rate(10, 0)).toBe(0);
  });
});
