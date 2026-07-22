// Resolve a configured startBlock against the current chain head:
//   undefined -> head            (tail live, no backfill)
//   negative  -> head + value    (backfill the last |value| blocks; clamped to 0)
//   >= 0      -> the value as-is  (absolute block)
export function resolveStartBlock(startBlock: number | undefined, head: number): number {
  if (startBlock === undefined) return head;
  if (startBlock < 0) return Math.max(0, head + startBlock);
  return startBlock;
}
