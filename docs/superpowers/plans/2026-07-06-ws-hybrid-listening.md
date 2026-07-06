# WS-Hibrit Dinleme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worker, sağlıklı bir WebSocket RPC ucu varsa `eth_subscribe(newHeads)` ile yeni blok sinyalinde anında tur atar; polling `intervalMs` güvenlik ağı olarak kalır; okumalar da mümkünse WS transport üzerinden gider.

**Architecture:** `network.rpc` listesi ws(s):// URL kabul eder. rpc.ts URL'leri şemaya göre ayırır, ws uçlarını viem `webSocket` transport olarak fallback havuzuna katar. Yeni `ws.ts` ham WebSocket ile newHeads aboneliği açar (backoff'lu reconnect), `signal.ts`'teki `HeadSignal` latch'ini tetikler; `runLoop` boşta sabit uyku yerine "sinyal VEYA intervalMs" bekler. Yazma yolu (cursor + finalized + tek tx) değişmez.

**Tech Stack:** TypeScript 5 / Node 22 (global `WebSocket`), viem ^2.31.3 (`webSocket` transport), zod, vitest, anvil (WS aynı portta).

**Spec:** `docs/superpowers/specs/2026-07-06-ws-hybrid-listening-design.md`

## Global Constraints

- Finalized-only sözleşmesi değişmez; tip event'leri DB'ye yazılmaz; `eth_subscribe('logs')` kullanılmaz.
- ws URL yoksa davranış bugünküyle birebir aynı (salt polling); mevcut CR'lar değişmeden çalışır.
- WS kopması Degraded fazı YAPMAZ; sadece `arclight_ws_connected=0`.
- Kod/log/yorum dili Türkçe, mevcut üslupla uyumlu; ESM importlarda `.js` uzantısı.
- Her task sonunda `pnpm --filter <pkg> vitest run` yeşil olmalı (worker testleri Foundry/anvil ister).
- Çalışma dalı: `ws-hybrid-listening` (Task 1'in ilk adımında oluşturulur).

---

### Task 1: core — rpc URL şeması http(s)/ws(s) kısıtı

**Files:**
- Modify: `packages/core/src/config.ts:15` (rpc alanı) — üstüne export'lu şema ekle
- Modify: `packages/core/src/crd.ts:11` (rpc alanı)
- Test: `packages/core/test/crd.test.ts` (yeni case'ler)

**Interfaces:**
- Produces: `RpcUrlSchema` (zod string şeması, `packages/core/src/config.ts`'ten export; `@arclight/core` index'ine ekleme GEREKMEZ — sadece config/crd içinde kullanılır).

- [ ] **Step 1: Dal oluştur**

```bash
git checkout -b ws-hybrid-listening
```

- [ ] **Step 2: Başarısız testleri yaz**

`packages/core/test/crd.test.ts` içine, mevcut describe bloğuna ekle (dosyada geçerli bir spec üreten yardımcı varsa onu kullan; yoksa aşağıdaki gibi mevcut geçerli spec objesini kopyalayıp `network.rpc`'yi değiştir):

```ts
it('rpc: ws:// ve wss:// URL kabul edilir', () => {
  const spec = makeValidSpec(); // dosyadaki mevcut geçerli spec üreticisi/objesi
  spec.network.rpc = ['wss://arc-testnet.drpc.org', 'ws://anvil:8545', 'https://x.example'];
  expect(IndexerSpecSchema.safeParse(spec).success).toBe(true);
});

it('rpc: http/ws dışı şema reddedilir', () => {
  const spec = makeValidSpec();
  spec.network.rpc = ['ftp://kotu.example'];
  const r = IndexerSpecSchema.safeParse(spec);
  expect(r.success).toBe(false);
});
```

- [ ] **Step 3: Testin kırmızı olduğunu doğrula**

Run: `corepack pnpm --filter @arclight/core vitest run test/crd.test.ts`
Beklenen: `ftp://` testi FAIL (z.string().url() ftp'yi de kabul ediyor).

- [ ] **Step 4: Şemayı uygula**

`packages/core/src/config.ts` — dosyanın üstüne (import'lardan sonra):

```ts
// rpc uçları: http(s) polling/okuma, ws(s) abonelik + okuma
export const RpcUrlSchema = z
  .string()
  .url()
  .refine(
    (u) => /^(https?|wss?):\/\//i.test(u),
    'rpc URL şeması http(s):// veya ws(s):// olmalı',
  );
```

Aynı dosyada `rpc: z.array(z.string().url()).min(1)` → `rpc: z.array(RpcUrlSchema).min(1)`.

`packages/core/src/crd.ts` — `import ... from './config.js'` satırına `RpcUrlSchema` ekle ve `rpc: z.array(z.string().url()).min(1)` → `rpc: z.array(RpcUrlSchema).min(1)`.

- [ ] **Step 5: Testlerin yeşil olduğunu doğrula**

Run: `corepack pnpm --filter @arclight/core build && corepack pnpm --filter @arclight/core vitest run`
Beklenen: tümü PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): rpc URL şeması http(s)/ws(s) ile sınırlandı"
```

---

### Task 2: worker rpc.ts — splitRpcUrls, ws sağlık kontrolü, ws transport havuzu

**Files:**
- Modify: `packages/worker/src/rpc.ts`
- Modify: `packages/worker/test/helpers/anvil.ts` (wsUrl alanı)
- Test: `packages/worker/test/rpc.test.ts`

**Interfaces:**
- Produces:
  - `splitRpcUrls(urls: string[]): { http: string[]; ws: string[] }`
  - `wsChainId(url: string, timeoutMs?: number): Promise<number>` (export — Task 4 testi ve preflight referansı için)
  - `filterHealthyRpcs(urls, expectedChainId)` artık ws URL'leri de kontrol eder (imza aynı)
  - `createRpc(urls)` ws uçlarını `webSocket` transport olarak havuza katar (imza aynı)
  - `AnvilHandle.wsUrl: string`

- [ ] **Step 1: anvil helper'a wsUrl ekle**

`packages/worker/test/helpers/anvil.ts`:

```ts
export interface AnvilHandle {
  url: string;
  wsUrl: string;
  stop: () => void;
}
```

ve `startAnvil` içinde:

```ts
const url = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}`;
```

`return { url, stop: ... }` → `return { url, wsUrl, stop: ... }` (fonksiyondaki iki return de).

- [ ] **Step 2: Başarısız testleri yaz**

`packages/worker/test/rpc.test.ts` describe bloğuna ekle:

```ts
it('splitRpcUrls: şemaya göre ayırır', async () => {
  const { splitRpcUrls } = await import('../src/rpc.js');
  expect(
    splitRpcUrls(['https://a.example', 'ws://b.example', 'wss://c.example', 'http://d.example']),
  ).toEqual({ http: ['https://a.example', 'http://d.example'], ws: ['ws://b.example', 'wss://c.example'] });
});

it('filterHealthyRpcs: ws ucu da chainId ile doğrulanır', async () => {
  const healthy = await filterHealthyRpcs(
    ['ws://127.0.0.1:1', anvil.wsUrl, anvil.url], 31337,
  );
  expect(healthy).toEqual([anvil.wsUrl, anvil.url]);
});

it('createRpc: ws ucu üzerinden okuma çalışır', async () => {
  const client = createRpc([anvil.wsUrl]);
  const n = await getFinalizedBlockNumber(client, 'latest');
  expect(n).toBeGreaterThanOrEqual(0n);
});
```

(Üstteki dinamik import yerine dosya başındaki import listesine `splitRpcUrls` eklenebilir — tercih edilen bu.)

- [ ] **Step 3: Kırmızıyı doğrula**

Run: `corepack pnpm --filter @arclight/worker vitest run test/rpc.test.ts`
Beklenen: FAIL — `splitRpcUrls` export'u yok.

- [ ] **Step 4: Uygula**

`packages/worker/src/rpc.ts` — import satırını genişlet ve şu fonksiyonları ekle:

```ts
import {
  createPublicClient, fallback, http, webSocket,
  type Log, type PublicClient,
} from 'viem';

export interface RpcUrlGroups {
  http: string[];
  ws: string[];
}

export function splitRpcUrls(urls: string[]): RpcUrlGroups {
  const groups: RpcUrlGroups = { http: [], ws: [] };
  for (const u of urls) {
    (u.startsWith('ws://') || u.startsWith('wss://') ? groups.ws : groups.http).push(u);
  }
  return groups;
}

// Ham WebSocket ile tek seferlik eth_chainId — viem transport'u açık soket
// bırakmasın diye sağlık kontrolünde kullanılır.
export function wsChainId(url: string, timeoutMs = 5_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    const fail = (msg: string) => {
      clearTimeout(timer);
      sock.close();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail(`ws chainId zaman aşımı: ${url}`), timeoutMs);
    sock.onopen = () =>
      sock.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }));
    sock.onmessage = (ev) => {
      clearTimeout(timer);
      sock.close();
      const body = JSON.parse(String(ev.data)) as { result?: string };
      if (body.result) resolve(Number(body.result));
      else reject(new Error(`eth_chainId sonuç dönmedi: ${url}`));
    };
    sock.onerror = () => fail(`ws bağlantı hatası: ${url}`);
  });
}
```

`createRpc`'yi değiştir:

```ts
export function createRpc(urls: string[]): PublicClient {
  const { http: httpUrls, ws: wsUrls } = splitRpcUrls(urls);
  return createPublicClient({
    transport: fallback(
      [
        ...wsUrls.map((u) => webSocket(u, { timeout: 10_000, retryCount: 2 })),
        ...httpUrls.map((u) => http(u, { timeout: 10_000, retryCount: 2 })),
      ],
      { rank: true },
    ),
  });
}
```

`filterHealthyRpcs` içindeki map callback'ini değiştir:

```ts
export async function filterHealthyRpcs(
  urls: string[],
  expectedChainId: number,
): Promise<string[]> {
  const checks = await Promise.all(
    urls.map(async (url) => {
      try {
        if (url.startsWith('ws://') || url.startsWith('wss://')) {
          return (await wsChainId(url)) === expectedChainId ? url : null;
        }
        const client = createPublicClient({ transport: http(url, { timeout: 5_000, retryCount: 0 }) });
        return (await client.getChainId()) === expectedChainId ? url : null;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((u): u is string => u !== null);
}
```

- [ ] **Step 5: Yeşili doğrula**

Run: `corepack pnpm --filter @arclight/worker vitest run test/rpc.test.ts`
Beklenen: tümü PASS. Not: viem `webSocket` transport'u açık soket bırakabilir; test dosyası zaten `afterAll(() => anvil.stop())` yapıyor, süreç kapanmazsa vitest `forks` havuzu yine sonlanır — sorun görülürse `createRpc` testine `{ pollingInterval: 0 }` gerekmez, anvil.stop() yeterli.

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/rpc.ts packages/worker/test
git commit -m "feat(worker): rpc havuzuna ws transport, ws sağlık kontrolü ve splitRpcUrls"
```

---

### Task 3: worker — HeadSignal latch'i

**Files:**
- Create: `packages/worker/src/signal.ts`
- Test: `packages/worker/test/signal.test.ts` (yeni dosya)

**Interfaces:**
- Produces: `class HeadSignal { notify(): void; wait(ms: number, signal: AbortSignal): Promise<void> }`
  - `notify()`: bekleyen varsa hemen uyandırır; yoksa bayrak koyar (sinyal kaybolmaz).
  - `wait()`: bayrak varsa anında döner; yoksa sinyal/timeout/abort'tan ilkinde döner.

- [ ] **Step 1: Başarısız testleri yaz**

`packages/worker/test/signal.test.ts`:

```ts
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

  it('tüketilen sinyal ikinci wait\'e taşmaz', async () => {
    const s = new HeadSignal();
    s.notify();
    await s.wait(1_000, never);
    const t0 = Date.now();
    await s.wait(80, never);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
  });
});
```

- [ ] **Step 2: Kırmızıyı doğrula**

Run: `corepack pnpm --filter @arclight/worker vitest run test/signal.test.ts`
Beklenen: FAIL — `../src/signal.js` yok.

- [ ] **Step 3: Uygula**

`packages/worker/src/signal.ts`:

```ts
// newHeads sinyali ile pipeline uyanışı arasındaki latch: bekleyen yokken gelen
// sinyal bayrak olarak saklanır, art arda N sinyal tek uyanışa yol açar.
export class HeadSignal {
  private flagged = false;
  private waiter: (() => void) | null = null;

  notify(): void {
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      w();
    } else {
      this.flagged = true;
    }
  }

  wait(ms: number, signal: AbortSignal): Promise<void> {
    if (this.flagged || signal.aborted) {
      this.flagged = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        this.waiter = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener('abort', done, { once: true });
      this.waiter = done;
    });
  }
}
```

- [ ] **Step 4: Yeşili doğrula**

Run: `corepack pnpm --filter @arclight/worker vitest run test/signal.test.ts`
Beklenen: 5 test PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/signal.ts packages/worker/test/signal.test.ts
git commit -m "feat(worker): HeadSignal latch'i — sinyal-veya-timeout bekleyişi"
```

