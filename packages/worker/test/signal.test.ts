import { describe, expect, it } from 'vitest';
import { HeadSignal } from '../src/signal.js';

const never = new AbortController().signal;

describe('HeadSignal', () => {
  it('notify before wait: returns immediately (the signal is not lost)', async () => {
    const s = new HeadSignal();
    s.notify();
    const t0 = Date.now();
    await s.wait(5_000, never);
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it('a pending wait wakes up on notify', async () => {
    const s = new HeadSignal();
    const t0 = Date.now();
    setTimeout(() => s.notify(), 50);
    await s.wait(5_000, never);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it('returns via timeout when there is no signal', async () => {
    const s = new HeadSignal();
    const t0 = Date.now();
    await s.wait(80, never);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
  });

  it('abort cuts the wait short', async () => {
    const s = new HeadSignal();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 30);
    const t0 = Date.now();
    await s.wait(5_000, ctrl.signal);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it('a consumed signal does not carry over to a second wait', async () => {
    const s = new HeadSignal();
    s.notify();
    await s.wait(1_000, never);
    const t0 = Date.now();
    await s.wait(80, never);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
  });

  it('a primary announcement becomes the hot-path target; a secondary does not, both wake waiters', () => {
    const s = new HeadSignal();
    s.notify({ number: 10n, timestamp: new Date(1000) }, false); // secondary
    expect(s.latestPrimaryHead()).toBeNull();
    s.notify({ number: 11n, timestamp: new Date(2000) }, true);
    expect(s.latestPrimaryHead()?.number).toBe(11n);
  });

  it('the primary head never moves backwards (max wins)', () => {
    const s = new HeadSignal();
    s.notify({ number: 20n, timestamp: new Date(1000) }, true);
    s.notify({ number: 19n, timestamp: new Date(900) }, true); // stale announcement arriving late
    expect(s.latestPrimaryHead()?.number).toBe(20n);
  });

  it('timestamps of all announcements are written to the block-time cache', () => {
    const s = new HeadSignal();
    s.notify({ number: 5n, timestamp: new Date(5000) }, false);
    s.notify({ number: 6n, timestamp: new Date(6000) }, true);
    expect(s.blockTimes().get(5n)?.getTime()).toBe(5000);
    expect(s.blockTimes().get(6n)?.getTime()).toBe(6000);
  });

  it('a payload-less notify only wakes waiters, it does not change the target', async () => {
    const s = new HeadSignal();
    s.notify({ number: 7n, timestamp: new Date(7000) }, true);
    s.notify();
    expect(s.latestPrimaryHead()?.number).toBe(7n);
    await s.wait(1_000, never); // latch is set — returns immediately
  });
});
