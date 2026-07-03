import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

export interface AnvilHandle {
  url: string;
  stop: () => void;
}

// OS'ten gerçekten boş bir port iste — sabit/pid-tabanlı aralıklar paralel test
// dosyaları arasında çakışıyor (vitest forks pool'unda pid'ler bitişik olabiliyor).
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

export async function startAnvil(opts?: {
  chainId?: number;
  blockTime?: number;
}): Promise<AnvilHandle> {
  const port = await freePort();
  const args = ['--port', String(port), '--silent'];
  if (opts?.chainId) args.push('--chain-id', String(opts.chainId));
  if (opts?.blockTime) args.push('--block-time', String(opts.blockTime));
  const proc: ChildProcess = spawn('anvil', args, { stdio: 'ignore' });
  let exited = false;
  proc.once('exit', () => {
    exited = true;
  });
  const url = `http://127.0.0.1:${port}`;
  // Hazır olana kadar bekle (en fazla 15 sn); process erken ölürse hemen bildir
  for (let i = 0; i < 150; i++) {
    if (exited) throw new Error(`anvil ${port} portunda başlatılamadı (erken çıktı)`);
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
