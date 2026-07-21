import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRpc, fetchLogs, filterHealthyRpcs, getBlockTimes, getFinalizedBlockNumber, splitRpcUrls,
} from '../src/rpc.js';
import { startAnvil, type AnvilHandle } from './helpers/anvil.js';

describe('rpc', () => {
  let anvil: AnvilHandle;

  beforeAll(async () => {
    anvil = await startAnvil(); // default chainId 31337
  });
  afterAll(() => anvil.stop());

  it('filterHealthyRpcs: matching endpoints stay, mismatched/dead ones are dropped', async () => {
    const healthy = await filterHealthyRpcs(
      ['http://127.0.0.1:1', anvil.url], 31337,
    );
    expect(healthy).toEqual([anvil.url]);
    expect(await filterHealthyRpcs([anvil.url], 5042002)).toEqual([]);
  });

  it('fallback: dead endpoint + healthy endpoint still works', async () => {
    const client = createRpc(['http://127.0.0.1:1', anvil.url]);
    const n = await getFinalizedBlockNumber(client, 'latest');
    expect(n).toBeGreaterThanOrEqual(0n);
  });

  it('block times are fetched', async () => {
    const client = createRpc([anvil.url]);
    const times = await getBlockTimes(client, [0n]);
    expect(times.get(0n)).toBeInstanceOf(Date);
  });

  it('splitRpcUrls: splits by scheme', () => {
    expect(
      splitRpcUrls(['https://a.example', 'ws://b.example', 'wss://c.example', 'http://d.example']),
    ).toEqual({
      http: ['https://a.example', 'http://d.example'],
      ws: ['ws://b.example', 'wss://c.example'],
    });
  });

  it('filterHealthyRpcs: ws endpoints are also verified via chainId', async () => {
    const healthy = await filterHealthyRpcs(
      ['ws://127.0.0.1:1', anvil.wsUrl, anvil.url], 31337,
    );
    expect(healthy).toEqual([anvil.wsUrl, anvil.url]);
  });

  it('createRpc: reads work over a ws endpoint', async () => {
    const client = createRpc([anvil.wsUrl]);
    const n = await getFinalizedBlockNumber(client, 'latest');
    expect(n).toBeGreaterThanOrEqual(0n);
  });

  it('fetchLogs returns empty for an empty range', async () => {
    const client = createRpc([anvil.url]);
    const logs = await fetchLogs(
      client, ['0x0000000000000000000000000000000000000001'], 0n, 0n,
    );
    expect(logs).toEqual([]);
  });
});
