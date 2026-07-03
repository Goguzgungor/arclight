export interface BlockRange {
  fromBlock: bigint;
  toBlock: bigint;
}

export function planRange(
  lastProcessed: bigint,
  finalized: bigint,
  batchBlocks: number,
): BlockRange | null {
  if (finalized <= lastProcessed) return null;
  const fromBlock = lastProcessed + 1n;
  const cap = fromBlock + BigInt(batchBlocks - 1);
  return { fromBlock, toBlock: finalized < cap ? finalized : cap };
}
