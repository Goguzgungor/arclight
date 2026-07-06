import {
  createPublicClient, fallback, http, webSocket,
  type Log, type PublicClient,
} from 'viem';

export class ChainIdMismatchError extends Error {}

export interface RpcUrlGroups {
  http: string[];
  ws: string[];
}

export function splitRpcUrls(urls: string[]): RpcUrlGroups {
  const groups: RpcUrlGroups = { http: [], ws: [] };
  for (const u of urls) {
    (u.startsWith('ws://') || u.startsWith('wss://') ? groups.ws : groups.http).push(u);
  }
  return groups;
}

// Ham WebSocket ile tek seferlik eth_chainId — viem transport'u açık soket
// bırakmasın diye sağlık kontrolünde kullanılır.
export function wsChainId(url: string, timeoutMs = 5_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    const fail = (msg: string): void => {
      clearTimeout(timer);
      sock.close();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail(`ws chainId zaman aşımı: ${url}`), timeoutMs);
    sock.onopen = () =>
      sock.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }));
    sock.onmessage = (ev) => {
      clearTimeout(timer);
      sock.close();
      const body = JSON.parse(String(ev.data)) as { result?: string };
      if (body.result) resolve(Number(body.result));
      else reject(new Error(`eth_chainId sonuç dönmedi: ${url}`));
    };
    sock.onerror = () => fail(`ws bağlantı hatası: ${url}`);
  });
}

export function createRpc(urls: string[]): PublicClient {
  const { http: httpUrls, ws: wsUrls } = splitRpcUrls(urls);
  return createPublicClient({
    transport: fallback(
      [
        ...wsUrls.map((u) => webSocket(u, { timeout: 10_000, retryCount: 2 })),
        ...httpUrls.map((u) => http(u, { timeout: 10_000, retryCount: 2 })),
      ],
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
        if (url.startsWith('ws://') || url.startsWith('wss://')) {
          return (await wsChainId(url)) === expectedChainId ? url : null;
        }
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
