import { describe, expect, it } from 'vitest';
import { planRange } from '../src/ranges.js';

describe('planRange', () => {
  it('yetişilmişse null', () => {
    expect(planRange(100n, 100n, 1000)).toBeNull();
    expect(planRange(100n, 99n, 1000)).toBeNull();
  });
  it('batchBlocks ile sınırlar', () => {
    expect(planRange(0n, 5000n, 1000)).toEqual({ fromBlock: 1n, toBlock: 1000n });
  });
  it("finalized yakınsa finalized'a kadar", () => {
    expect(planRange(998n, 1000n, 1000)).toEqual({ fromBlock: 999n, toBlock: 1000n });
  });
});
