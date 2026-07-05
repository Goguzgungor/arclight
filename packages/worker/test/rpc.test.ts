import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRpc, fetchLogs, filterHealthyRpcs, getBlockTimes, getFinalizedBlockNumber,
} from '../src/rpc.js';
import { startAnvil, type AnvilHandle } from './helpers/anvil.js';

describe('rpc', () => {
  let anvil: AnvilHandle;

  beforeAll(async () => {
    anvil = await startAnvil(); // varsayılan chainId 31337
  });
  afterAll(() => anvil.stop());

  it('filterHealthyRpcs: uyan uçlar kalır, uymayan/ölü elenir', async () => {
    const healthy = await filterHealthyRpcs(
      ['http://127.0.0.1:1', anvil.url], 31337,
    );
    expect(healthy).toEqual([anvil.url]);
    expect(await filterHealthyRpcs([anvil.url], 5042002)).toEqual([]);
  });

  it('fallback: ölü uç + sağlıklı uç yine çalışır', async () => {
    const client = createRpc(['http://127.0.0.1:1', anvil.url]);
    const n = await getFinalizedBlockNumber(client, 'latest');
    expect(n).toBeGreaterThanOrEqual(0n);
  });

  it('blok zamanları çekilir', async () => {
    const client = createRpc([anvil.url]);
    const times = await getBlockTimes(client, [0n]);
    expect(times.get(0n)).toBeInstanceOf(Date);
  });

  it('fetchLogs boş aralıkta boş döner', async () => {
    const client = createRpc([anvil.url]);
    const logs = await fetchLogs(
      client, ['0x0000000000000000000000000000000000000001'], 0n, 0n,
    );
    expect(logs).toEqual([]);
  });
});