---

### Task 4: worker — subscribeNewHeads (ws.ts)

**Files:**
- Create: `packages/worker/src/ws.ts`
- Test: `packages/worker/test/ws.test.ts` (yeni dosya)

**Interfaces:**
- Consumes: `AnvilHandle.wsUrl` (Task 2).
- Produces:
  ```ts
  interface NewHeadsSubscription { close(): void }
  function subscribeNewHeads(opts: {
    wsUrls: string[];
    onHead: () => void;
    onStateChange: (connected: boolean) => void;
    log: Logger;              // pino Logger
  }): NewHeadsSubscription
  ```
  Davranış: ilk URL'den bağlanır, `eth_subscribe(newHeads)` açar, açılınca `onStateChange(true)`; her bildirimde `onHead()`; kopunca `onStateChange(false)` + üstel backoff (1sn→30sn) ile sıradaki URL; `close()` her şeyi durdurur.

- [ ] **Step 1: Başarısız testleri yaz**

`packages/worker/test/ws.test.ts`:

```ts
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
      onHead: () => { heads += 1; },
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
```

- [ ] **Step 2: Kırmızıyı doğrula**

Run: `corepack pnpm --filter @arclight/worker vitest run test/ws.test.ts`
Beklenen: FAIL — `../src/ws.js` yok.

