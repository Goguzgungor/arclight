import { spawn, type ChildProcess } from 'node:child_process';

let nextPort = 8600;

export interface AnvilHandle {
  url: string;
  stop: () => void;
}

export async function startAnvil(opts?: {
  chainId?: number;
  blockTime?: number;
}): Promise<AnvilHandle> {
  const port = nextPort++;
  const args = ['--port', String(port), '--silent'];
  if (opts?.chainId) args.push('--chain-id', String(opts.chainId));
  if (opts?.blockTime) args.push('--block-time', String(opts.blockTime));
  const proc: ChildProcess = spawn('anvil', args, { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  // Hazır olana kadar bekle (en fazla 15 sn)
  for (let i = 0; i < 150; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (res.ok) return { url, stop: () => proc.kill() };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  proc.kill();
  throw new Error('anvil başlatılamadı — foundry kurulu mu?');
}
