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

// One-shot eth_chainId over a raw WebSocket — used in the health check so the
// viem transport doesn't leave a socket open.
export function wsChainId(url: string, timeoutMs = 5_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    // close() on a failed connection can re-fire the error event (undici,
    // Node 22) → onerror → fail → close recursion; settled breaks it.
    let settled = false;
    const fail = (msg: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.close();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail(`ws chainId timed out: ${url}`), timeoutMs);
    sock.onopen = () =>
      sock.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }));
    sock.onmessage = (ev) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.close();
      const body = JSON.parse(String(ev.data)) as { result?: string };
      if (body.result) resolve(Number(body.result));
      else reject(new Error(`eth_chainId returned no result: ${url}`));
    };
    sock.onerror = () => fail(`ws connection error: ${url}`);
  });
}

export function createRpc(urls: string[]): PublicClient {
  const { http: httpUrls, ws: wsUrls } = splitRpcUrls(urls);
  // rank disabled: queries are pinned to the FIRST ws endpoint in the list
  // (config order = priority). With rank enabled, viem could shift requests to
  // the slow http transport, and the query node diverged from the node
  // announcing newHeads.
  return createPublicClient({
    transport: fallback(
      [
        ...wsUrls.map((u) => webSocket(u, { timeout: 10_000, retryCount: 2 })),
        ...httpUrls.map((u) => http(u, { timeout: 10_000, retryCount: 2 })),
      ],
      { rank: false },
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
  if (block.number === null) throw new Error(`block '${tag}' has no number (pending?)`);
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
  known?: ReadonlyMap<bigint, Date>,
): Promise<Map<bigint, Date>> {
  const map = new Map<bigint, Date>();
  const missing: bigint[] = [];
  for (const n of new Set(blockNumbers.map((b) => b.toString()))) {
    const bn = BigInt(n);
    const t = known?.get(bn);
    if (t) map.set(bn, t);
    else missing.push(bn);
  }
  // missing entries with bounded concurrency: sequential fetch was a backfill bottleneck
  const CONC = 8;
  for (let i = 0; i < missing.length; i += CONC) {
    await Promise.all(
      missing.slice(i, i + CONC).map(async (bn) => {
        const block = await client.getBlock({ blockNumber: bn });
        map.set(bn, new Date(Number(block.timestamp) * 1000));
      }),
    );
  }
  return map;
}