- [ ] **Step 3: Uygula**

`packages/worker/src/ws.ts`:

```ts
import type { Logger } from 'pino';

export interface NewHeadsSubscription {
  close(): void;
}

// Ham WebSocket ile newHeads aboneliği: viem'in transport'u bağlantı durumunu
// dışarı vermiyor; reconnect ve gauge için duruma ihtiyacımız var.
export function subscribeNewHeads(opts: {
  wsUrls: string[];
  onHead: () => void;
  onStateChange: (connected: boolean) => void;
  log: Logger;
}): NewHeadsSubscription {
  let closed = false;
  let attempt = 0;
  let sock: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = (idx: number): void => {
    if (closed) return;
    const url = opts.wsUrls[idx % opts.wsUrls.length]!;
    sock = new WebSocket(url);
    sock.onopen = () => {
      sock?.send(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }),
      );
    };
    sock.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; method?: string };
      if (msg.id === 1) {
        attempt = 0;
        opts.onStateChange(true);
        opts.log.info({ url }, 'newHeads aboneliği açıldı');
      } else if (msg.method === 'eth_subscription') {
        opts.onHead();
      }
    };
    sock.onclose = () => {
      if (closed) return;
      opts.onStateChange(false);
      const delayMs = Math.min(1_000 * 2 ** attempt, 30_000);
      attempt += 1;
      opts.log.warn({ url, delayMs }, 'WS koptu — yeniden bağlanılacak');
      retryTimer = setTimeout(() => connect(idx + 1), delayMs);
    };
    sock.onerror = () => {
      // hata her zaman close ile izlenir; reconnect'i onclose yönetir
    };
  };

  connect(0);
  return {
    close(): void {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      sock?.close();
    },
  };
}
```

