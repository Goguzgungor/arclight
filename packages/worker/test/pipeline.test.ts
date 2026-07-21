import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { pino } from 'pino';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractEventDefs, parseWorkerConfig, type WorkerConfig } from '@arclight/core';
import { getCursor } from '../src/db.js';
import { createMetrics } from '../src/metrics.js';
import { bootstrapIndexer, runLoop, runOnce, type PipelineDeps } from '../src/pipeline.js';
import { createRpc, getBlockTimes } from '../src/rpc.js';
import { HeadSignal } from '../src/signal.js';
import { PhaseTracker } from '../src/status.js';
import { startAnvil, type AnvilHandle } from './helpers/anvil.js';

// anvil'in 0 numaralı well-known hesabı
const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const FIXTURE = fileURLToPath(new URL('./fixtures/emitter', import.meta.url));

function loadArtifact() {
  const a = JSON.parse(
    readFileSync(`${FIXTURE}/out/Emitter.sol/Emitter.json`, 'utf8'),
  ) as { abi: unknown[]; bytecode: { object: `0x${string}` } };
  return a;
}

describe('pipeline', () => {
  let anvil: AnvilHandle;
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let deps: PipelineDeps;
  let contractAddress: `0x${string}`;

  beforeAll(async () => {
    execSync('forge build', { cwd: FIXTURE, stdio: 'inherit' });
    anvil = await startAnvil();
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });

    const artifact = loadArtifact();
    const wallet = createWalletClient({
      account: privateKeyToAccount(PK),
      transport: http(anvil.url),
    }).extend(publicActions);
    const hash = await wallet.deployContract({
      abi: artifact.abi as never, bytecode: artifact.bytecode.object, chain: null,
    });
    const receipt = await wallet.waitForTransactionReceipt({ hash });
    contractAddress = receipt.contractAddress!;
    // 5 ping → 5 ayrı blokta 5 event
    for (let i = 1; i <= 5; i++) {
      const txHash = await wallet.writeContract({
        address: contractAddress, abi: artifact.abi as never,
        functionName: 'ping', args: [BigInt(i)], chain: null,
      });
      await wallet.waitForTransactionReceipt({ hash: txHash });
    }

    const cfg: WorkerConfig = parseWorkerConfig({
      indexerName: 'demo',
      network: { chainId: 31337, rpc: [anvil.url], finalityTag: 'latest' },
      contracts: [{ name: 'emitter', address: contractAddress, abiPath: 'unused' }],
      polling: { batchBlocks: 2, intervalMs: 100 },
    });
    deps = {
      client: createRpc([anvil.url]),
      pool,
      cfg,
      defs: extractEventDefs('emitter', contractAddress, artifact.abi),
      schema: 'idx_demo',
      metrics: createMetrics('demo'),
      phase: new PhaseTracker(),
      headSignal: new HeadSignal(),
      log: pino({ level: 'silent' }),
    };
    await bootstrapIndexer(deps);
  });

  afterAll(async () => {
    await pool.end();
    await container.stop();
    anvil.stop();
  });

  it('batchBlocks=2 ile yetişene kadar aralık aralık işler, 5 event yazar', async () => {
    while (await runOnce(deps)) { /* yetişene kadar */ }
    const r = await pool.query(`SELECT n, who FROM idx_demo.emitter_ping ORDER BY n`);
    expect(r.rows).toHaveLength(5);
    expect(r.rows.map((x) => x.n)).toEqual(['1', '2', '3', '4', '5']);
    expect(deps.phase.phase).toBe('Live');
  });

  it('idempotent: tekrar çalıştırmak yeni satır üretmez', async () => {
    await runOnce(deps);
    const r = await pool.query(`SELECT count(*)::int AS c FROM idx_demo.emitter_ping`);
    expect(r.rows[0].c).toBe(5);
  });

  it("restart simülasyonu: yeni pipeline instance cursor'dan devam eder, gap/duplikasyon yok", async () => {
    const artifact = loadArtifact();
    const wallet = createWalletClient({
      account: privateKeyToAccount(PK), transport: http(anvil.url),
    }).extend(publicActions);
    for (let i = 6; i <= 8; i++) {
      const txHash = await wallet.writeContract({
        address: contractAddress, abi: artifact.abi as never,
        functionName: 'ping', args: [BigInt(i)], chain: null,
      });
      await wallet.waitForTransactionReceipt({ hash: txHash });
    }
    // "çökme": eski deps atılır; aynı DB'yle sıfırdan kurulan instance devam eder
    const fresh: PipelineDeps = { ...deps, phase: new PhaseTracker(), metrics: createMetrics('demo2') };
    await bootstrapIndexer(fresh); // idempotent — cursor'a dokunmaz
    while (await runOnce(fresh)) { /* yetiş */ }
    const r = await pool.query(`SELECT count(*)::int AS c, max(n) AS m FROM idx_demo.emitter_ping`);
    expect(r.rows[0].c).toBe(8);
    expect(r.rows[0].m).toBe('8');
    const cursor = await getCursor(pool, 'idx_demo');
    expect(cursor).toBeGreaterThanOrEqual(8n);
  });

  it('runLoop: boştayken headSignal.notify() intervalMs beklemeden yeni tur başlatır', async () => {
    const headSignal = new HeadSignal();
    const localDeps: PipelineDeps = {
      ...deps,
      headSignal,
      phase: new PhaseTracker(),
      metrics: createMetrics('demo3'),
      cfg: { ...deps.cfg, polling: { batchBlocks: 100, intervalMs: 60_000 } },
    };
    const ctrl = new AbortController();
    const loop = runLoop(localDeps, ctrl.signal);
    await new Promise((r) => setTimeout(r, 500)); // yetişip boşa düşsün

    // 9. event'i üret ve sinyal ver — intervalMs (60 sn) dolmadan işlenmeli
    const artifact = loadArtifact();
    const wallet = createWalletClient({
      account: privateKeyToAccount(PK), transport: http(anvil.url),
    }).extend(publicActions);
    const txHash = await wallet.writeContract({
      address: contractAddress, abi: artifact.abi as never,
      functionName: 'ping', args: [9n], chain: null,
    });
    await wallet.waitForTransactionReceipt({ hash: txHash });
    headSignal.notify();

    const t0 = Date.now();
    let count = 0;
    while (Date.now() - t0 < 5_000) {
      const r = await pool.query(`SELECT count(*)::int AS c FROM idx_demo.emitter_ping`);
      count = r.rows[0].c as number;
      if (count === 9) break;
      await new Promise((r2) => setTimeout(r2, 100));
    }
    ctrl.abort();
    await loop;
    expect(count).toBe(9);
  });

  it("sıcak yol: 'latest' modunda hedef birincil sinyalden gelir (guard'ın gördüğü head değil)", async () => {
    const { HeadSignal: HS } = await import('../src/signal.js');
    const hs = new HS();
    const calls = { getBlock: 0 };
    const fake = {
      // guard çağrısı: sorgu node'u 5'te — ama hedef sinyaldeki 3 olmalı
      getBlock: async () => {
        calls.getBlock += 1;
        return { number: 5n };
      },
      getLogs: async () => [],
    } as unknown as PipelineDeps['client'];
    const cfg2 = parseWorkerConfig({
      indexerName: 'hot',
      network: { chainId: 31337, rpc: [anvil.url], finalityTag: 'latest' },
      contracts: [{ name: 'emitter', address: contractAddress, abiPath: 'unused' }],
      polling: { batchBlocks: 100, intervalMs: 100 },
    });
    const d2: PipelineDeps = {
      ...deps, client: fake, cfg: cfg2, schema: 'idx_hot',
      headSignal: hs, metrics: createMetrics('hot'), phase: new PhaseTracker(),
    };
    await bootstrapIndexer(d2);
    hs.notify({ number: 3n, timestamp: new Date() }, true);
    expect(await runOnce(d2)).toBe(true);
    expect(calls.getBlock).toBe(1); // yalnız paralel tamlık guard'ı
    expect(await getCursor(pool, 'idx_hot')).toBe(3n); // 5 değil — hedef sinyalden
  });

  it('tamlık guard\'ı: sorgu node\'u sinyalin gerisindeyse cursor clamp\'lenir', async () => {
    const { HeadSignal: HS } = await import('../src/signal.js');
    const hs = new HS();
    const fake = {
      getBlock: async () => ({ number: 2n }), // node 2'de, sinyal 5 diyor
      getLogs: async () => [],
    } as unknown as PipelineDeps['client'];
    const cfg2 = parseWorkerConfig({
      indexerName: 'clamp',
      network: { chainId: 31337, rpc: [anvil.url], finalityTag: 'latest' },
      contracts: [{ name: 'emitter', address: contractAddress, abiPath: 'unused' }],
      polling: { batchBlocks: 100, intervalMs: 100 },
    });
    const d2: PipelineDeps = {
      ...deps, client: fake, cfg: cfg2, schema: 'idx_clamp',
      headSignal: hs, metrics: createMetrics('clamp'), phase: new PhaseTracker(),
    };
    await bootstrapIndexer(d2);
    hs.notify({ number: 5n, timestamp: new Date() }, true);
    expect(await runOnce(d2)).toBe(true);
    expect(await getCursor(pool, 'idx_clamp')).toBe(2n); // görmediği aralık commit edilmez
  });

  it('getBlockTimes: önbellekteki bloklar için RPC çağrısı yapılmaz', async () => {
    const client = {
      getBlock: async () => { throw new Error('önbellek varken çağrılmamalı'); },
    } as unknown as PipelineDeps['client'];
    const known = new Map([[5n, new Date(5000)]]);
    const times = await getBlockTimes(client, [5n, 5n], known);
    expect(times.get(5n)!.getTime()).toBe(5000);
  });
});
