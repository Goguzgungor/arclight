import { describe, expect, it } from 'vitest';
import { parseWorkerConfig } from '../src/config.js';

const VALID = {
  indexerName: 'demo',
  network: { chainId: 5042002, rpc: ['https://arc-testnet.drpc.org'] },
  contracts: [
    { name: 'usdc', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', abiPath: '/etc/arckive/abi.json' },
  ],
};

describe('parseWorkerConfig', () => {
  it('applies defaults', () => {
    const cfg = parseWorkerConfig(VALID);
    expect(cfg.polling.batchBlocks).toBe(1000);
    expect(cfg.polling.intervalMs).toBe(2000);
    expect(cfg.network.finalityTag).toBe('finalized');
    expect(cfg.contracts[0]!.startBlock).toBe(0);
    expect(cfg.contracts[0]!.events).toEqual([]);
  });
  it('rejects an invalid address', () => {
    const bad = { ...VALID, contracts: [{ ...VALID.contracts[0], address: 'xyz' }] };
    expect(() => parseWorkerConfig(bad)).toThrow();
  });
  it('rejects an empty rpc list', () => {
    const bad = { ...VALID, network: { ...VALID.network, rpc: [] } };
    expect(() => parseWorkerConfig(bad)).toThrow();
  });
});
