import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { subscribeNewHeads } from '../src/ws.js';
import { startAnvil, type AnvilHandle } from './helpers/anvil.js';

const log = pino({ level: 'silent' });

const until = async (cond: () => boolean, ms = 10_000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('condition timed out');
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

  it('when a new block is mined, onHead fires with a payload (number+timestamp)', async () => {
    const heads: { number: bigint; timestamp: Date }[] = [];
    let primaryFlag: boolean | null = null;
    const states: boolean[] = [];
    const sub = subscribeNewHeads({
      wsUrls: [anvil.wsUrl],
      onHead: (head, primary) => {
        if (head) heads.push(head);
        primaryFlag = primary;
      },
      onStateChange: (c) => states.push(c),
      log,
    });
    await until(() => states.includes(true));
    await mine(anvil.url);
    await until(() => heads.length >= 1);
    sub.close();
    expect(heads[0]!.number).toBeGreaterThan(0n);
    expect(heads[0]!.timestamp.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(primaryFlag).toBe(true);
  });

  it('subscribes to two endpoints in parallel; announcements from the second arrive with primary=false', async () => {
    const second = await startAnvil();
    const seen: boolean[] = [];
    const sub = subscribeNewHeads({
      wsUrls: [anvil.wsUrl, second.wsUrl],
      onHead: (_head, primary) => seen.push(primary),
      onStateChange: () => {},
      log,
    });
    await new Promise((r) => setTimeout(r, 500)); // let both subscriptions open
    await mine(second.url);
    await until(() => seen.includes(false));
    sub.close();
    second.stop();
    expect(seen).toContain(false);
  });

  it('when the server dies, onStateChange(false) is delivered', async () => {
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
