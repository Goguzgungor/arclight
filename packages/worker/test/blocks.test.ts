import { describe, expect, it } from 'vitest';
import { resolveStartBlock } from '../src/blocks.js';

describe('resolveStartBlock', () => {
  it('undefined -> head (tail live)', () => {
    expect(resolveStartBlock(undefined, 1000)).toBe(1000);
  });
  it('negative -> head + n (last |n| blocks)', () => {
    expect(resolveStartBlock(-500, 1000)).toBe(500);
  });
  it('negative clamps to 0 when it would go below genesis', () => {
    expect(resolveStartBlock(-2000, 1000)).toBe(0);
  });
  it('non-negative is absolute', () => {
    expect(resolveStartBlock(0, 1000)).toBe(0);
    expect(resolveStartBlock(750, 1000)).toBe(750);
  });
});
