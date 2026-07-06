import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { ...opts, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

export async function retry<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs: number,
  everyMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn().catch(() => undefined as T);
    if (value !== undefined && ok(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(`retry zaman aşımı (${timeoutMs}ms): son değer ${JSON.stringify(value)}`);
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