- [ ] **Step 4: Yeşili doğrula**

Run: `corepack pnpm --filter @arclight/worker vitest run test/ws.test.ts`
Beklenen: 2 test PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/ws.ts packages/worker/test/ws.test.ts
git commit -m "feat(worker): newHeads WS aboneliği — backoff'lu reconnect ve durum bildirimi"
```

---

### Task 5: worker — metrics, runLoop bekleyişi ve main kablolama

**Files:**
- Modify: `packages/worker/src/metrics.ts` (2 yeni metrik)
- Modify: `packages/worker/src/pipeline.ts` (`PipelineDeps.headSignal`, runLoop bekleyişi)
- Modify: `packages/worker/src/main.ts` (abonelik kablolama)
- Test: `packages/worker/test/pipeline.test.ts` (deps güncellemesi + yeni test)

**Interfaces:**
- Consumes: `HeadSignal` (Task 3), `subscribeNewHeads` (Task 4), `splitRpcUrls` (Task 2).
- Produces: `PipelineDeps.headSignal: HeadSignal` (zorunlu alan); `Metrics.wsConnected: Gauge`, `Metrics.headNotifications: Counter`.

- [ ] **Step 1: Başarısız testi yaz**

`packages/worker/test/pipeline.test.ts` içinde `PipelineDeps` kuran yere `headSignal: new HeadSignal()` ekle (import: `import { HeadSignal } from '../src/signal.js';`) ve describe bloğuna şu testi ekle:

```ts
it('runLoop: boştayken headSignal.notify() intervalMs beklemeden yeni tur başlatır', async () => {
  // deps: bu dosyada mevcut şekilde kurulan, boş aralıkta progressed=false dönen deps
  const headSignal = new HeadSignal();
  const localDeps = { ...deps, headSignal, cfg: { ...deps.cfg, polling: { ...deps.cfg.polling, intervalMs: 60_000 } } };
  const ctrl = new AbortController();
  const loop = runLoop(localDeps, ctrl.signal);
  await new Promise((r) => setTimeout(r, 300)); // ilk tur atılsın, boşa düşsün
  const t0 = Date.now();
  headSignal.notify();
  await new Promise((r) => setTimeout(r, 500)); // sinyalle tur atması için pay
  ctrl.abort();
  await loop;
  expect(Date.now() - t0).toBeLessThan(60_000); // intervalMs dolmadan döngü ilerledi ve abort ile kapandı
});
```

Not: dosyadaki mevcut deps kurulumunun adı/şekli neyse ona uy; test tur sayacı tutuyorsa (ör. runOnce çağrılarını sayan sahte client) `notify` sonrası sayacın arttığını asıl doğrulama olarak kullan:
`expect(turSayaci).toBeGreaterThanOrEqual(2)`.

- [ ] **Step 2: Kırmızıyı doğrula**

Run: `corepack pnpm --filter @arclight/worker vitest run test/pipeline.test.ts`
Beklenen: FAIL — `PipelineDeps`'te `headSignal` alanı yok (tip hatası) ya da runLoop sinyali dinlemiyor.

- [ ] **Step 3: Uygula**

`packages/worker/src/metrics.ts` — `writeLatency`'den önce ekle:

```ts
wsConnected: new Gauge({
  name: 'arclight_ws_connected',
  help: 'newHeads WS aboneliği bağlı mı (0/1)',
  registers: [registry],
}),
headNotifications: new Counter({
  name: 'arclight_head_notifications_total',
  help: 'alınan newHeads bildirimi sayısı',
  registers: [registry],
}),
```

`packages/worker/src/pipeline.ts`:
- import ekle: `import type { HeadSignal } from './signal.js';`
- `PipelineDeps`'e alan ekle: `headSignal: HeadSignal;`
- `runLoop` içinde `if (!progressed) await sleep(deps.cfg.polling.intervalMs, signal);` → `if (!progressed) await deps.headSignal.wait(deps.cfg.polling.intervalMs, signal);`
- `sleep` yardımcı fonksiyonu hata backoff'unda kullanılmaya devam eder — DOKUNMA.

`packages/worker/src/main.ts`:
- import ekle:
  ```ts
  import { createRpc, filterHealthyRpcs, splitRpcUrls } from './rpc.js';
  import { HeadSignal } from './signal.js';
  import { subscribeNewHeads } from './ws.js';
  ```
- `const deps: PipelineDeps = { ... }` bloğuna `headSignal` ekle:
  ```ts
  const headSignal = new HeadSignal();
  const deps: PipelineDeps = {
    client: createRpc(rpcs),
    pool,
    cfg,
    defs,
    schema: schemaName(cfg.indexerName),
    metrics,
    phase,
    headSignal,
    log,
  };
  ```
- `await bootstrapIndexer(deps);` satırından sonra aboneliği kur:
  ```ts
  const { ws: wsUrls } = splitRpcUrls(rpcs);
  const subscription = wsUrls.length
    ? subscribeNewHeads({
        wsUrls,
        onHead: () => {
          metrics.headNotifications.inc();
          headSignal.notify();
        },
        onStateChange: (connected) => metrics.wsConnected.set(connected ? 1 : 0),
        log,
      })
    : null;
  if (!wsUrls.length) log.info('ws RPC ucu yok — salt polling modu');
  ```
- `await runLoop(deps, ctrl.signal);` satırından sonra: `subscription?.close();`

- [ ] **Step 4: Yeşili doğrula (tüm worker testleri)**

Run: `corepack pnpm --filter @arclight/worker build && corepack pnpm --filter @arclight/worker vitest run`
Beklenen: tümü PASS (Docker + Foundry gerektirir).

- [ ] **Step 5: Commit**

```bash
git add packages/worker
git commit -m "feat(worker): newHeads sinyaliyle anında tur — polling güvenlik ağına dönüştü"
```

---

### Task 6: CRD yaml, e2e manifest, preflight ve dokümantasyon

**Files:**
- Modify: `charts/arclight/crds/indexer.yaml` (rpc items pattern + description)
- Modify: `e2e/manifests/demo-indexer.yaml` (ws URL)
- Modify: `packages/worker/scripts/arc-preflight.ts` (ws chainId kontrolü)
- Modify: `README.md` (mimari satırı + gözlemlenebilirlik metrikleri)
- Modify: `docs/superpowers/specs/2026-07-03-arclight-mvp-design.md` (yol haritası notu)

**Interfaces:**
- Consumes: `wsChainId` davranışının aynısı (preflight kendi kopyasını taşır — script bağımsızdır).

- [ ] **Step 1: CRD şemasını güncelle**

`charts/arclight/crds/indexer.yaml` içinde:

```yaml
rpc:
  type: array
  minItems: 1
  items:
    type: string
