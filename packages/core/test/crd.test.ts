import { describe, expect, it } from 'vitest';
import {
  IndexerSpecSchema,
  WorkerConfigSchema,
  configHash,
  renderWorkerConfig,
} from '../src/index.js';

const ADDR = `0x${'ab'.repeat(20)}`;

const raw = {
  network: { chainId: 5042002, rpc: ['https://arc-testnet.drpc.org'] },
  storage: { mode: 'External', external: { dsnSecretRef: { name: 'pg-dsn' } } },
  contracts: [{ name: 'usdc', address: ADDR, abi: { configMapRef: { name: 'usdc-abi' } } }],
};

describe('IndexerSpecSchema', () => {
  it('varsayılanları doldurur', () => {
    const spec = IndexerSpecSchema.parse(raw);
    expect(spec.network.finalityTag).toBe('finalized');
    expect(spec.storage.external.dsnSecretRef.key).toBe('url');
    expect(spec.contracts[0]!.abi.configMapRef.key).toBe('abi.json');
    expect(spec.contracts[0]!.startBlock).toBe(0);
    expect(spec.contracts[0]!.events).toEqual([]);
    expect(spec.polling).toEqual({ batchBlocks: 1000, intervalMs: 2000 });
  });

  it('geçersiz adresi reddeder', () => {
    const bad = { ...raw, contracts: [{ ...raw.contracts[0]!, address: '0x123' }] };
    expect(() => IndexerSpecSchema.parse(bad)).toThrow();
  });

  it('DNS-uyumsuz contract adını reddeder', () => {
    const bad = { ...raw, contracts: [{ ...raw.contracts[0]!, name: 'My_Token' }] };
    expect(() => IndexerSpecSchema.parse(bad)).toThrow();
  });

  it('boş contracts listesini reddeder', () => {
    expect(() => IndexerSpecSchema.parse({ ...raw, contracts: [] })).toThrow();
  });

  it('rpc: ws:// ve wss:// URL kabul edilir', () => {
    const ok = {
      ...raw,
      network: { ...raw.network, rpc: ['wss://arc-testnet.drpc.org', 'ws://anvil:8545', 'https://x.example'] },
    };
    expect(IndexerSpecSchema.safeParse(ok).success).toBe(true);
  });

  it('rpc: http/ws dışı şema reddedilir', () => {
    const bad = { ...raw, network: { ...raw.network, rpc: ['ftp://kotu.example'] } };
    expect(IndexerSpecSchema.safeParse(bad).success).toBe(false);
  });
});

describe('renderWorkerConfig', () => {
  it('WorkerConfigSchema ile uyumlu config üretir', () => {
    const spec = IndexerSpecSchema.parse(raw);
    const cfg = renderWorkerConfig('usdc-arc', spec);
    expect(() => WorkerConfigSchema.parse(cfg)).not.toThrow();
    expect(cfg.indexerName).toBe('usdc-arc');
    expect(cfg.contracts[0]!.abiPath).toBe('/etc/arclight/abis/usdc/abi.json');
    expect(cfg.network.finalityTag).toBe('finalized');
  });
});

describe('configHash', () => {
  it('deterministik ve girdiye duyarlıdır', () => {
    const spec = IndexerSpecSchema.parse(raw);
    const a = configHash(renderWorkerConfig('usdc-arc', spec));
    const b = configHash(renderWorkerConfig('usdc-arc', spec));
    const c = configHash(renderWorkerConfig('baska-ad', spec));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});
