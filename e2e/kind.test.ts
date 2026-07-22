import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { retry, sh } from './helpers/sh.js';

const E2E_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));

const kubectl = (...args: string[]) => sh('kubectl', args);
const psqlCount = () =>
  kubectl(
    'exec', 'deploy/postgres', '--',
    'psql', '-U', 'arckive', '-t', '-A', '-c',
    'select count(*) from idx_demo.emitter_ping',
  );

let portForward: ChildProcess | undefined;

beforeAll(async () => {
  await sh('bash', [`${E2E_DIR}scripts/e2e-setup.sh`], { cwd: REPO });

  // Port-forward anvil, deploy the Emitter + produce 10 events
  portForward = spawn('kubectl', ['port-forward', 'deploy/anvil', '8545:8545'], {
    stdio: 'ignore',
  });
  await retry(
    async () => {
      const res = await fetch('http://127.0.0.1:8545', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
      });
      return res.ok;
    },
    (ok) => ok,
    60_000,
    1_000,
  );
  await sh('pnpm', ['--filter', '@arckive/worker', 'demo:seed'], { cwd: REPO });
  portForward.kill();
});

afterAll(() => {
  portForward?.kill();
});

describe('kind e2e', () => {
  it('2-3 YAMLs → indexer in Live phase and 10 rows', async () => {
    await kubectl('apply', '-f', `${E2E_DIR}manifests/`);

    const phase = await retry(
      () => kubectl('get', 'indexer', 'demo', '-o', 'jsonpath={.status.phase}'),
      (p) => p === 'Live',
      300_000,
    );
    expect(phase).toBe('Live');

    const count = await retry(psqlCount, (c) => c === '10', 120_000);
    expect(count).toBe('10');

    const table = await kubectl('get', 'indexer', 'demo');
    expect(table).toMatch(/PHASE/);
    expect(table).toMatch(/CURRENT/);
    expect(table).toMatch(/Live/);
  });

  it('deleting the CR cleans up worker resources, data survives', async () => {
    await kubectl('delete', 'indexer', 'demo', '--wait=true');

    await retry(
      async () => {
        try {
          await kubectl('get', 'deploy', 'arckive-demo');
          return 'present';
        } catch {
          return 'gone';
        }
      },
      (s) => s === 'gone',
      120_000,
    );

    expect(await psqlCount()).toBe('10');
  });
});
