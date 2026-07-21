// Helpers that spawn the real worker process and read from its production
// observability surface (healthz + metrics). Worker code is never touched — a
// bench principle.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WORKER_DIR = resolve(import.meta.dirname, '../..');

export interface WorkerHandle {
  proc: ChildProcess;
  port: number;
}

// writes helper files (ABI etc.) to a temp directory, passes the directory
// path to the config builder, writes config.json and returns its path
export function writeWorkerFiles(
  name: string,
  files: Record<string, unknown>,
  makeConfig: (dir: string) => Record<string, unknown>,
): string {
  const dir = mkdtempSync(join(tmpdir(), `arclight-bench-${name}-`));
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), JSON.stringify(content, null, 2));
  }
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(makeConfig(dir), null, 2));
  return configPath;
}

export function spawnWorker(configPath: string, databaseUrl: string, port: number): WorkerHandle {
  const proc = spawn('node', ['dist/main.js'], {
    cwd: WORKER_DIR,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      CONFIG_PATH: configPath,
      HEALTH_PORT: String(port),
      LOG_LEVEL: process.env['BENCH_WORKER_LOG'] ?? 'warn',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return { proc, port };
}

export interface Healthz {
  phase: string;
  lastError: string | null;
}

export async function healthz(port: number): Promise<Healthz | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) });
    return (await r.json()) as Healthz; // a 503 also returns a body (Degraded)
  } catch {
    return null;
  }
}

// reads a single series' value from the prometheus text format (regardless of labels)
export async function metricValue(port: number, name: string): Promise<number | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/metrics`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    const text = await r.text();
    for (const line of text.split('\n')) {
      if (line.startsWith(name) && (line[name.length] === '{' || line[name.length] === ' ')) {
        const value = Number(line.slice(line.lastIndexOf(' ') + 1));
        if (Number.isFinite(value)) return value;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function waitFor(
  what: string,
  cond: () => Promise<boolean>,
  timeoutMs: number,
  everyMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timed out (${timeoutMs}ms): ${what}`);
}

export async function stopWorker(h: WorkerHandle): Promise<void> {
  if (h.proc.exitCode !== null) return;
  h.proc.kill('SIGTERM');
  const exited = new Promise<void>((resolve) => h.proc.once('exit', () => resolve()));
  const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 10_000));
  if ((await Promise.race([exited, timeout])) === 'timeout') h.proc.kill('SIGKILL');
}