```

→

```yaml
rpc:
  type: array
  minItems: 1
  items:
    type: string
    pattern: '^(https?|wss?)://'
    description: "http(s):// polling/okuma; ws(s):// newHeads aboneliği + okuma"
```

Doğrula: `helm lint charts/arclight` → hata yok. Cluster'a elle uygula (README'deki kural — Helm CRD'yi sadece ilk kurulumda uygular):

```bash
kubectl apply -f charts/arclight/crds/indexer.yaml
```

- [ ] **Step 2: e2e demo manifest'ine ws ucu ekle**

`e2e/manifests/demo-indexer.yaml`:

```yaml
network:
  chainId: 31337
  rpc: ["ws://anvil:8545", "http://anvil:8545"]
  finalityTag: latest
```

- [ ] **Step 3: preflight'a ws kontrolü ekle**

`packages/worker/scripts/arc-preflight.ts` sonuna ekle (script bağımsızdır, yardımcıyı kendi taşır):

```ts
const wsUrl = process.env['ARC_WS_URL'];
if (wsUrl) {
  const wsChainId = await new Promise<number>((resolve, reject) => {
    const sock = new WebSocket(wsUrl);
    const timer = setTimeout(() => { sock.close(); reject(new Error('ws zaman aşımı')); }, 5_000);
    sock.onopen = () =>
      sock.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }));
    sock.onmessage = (ev) => {
      clearTimeout(timer);
      sock.close();
      const body = JSON.parse(String(ev.data)) as { result?: string };
      body.result ? resolve(Number(body.result)) : reject(new Error('eth_chainId sonuçsuz'));
    };
    sock.onerror = () => { clearTimeout(timer); sock.close(); reject(new Error('ws bağlantı hatası')); };
  });
  console.log(
    `ws chainId: ${wsChainId} (beklenen ${EXPECTED_CHAIN_ID}) → ${wsChainId === EXPECTED_CHAIN_ID ? 'OK' : 'UYUŞMAZLIK'}`,
  );
} else {
  console.log('ARC_WS_URL verilmedi — WS probu atlandı');
}
```

- [ ] **Step 4: README ve MVP doc güncelle**

`README.md`:
- Mimari şemadaki `Arc RPC'ler ──finalized'a kadar poll──▶ [ Worker ]` satırını
  `Arc RPC'ler ──WS newHeads + poll fallback──▶ [ Worker ]` yap.
