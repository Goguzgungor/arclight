import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { subscribeNewHeads } from '../src/ws.js';
import { startAnvil, type AnvilHandle } from './helpers/anvil.js';

const log = pino({ level: 'silent' });

const until = async (cond: () => boolean, ms = 10_000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('koşul zaman aşımı');
    await new Promise((r) => setTimeout(r, 50));
  }
};

const mine = (url: string) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_mine', params: [] }),
  });

describe('subscribeNewHeads', () => {
  let anvil: AnvilHandle;
  beforeAll(async () => {
    anvil = await startAnvil();
  });
  afterAll(() => anvil.stop());

  it('yeni blok kazılınca onHead tetiklenir, bağlanınca onStateChange(true)', async () => {
    let heads = 0;
    const states: boolean[] = [];
    const sub = subscribeNewHeads({
      wsUrls: [anvil.wsUrl],
      onHead: () => {
        heads += 1;
      },
      onStateChange: (c) => states.push(c),
      log,
    });
    await until(() => states.includes(true));
    await mine(anvil.url);
    await until(() => heads >= 1);
    sub.close();
    expect(heads).toBeGreaterThanOrEqual(1);
  });

  it('sunucu ölünce onStateChange(false) gelir', async () => {
    const local = await startAnvil();
    const states: boolean[] = [];
    const sub = subscribeNewHeads({
      wsUrls: [local.wsUrl],
      onHead: () => {},
      onStateChange: (c) => states.push(c),
      log,
    });
    await until(() => states.includes(true));
    local.stop();
    await until(() => states.includes(false));
    sub.close();
    expect(states.at(-1)).toBe(false);
  });
});
