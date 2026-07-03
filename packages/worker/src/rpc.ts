import {
  createPublicClient, fallback, http,
  type Log, type PublicClient,
} from 'viem';

export class ChainIdMismatchError extends Error {}

export function createRpc(urls: string[]): PublicClient {
  return createPublicClient({
    transport: fallback(
      urls.map((u) => http(u, { timeout: 10_000, retryCount: 2 })),
      { rank: true },
    ),
  });
}

export async function filterHealthyRpcs(
  urls: string[],
  expectedChainId: number,
): Promise<string[]> {
  const checks = await Promise.all(
    urls.map(async (url) => {
      try {
        const client = createPublicClient({ transport: http(url, { timeout: 5_000, retryCount: 0 }) });
        return (await client.getChainId()) === expectedChainId ? url : null;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((u): u is string => u !== null);
}

export async function getFinalizedBlockNumber(
  client: PublicClient,
  tag: 'finalized' | 'safe' | 'latest',
): Promise<bigint> {
  const block = await client.getBlock({ blockTag: tag });
  if (block.number === null) throw new Error(`'${tag}' bloğunun numarası yok (pending?)`);
  return block.number;
}

export async function fetchLogs(
  client: PublicClient,
  addresses: `0x${string}`[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Log[]> {
  return client.getLogs({ address: addresses, fromBlock, toBlock });
}

export async function getBlockTimes(
  client: PublicClient,
  blockNumbers: bigint[],
): Promise<Map<bigint, Date>> {
  const map = new Map<bigint, Date>();
  for (const n of new Set(blockNumbers.map((b) => b.toString()))) {
    const block = await client.getBlock({ blockNumber: BigInt(n) });
    map.set(BigInt(n), new Date(Number(block.timestamp) * 1000));
  }
  return map;
}