- Gözlemlenebilirlik listesine `arclight_ws_connected`, `arclight_head_notifications_total` ekle.
- Quickstart'a bir cümle: `rpc` listesine `wss://` ucu eklersen worker yeni bloğu anında görür; yoksa `intervalMs` polling'i geçerlidir.

`docs/superpowers/specs/2026-07-03-arclight-mvp-design.md` §9/v1.1 satırındaki
"WebSocket düşük-gecikme tip takibi" maddesine not düş:
`(newHeads-tetikleyici kısmı öne çekildi — bkz. 2026-07-06-ws-hybrid-listening-design.md)`.

- [ ] **Step 5: Lint + tüm testler**

Run: `corepack pnpm lint && corepack pnpm -r build && corepack pnpm --filter @arclight/core vitest run && corepack pnpm --filter @arclight/operator vitest run`
Beklenen: hepsi yeşil.

- [ ] **Step 6: Commit**

```bash
git add charts e2e packages/worker/scripts README.md docs
git commit -m "feat: CRD/e2e/preflight/docs — rpc listesinde ws(s) uçları"
```

---

### Task 7: k3d cluster'ında uçtan uca doğrulama

**Files:** (kod değişikliği yok — doğrulama)

**Interfaces:**
- Consumes: Task 1-6'nın tamamı; çalışan k3d `mycluster` (operatör + anvil + postgres kurulu).

