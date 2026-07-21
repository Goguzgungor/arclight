import { describe, expect, it } from 'vitest';
import { planRange } from '../src/ranges.js';

describe('planRange', () => {
  it('returns null when caught up', () => {
    expect(planRange(100n, 100n, 1000)).toBeNull();
    expect(planRange(100n, 99n, 1000)).toBeNull();
  });
  it('caps the range with batchBlocks', () => {
    expect(planRange(0n, 5000n, 1000)).toEqual({ fromBlock: 1n, toBlock: 1000n });
  });
  it('goes up to finalized when finalized is near', () => {
    expect(planRange(998n, 1000n, 1000)).toEqual({ fromBlock: 999n, toBlock: 1000n });
  });
});
