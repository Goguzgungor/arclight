import type { Logger } from 'pino';

export interface NewHeadsSubscription {
  close(): void;
}

// Ham WebSocket ile newHeads aboneliği: viem'in transport'u bağlantı durumunu
// dışarı vermiyor; reconnect ve gauge için duruma ihtiyacımız var.
export function subscribeNewHeads(opts: {
  wsUrls: string[];
  onHead: () => void;
  onStateChange: (connected: boolean) => void;
  log: Logger;
}): NewHeadsSubscription {
  let closed = false;
  let attempt = 0;
  let sock: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = (idx: number): void => {
    if (closed) return;
    const url = opts.wsUrls[idx % opts.wsUrls.length]!;
    sock = new WebSocket(url);
    sock.onopen = () => {
      sock?.send(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }),
      );
    };
    sock.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; method?: string };
      if (msg.id === 1) {
        attempt = 0;
        opts.onStateChange(true);
        opts.log.info({ url }, 'newHeads aboneliği açıldı');
      } else if (msg.method === 'eth_subscription') {
        opts.onHead();
      }
    };
    sock.onclose = () => {
      if (closed) return;
      opts.onStateChange(false);
      const delayMs = Math.min(1_000 * 2 ** attempt, 30_000);
      attempt += 1;
      opts.log.warn({ url, delayMs }, 'WS koptu — yeniden bağlanılacak');
      retryTimer = setTimeout(() => connect(idx + 1), delayMs);
    };
    sock.onerror = () => {
      // hata her zaman close ile izlenir; reconnect'i onclose yönetir
    };
  };

  connect(0);
  return {
    close(): void {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      sock?.close();
    },
  };
}
