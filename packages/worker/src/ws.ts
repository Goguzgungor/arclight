import type { Logger } from 'pino';

export interface HeadPayload {
  number: bigint;
  timestamp: Date;
}

export interface NewHeadsSubscription {
  close(): void;
}

// PARALLEL newHeads subscription to all ws endpoints (fan-in): the primary
// (first in the list) endpoint feeds the hot-path target, the others provide
// wake-ups and redundancy. Each connection reconnects to the same endpoint
// with its own backoff. A raw WebSocket is used because the viem transport
// does not expose connection state.
export function subscribeNewHeads(opts: {
  wsUrls: string[];
  onHead: (head: HeadPayload | null, primary: boolean) => void;
  onStateChange: (connected: boolean) => void; // is at least one endpoint connected
  log: Logger;
}): NewHeadsSubscription {
  let closed = false;
  const connected = new Set<number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const socks = new Set<WebSocket>();

  const setConn = (idx: number, up: boolean): void => {
    const before = connected.size > 0;
    if (up) connected.add(idx);
    else connected.delete(idx);
    const after = connected.size > 0;
    if (before !== after) opts.onStateChange(after);
  };

  const connect = (idx: number, attempt: number): void => {
    if (closed) return;
    const url = opts.wsUrls[idx]!;
    const sock = new WebSocket(url);
    socks.add(sock);
    sock.onopen = () => {
      sock.send(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }),
      );
    };
    sock.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        method?: string;
        params?: { result?: { number?: string; timestamp?: string } };
      };
      if (msg.id === 1) {
        attempt = 0;
        setConn(idx, true);
        opts.log.info({ url }, 'newHeads subscription opened');
      } else if (msg.method === 'eth_subscription') {
        const r = msg.params?.result;
        const head: HeadPayload | null =
          r?.number && r.timestamp
            ? { number: BigInt(r.number), timestamp: new Date(Number(r.timestamp) * 1000) }
            : null;
        opts.onHead(head, idx === 0);
      }
    };
    sock.onclose = () => {
      socks.delete(sock);
      if (closed) return;
      setConn(idx, false);
      const delayMs = Math.min(1_000 * 2 ** attempt, 30_000);
      opts.log.warn({ url, delayMs }, 'WS dropped — reconnecting');
      const t = setTimeout(() => {
        timers.delete(t);
        connect(idx, attempt + 1);
      }, delayMs);
      timers.add(t);
    };
    sock.onerror = () => {
      // an error is always followed by close; onclose handles the reconnect
    };
  };

  opts.wsUrls.forEach((_, i) => connect(i, 0));
  return {
    close(): void {
      closed = true;
      for (const t of timers) clearTimeout(t);
      for (const s of socks) s.close();
    },
  };
}