- [ ] **Step 1: Worker image'ını yeniden build et ve import et**

```bash
docker build --target worker -t arclight-worker:dev .
k3d image import arclight-worker:dev -c mycluster
```

- [ ] **Step 2: Yeni CRD şemasını ve demo Indexer'ı uygula, worker'ı yenile**

```bash
kubectl apply -f charts/arclight/crds/indexer.yaml
kubectl apply -f e2e/manifests/demo-indexer.yaml
kubectl delete pod -l app=arclight-demo 2>/dev/null || kubectl delete pod -l arclight.dev/indexer=demo 2>/dev/null || kubectl rollout restart deploy/arclight-demo
kubectl rollout status deploy/arclight-demo --timeout=120s
```

(Worker Deployment'ının pod label'ı hangisiyse onu kullan — `kubectl get deploy arclight-demo -o jsonpath='{.spec.selector.matchLabels}'` ile bak.)

- [ ] **Step 3: WS bağlantısını ve anında tepkiyi doğrula**

```bash
kubectl port-forward deploy/arclight-demo 9090:9090 &
sleep 2
curl -s http://127.0.0.1:9090/metrics | grep -E 'arclight_ws_connected|arclight_head_notifications_total'
```

Beklenen: `arclight_ws_connected{indexer="demo"} 1` ve head sayacı artıyor (anvil 1 sn blok üretiyor).
Ek doğrulama: `kubectl get indexers` → `PHASE=Live`, `LAG=0`.

- [ ] **Step 4: Fallback'i doğrula (WS yok → salt polling)**

`e2e/manifests/demo-indexer.yaml`'daki rpc'yi geçici `["http://anvil:8545"]` yapıp apply et; worker pod'unu yenile; `arclight_ws_connected` metriği hiç yayınlanmamalı ya da 0 kalmalı ve `PHASE=Live` sürmeli. Sonra ws'li halini geri uygula.

- [ ] **Step 5: Commit yok — sonuçları raporla**

Doğrulama çıktısı (metrik satırları + `kubectl get indexers`) final rapora eklenir.
