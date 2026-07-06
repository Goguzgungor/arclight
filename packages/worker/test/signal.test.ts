import { describe, expect, it } from 'vitest';
import { HeadSignal } from '../src/signal.js';

const never = new AbortController().signal;

describe('HeadSignal', () => {
  it('önce notify sonra wait: anında döner (sinyal kaybolmaz)', async () => {
    const s = new HeadSignal();
    s.notify();
    const t0 = Date.now();
    await s.wait(5_000, never);
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it('bekleyen wait notify ile uyanır', async () => {
    const s = new HeadSignal();
    const t0 = Date.now();
    setTimeout(() => s.notify(), 50);
    await s.wait(5_000, never);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it('sinyal yoksa timeout ile döner', async () => {
    const s = new HeadSignal();
    const t0 = Date.now();
    await s.wait(80, never);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
  });

  it('abort beklemeyi keser', async () => {
    const s = new HeadSignal();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 30);
    const t0 = Date.now();
    await s.wait(5_000, ctrl.signal);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("tüketilen sinyal ikinci wait'e taşmaz", async () => {
    const s = new HeadSignal();
    s.notify();
    await s.wait(1_000, never);
    const t0 = Date.now();
    await s.wait(80, never);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
  });
});
