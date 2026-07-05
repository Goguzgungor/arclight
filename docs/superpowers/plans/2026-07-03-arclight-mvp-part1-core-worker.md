# Arclight MVP — Part 1: Core + Worker (M0–M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arc için gap-free, idempotent, RPC-failover'lı bir TypeScript event-indexer worker'ı — operatörsüz, docker-compose ile çalışır ve test edilir durumda.

**Architecture:** pnpm monorepo; `@arclight/core` saf fonksiyonlar (ABI→DDL, decode, range planlama, config şeması), `@arclight/worker` I/O katmanı (viem RPC + pg). Cursor yalnızca batch commit'iyle tek transaction'da ilerler; yazım `ON CONFLICT DO NOTHING` ile idempotent. Operatör (Part 2) worker'ı yalnızca config dosyası + env ile sürer.

**Tech Stack:** Node 22 LTS, TypeScript 5.x (ESM/NodeNext), pnpm workspaces, viem, pg, zod, pino, prom-client, vitest, @testcontainers/postgresql, anvil (Foundry).

**Spec:** `docs/superpowers/specs/2026-07-03-arclight-mvp-design.md` (Part 2 planı M3–M5'i kapsayacak; Part 1 bitince yazılır.)

## Global Constraints

- Node >= 22, `"type": "module"`, TS `module: NodeNext`, `strict: true`.
- Paket adları: `@arclight/core`, `@arclight/worker`; worker core'a `workspace:*` ile bağlanır.
- DB adlandırma: şema `idx_<indexer>`, tablo `<contract>_<event>` (snake_case); overload'da tablo adına topic0'ın ilk 4 hex'i eklenir.
- Ortak kolonlar: `block_number bigint, block_hash text, block_time timestamptz, tx_hash text, tx_index integer, log_index integer, contract_address text`; `UNIQUE (block_number, tx_hash, log_index)`.
- Tip eşleme: `address→text(lowercase)` · `uintN/intN→numeric(78,0)` · `bool→boolean` · `bytes/bytesN→bytea` · `string→text` · `tuple/dizi→jsonb`.
- DSN yalnızca `DATABASE_URL` env'inden gelir (config dosyasına yazılmaz — Secret ayrımı).
- Metrik adları: `arclight_blocks_behind`, `arclight_last_processed_block`, `arclight_events_ingested_total`, `arclight_rpc_errors_total`, `arclight_dead_letter_total`, `arclight_write_latency_seconds`.
- Fazlar: `Provisioning → Backfilling → Live → Degraded`.
- Geliştirme makinesinde Docker (testcontainers için) ve Foundry (`anvil`, `forge`) kurulu olmalı.
- Commit mesajları conventional commits (`feat:`, `test:`, `chore:`); her task kendi commit'iyle biter.

## File Structure

```
package.json  pnpm-workspace.yaml  tsconfig.base.json  .gitignore  eslint.config.js
.github/workflows/ci.yml
packages/core/
  package.json  tsconfig.json  vitest.config.ts
  src/index.ts  src/naming.ts  src/abi.ts  src/ddl.ts  src/decode.ts  src/ranges.ts  src/config.ts
  test/naming.test.ts  test/abi.test.ts  test/ddl.test.ts  test/decode.test.ts  test/ranges.test.ts  test/config.test.ts
packages/worker/
  package.json  tsconfig.json  vitest.config.ts
  src/db.ts  src/rpc.ts  src/metrics.ts  src/status.ts  src/health.ts  src/pipeline.ts  src/main.ts
  test/db.test.ts  test/rpc.test.ts  test/health.test.ts  test/pipeline.test.ts  test/deadletter.test.ts
  test/fixtures/emitter/foundry.toml  test/fixtures/emitter/src/Emitter.sol
  test/helpers/anvil.ts
Dockerfile  docker-compose.dev.yml
manifests/demo/worker-config.json  manifests/demo/emitter-abi.json
packages/worker/scripts/demo-seed.ts
```

Sorumluluklar: `core` = I/O'suz saf mantık (iki paket de tüketir); `db.ts` = tüm SQL; `rpc.ts` = tüm zincir erişimi; `pipeline.ts` = ikisini bağlayan döngü (kendisi SQL/RPC detayı bilmez); `main.ts` = yalnızca kablolama.

---

### Task 1: Monorepo iskeleti (M0)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `eslint.config.js`, `.github/workflows/ci.yml`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`
- Create: `packages/worker/package.json`, `packages/worker/tsconfig.json`, `packages/worker/vitest.config.ts`
- Test: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Produces: çalışan `pnpm install` / `pnpm -r build` / `pnpm -r test` komutları; sonraki tüm task'lar bu iskelete dosya ekler.

- [ ] **Step 1: Kök dosyaları yaz**

`package.json`:
```json
{
  "name": "arclight",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.12.1",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "eslint ."
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "eslint": "^9.29.0",
    "typescript": "^5.8.3",
    "typescript-eslint": "^8.34.0",
    "vitest": "^3.2.4"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
*.tsbuildinfo
packages/worker/test/fixtures/emitter/out/
packages/worker/test/fixtures/emitter/cache/
```

`eslint.config.js`:
```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/fixtures/**'] },
  ...tseslint.configs.recommended,
);
```

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: foundry-rs/foundry-toolchain@v1
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm -r build
      - run: pnpm -r test
```

- [ ] **Step 2: Paket manifestlerini yaz**

`packages/core/package.json`:
```json
{
  "name": "@arclight/core",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": {
    "viem": "^2.31.3",
    "zod": "^3.25.76"
  }
}
```

`packages/core/tsconfig.json` (`composite` worker'ın project reference'ı için gerekli):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "composite": true },
  "include": ["src"]
}
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

`packages/core/src/index.ts` (şimdilik boş export; her task kendi export'unu ekler):
```ts
export {};
```

`packages/worker/package.json`:
```json
{
  "name": "@arclight/worker",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": {
    "@arclight/core": "workspace:*",
    "pg": "^8.16.0",
    "pino": "^9.7.0",
    "prom-client": "^15.1.3",
    "viem": "^2.31.3",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^11.0.3",
    "@types/pg": "^8.15.4"
  }
}
```

`packages/worker/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

`packages/worker/vitest.config.ts` (testler core'un **kaynağına** alias'lanır — test için build gerekmez):
```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@arclight/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000 },
});
```


- [ ] **Step 3: Smoke test yaz**

`packages/core/test/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

describe('workspace', () => {
  it('vitest çalışıyor', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Kur ve doğrula**

Run: `pnpm install && pnpm -r build && pnpm -r test && pnpm lint`
Expected: install başarılı, build hatasız, core'da 1 test PASS, lint temiz.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: pnpm monorepo iskeleti (core + worker, vitest, eslint, ci)"
```

---

### Task 2: Adlandırma + ABI event çıkarımı (`core/naming.ts`, `core/abi.ts`) (M1)

**Files:**
- Create: `packages/core/src/naming.ts`, `packages/core/src/abi.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/naming.test.ts`, `packages/core/test/abi.test.ts`

**Interfaces:**
- Produces:
  - `toSnakeCase(input: string): string`
  - `schemaName(indexerName: string): string` — `idx_<snake>`
  - `eventTableName(contractName: string, eventName: string, overloadTopic0?: string): string`
  - `class AbiError extends Error`
  - `interface EventDef { contractName: string; address: \`0x${string}\`; event: AbiEvent; topic0: \`0x${string}\`; tableName: string }`
  - `extractEventDefs(contractName: string, address: string, abi: unknown, selectedEvents?: string[]): EventDef[]`

- [ ] **Step 1: Failing testleri yaz**

`packages/core/test/naming.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { eventTableName, schemaName, toSnakeCase } from '../src/naming.js';

describe('naming', () => {
  it('camelCase → snake_case', () => {
    expect(toSnakeCase('TransferSingle')).toBe('transfer_single');
    expect(toSnakeCase('USDCPool')).toBe('usdc_pool');
    expect(toSnakeCase('my-contract')).toBe('my_contract');
  });

  it('şema adı idx_ önekli', () => {
    expect(schemaName('usdc-arc')).toBe('idx_usdc_arc');
  });

  it('tablo adı; overload varsa topic0 eki', () => {
    expect(eventTableName('usdc', 'Transfer')).toBe('usdc_transfer');
    expect(eventTableName('usdc', 'Transfer', '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'))
      .toBe('usdc_transfer_ddf2');
  });

  it('63 bayttan uzun tanımlayıcı reddedilir', () => {
    expect(() => eventTableName('a'.repeat(60), 'VeryLongEventName')).toThrow();
  });
});
```

`packages/core/test/abi.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { AbiError, extractEventDefs } from '../src/abi.js';

const ERC20_ABI = [
  { type: 'function', name: 'transfer', inputs: [], outputs: [] },
  {
    type: 'event', name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Approval',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'spender', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
];

const ADDR = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

describe('extractEventDefs', () => {
  it('seçim yoksa tüm eventler; adres lowercase; topic0 hesaplı', () => {
    const defs = extractEventDefs('usdc', ADDR, ERC20_ABI);
    expect(defs.map((d) => d.tableName)).toEqual(['usdc_transfer', 'usdc_approval']);
    expect(defs[0]!.address).toBe(ADDR.toLowerCase());
    expect(defs[0]!.topic0).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
  });

  it('seçilen eventler filtrelenir', () => {
    const defs = extractEventDefs('usdc', ADDR, ERC20_ABI, ['Transfer']);
    expect(defs).toHaveLength(1);
  });

  it("ABI'de olmayan seçim AbiError fırlatır", () => {
    expect(() => extractEventDefs('usdc', ADDR, ERC20_ABI, ['Mint'])).toThrow(AbiError);
  });

  it('overload edilen eventler topic0 eki alır', () => {
    const abi = [
      { type: 'event', name: 'Ping', inputs: [{ name: 'a', type: 'uint256', indexed: false }] },
      { type: 'event', name: 'Ping', inputs: [{ name: 'a', type: 'address', indexed: false }] },
    ];
    const defs = extractEventDefs('x', ADDR, abi);
    expect(defs[0]!.tableName).not.toBe(defs[1]!.tableName);
    expect(defs[0]!.tableName).toMatch(/^x_ping_[0-9a-f]{4}$/);
  });
});
```

- [ ] **Step 2: Testlerin FAIL ettiğini doğrula**

Run: `pnpm --filter @arclight/core test`
Expected: FAIL — `Cannot find module '../src/naming.js'` (ve abi.js).

- [ ] **Step 3: İmplementasyonu yaz**

`packages/core/src/naming.ts`:
```ts
export class NamingError extends Error {}

export function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function assertPgIdentifier(id: string): string {
  if (Buffer.byteLength(id, 'utf8') > 63) {
    throw new NamingError(`PostgreSQL tanımlayıcısı 63 baytı aşıyor: ${id}`);
  }
  return id;
}

export function schemaName(indexerName: string): string {
  return assertPgIdentifier(`idx_${toSnakeCase(indexerName)}`);
}

export function eventTableName(
  contractName: string,
  eventName: string,
  overloadTopic0?: string,
): string {
  const base = `${toSnakeCase(contractName)}_${toSnakeCase(eventName)}`;
  return assertPgIdentifier(overloadTopic0 ? `${base}_${overloadTopic0.slice(2, 6)}` : base);
}
```

`packages/core/src/abi.ts`:
```ts
import { toEventSelector, type AbiEvent } from 'viem';
import { eventTableName } from './naming.js';

export class AbiError extends Error {}

export interface EventDef {
  contractName: string;
  address: `0x${string}`;
  event: AbiEvent;
  topic0: `0x${string}`;
  tableName: string;
}

export function extractEventDefs(
  contractName: string,
  address: string,
  abi: unknown,
  selectedEvents?: string[],
): EventDef[] {
  if (!Array.isArray(abi)) {
    throw new AbiError(`${contractName}: ABI bir JSON dizisi olmalı`);
  }
  const events = abi.filter(
    (e): e is AbiEvent => (e as { type?: string } | null)?.type === 'event',
  );
  if (selectedEvents?.length) {
    for (const name of selectedEvents) {
      if (!events.some((e) => e.name === name)) {
        throw new AbiError(`${contractName}: '${name}' event'i ABI'de yok`);
      }
    }
  }
  const wanted = selectedEvents?.length
    ? events.filter((e) => selectedEvents.includes(e.name))
    : events;
  const nameCounts = new Map<string, number>();
  for (const e of wanted) nameCounts.set(e.name, (nameCounts.get(e.name) ?? 0) + 1);
  return wanted.map((event) => {
    const topic0 = toEventSelector(event);
    const overloaded = (nameCounts.get(event.name) ?? 0) > 1;
    return {
      contractName,
      address: address.toLowerCase() as `0x${string}`,
      event,
      topic0,
      tableName: eventTableName(contractName, event.name, overloaded ? topic0 : undefined),
    };
  });
}
```

`packages/core/src/index.ts`:
```ts
export { NamingError, eventTableName, schemaName, toSnakeCase } from './naming.js';
export { AbiError, extractEventDefs, type EventDef } from './abi.js';
```

- [ ] **Step 4: Testlerin PASS ettiğini doğrula**

Run: `pnpm --filter @arclight/core test`
Expected: naming + abi testleri PASS (8 test).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): adlandırma kuralları ve ABI event çıkarımı"
```

---

### Task 3: ABI → DDL üretimi (`core/ddl.ts`) (M1)

**Files:**
- Create: `packages/core/src/ddl.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/ddl.test.ts`

**Interfaces:**
- Consumes: `EventDef` (Task 2).
- Produces:
  - `class DdlError extends Error`
  - `pgTypeFor(abiType: string): string`
  - `interface EventColumn { name: string; abiType: string; indexed: boolean }`
  - `eventColumns(event: AbiEvent): EventColumn[]` — decode (Task 4) da aynı kolon adlarını buradan alır
  - `interface TableSpec { schema: string; table: string; statements: string[] }`
  - `buildEventTable(schema: string, def: EventDef): TableSpec`
  - `buildControlTables(schema: string): string[]` — `CREATE SCHEMA` + `_cursor`, `_meta`, `_dead_letter`

- [ ] **Step 1: Failing testleri yaz**

`packages/core/test/ddl.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { extractEventDefs } from '../src/abi.js';
import { buildControlTables, buildEventTable, eventColumns, pgTypeFor, DdlError } from '../src/ddl.js';

const ADDR = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const TRANSFER_ABI = [
  {
    type: 'event', name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
];

describe('pgTypeFor', () => {
  it('spec tip eşlemesi', () => {
    expect(pgTypeFor('address')).toBe('text');
    expect(pgTypeFor('uint256')).toBe('numeric(78,0)');
    expect(pgTypeFor('int128')).toBe('numeric(78,0)');
    expect(pgTypeFor('bool')).toBe('boolean');
    expect(pgTypeFor('bytes')).toBe('bytea');
    expect(pgTypeFor('bytes32')).toBe('bytea');
    expect(pgTypeFor('string')).toBe('text');
    expect(pgTypeFor('uint256[]')).toBe('jsonb');
    expect(pgTypeFor('tuple')).toBe('jsonb');
  });
  it('bilinmeyen tip DdlError', () => {
    expect(() => pgTypeFor('function')).toThrow(DdlError);
  });
});

describe('eventColumns', () => {
  it('ortak kolonla çakışan parametre param_ önekli; adsız parametre argN', () => {
    const abi = [
      {
        type: 'event', name: 'Weird',
        inputs: [
          { name: 'blockNumber', type: 'uint256', indexed: false },
          { name: '', type: 'address', indexed: false },
        ],
      },
    ];
    const [def] = extractEventDefs('x', ADDR, abi);
    const cols = eventColumns(def!.event);
    expect(cols.map((c) => c.name)).toEqual(['param_block_number', 'arg1']);
  });
});

describe('buildEventTable', () => {
  it('ortak kolonlar + parametreler + unique + indexed index', () => {
    const [def] = extractEventDefs('usdc', ADDR, TRANSFER_ABI);
    const spec = buildEventTable('idx_demo', def!);
    const create = spec.statements[0]!;
    expect(create).toContain('CREATE TABLE IF NOT EXISTS "idx_demo"."usdc_transfer"');
    expect(create).toContain('"block_number" bigint NOT NULL');
    expect(create).toContain('"from" text');
    expect(create).toContain('"value" numeric(78,0)');
    expect(create).toContain('UNIQUE (block_number, tx_hash, log_index)');
    expect(spec.statements.filter((s) => s.startsWith('CREATE INDEX'))).toHaveLength(2);
  });
});

describe('buildControlTables', () => {
  it('şema + üç kontrol tablosu', () => {
    const stmts = buildControlTables('idx_demo');
    expect(stmts[0]).toContain('CREATE SCHEMA IF NOT EXISTS "idx_demo"');
    expect(stmts.join(' ')).toContain('_cursor');
    expect(stmts.join(' ')).toContain('_meta');
    expect(stmts.join(' ')).toContain('_dead_letter');
  });
});
```

- [ ] **Step 2: Testlerin FAIL ettiğini doğrula**

Run: `pnpm --filter @arclight/core test`
Expected: FAIL — `Cannot find module '../src/ddl.js'`.

- [ ] **Step 3: İmplementasyonu yaz**

`packages/core/src/ddl.ts`:
```ts
import type { AbiEvent } from 'viem';
import type { EventDef } from './abi.js';
import { toSnakeCase } from './naming.js';

export class DdlError extends Error {}

export const COMMON_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['block_number', 'bigint NOT NULL'],
  ['block_hash', 'text NOT NULL'],
  ['block_time', 'timestamptz NOT NULL'],
  ['tx_hash', 'text NOT NULL'],
  ['tx_index', 'integer NOT NULL'],
  ['log_index', 'integer NOT NULL'],
  ['contract_address', 'text NOT NULL'],
];

const RESERVED = new Set(COMMON_COLUMNS.map(([n]) => n));
const q = (id: string) => `"${id}"`;

export function pgTypeFor(abiType: string): string {
  if (abiType.endsWith(']')) return 'jsonb';
  if (abiType.startsWith('tuple')) return 'jsonb';
  if (abiType === 'address') return 'text';
  if (abiType === 'bool') return 'boolean';
  if (abiType === 'string') return 'text';
  if (/^bytes(\d+)?$/.test(abiType)) return 'bytea';
  if (/^u?int\d*$/.test(abiType)) return 'numeric(78,0)';
  throw new DdlError(`Bilinmeyen ABI tipi: ${abiType}`);
}

export interface EventColumn {
  name: string;
  abiType: string;
  indexed: boolean;
}

export function eventColumns(event: AbiEvent): EventColumn[] {
  const cols = event.inputs.map((param, i) => {
    let name = param.name ? toSnakeCase(param.name) : `arg${i}`;
    if (RESERVED.has(name)) name = `param_${name}`;
    return { name, abiType: param.type, indexed: param.indexed === true };
  });
  const dup = cols.map((c) => c.name).find((n, i, a) => a.indexOf(n) !== i);
  if (dup) throw new DdlError(`${event.name}: kolon adı çakışması: ${dup}`);
  return cols;
}

export interface TableSpec {
  schema: string;
  table: string;
  statements: string[];
}

export function buildEventTable(schema: string, def: EventDef): TableSpec {
  const cols = eventColumns(def.event);
  const lines = [
    ...COMMON_COLUMNS.map(([n, t]) => `${q(n)} ${t}`),
    ...cols.map((c) => `${q(c.name)} ${pgTypeFor(c.abiType)}`),
    'UNIQUE (block_number, tx_hash, log_index)',
  ];
  const statements = [
    `CREATE TABLE IF NOT EXISTS ${q(schema)}.${q(def.tableName)} (\n  ${lines.join(',\n  ')}\n)`,
    ...cols
      .filter((c) => c.indexed)
      .map(
        (c) =>
          `CREATE INDEX IF NOT EXISTS ${q(`${def.tableName}_${c.name}_idx`)} ` +
          `ON ${q(schema)}.${q(def.tableName)} (${q(c.name)})`,
      ),
  ];
  return { schema, table: def.tableName, statements };
}

export function buildControlTables(schema: string): string[] {
  return [
    `CREATE SCHEMA IF NOT EXISTS ${q(schema)}`,
    `CREATE TABLE IF NOT EXISTS ${q(schema)}._cursor (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_block bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
    `CREATE TABLE IF NOT EXISTS ${q(schema)}._meta (
  key text PRIMARY KEY,
  value text NOT NULL
)`,
    `CREATE TABLE IF NOT EXISTS ${q(schema)}._dead_letter (
  id bigserial PRIMARY KEY,
  block_number bigint,
  tx_hash text,
  log_index integer,
  address text,
  topics jsonb,
  data text,
  error text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
)`,
  ];
}
```

`packages/core/src/index.ts`'e ekle:
```ts
export {
  COMMON_COLUMNS,
  DdlError,
  buildControlTables,
  buildEventTable,
  eventColumns,
  pgTypeFor,
  type EventColumn,
  type TableSpec,
} from './ddl.js';
```

- [ ] **Step 4: Testlerin PASS ettiğini doğrula**

Run: `pnpm --filter @arclight/core test`
Expected: tüm core testleri PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): ABI'den event tablosu ve kontrol tabloları DDL üretimi"
```

---

### Task 4: Log decode → satır (`core/decode.ts`) (M1)

**Files:**
- Create: `packages/core/src/decode.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/decode.test.ts`

**Interfaces:**
- Consumes: `EventDef` (Task 2), `eventColumns` (Task 3).
- Produces:
  - `class DecodeError extends Error` (`cause` alanıyla)
  - `interface RawLog { address; topics; data; blockNumber: bigint; blockHash; transactionHash; transactionIndex: number; logIndex: number }`
  - `interface DecodedRow { tableName: string; columns: Record<string, unknown> }`
  - `toSqlValue(abiType: string, value: unknown): unknown`
  - `decodeLogToRow(def: EventDef, log: RawLog, blockTime: Date): DecodedRow`

- [ ] **Step 1: Failing testleri yaz**

`packages/core/test/decode.test.ts` (test, viem ile gerçek bir Transfer log'u encode edip decode eder):
```ts
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { describe, expect, it } from 'vitest';
import { extractEventDefs } from '../src/abi.js';
import { DecodeError, decodeLogToRow, toSqlValue, type RawLog } from '../src/decode.js';

const ADDR = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const TRANSFER_ABI = [
  {
    type: 'event', name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;

const FROM = '0x1111111111111111111111111111111111111111' as const;
const TO = '0x2222222222222222222222222222222222222222' as const;

function makeLog(): RawLog {
  return {
    address: ADDR,
    topics: encodeEventTopics({
      abi: TRANSFER_ABI, eventName: 'Transfer', args: { from: FROM, to: TO },
    }) as RawLog['topics'],
    data: encodeAbiParameters([{ type: 'uint256' }], [123456789n]),
    blockNumber: 42n,
    blockHash: '0xabc0000000000000000000000000000000000000000000000000000000000000',
    transactionHash: '0xdef0000000000000000000000000000000000000000000000000000000000000',
    transactionIndex: 3,
    logIndex: 7,
  };
}

describe('toSqlValue', () => {
  it('bigint → string, address → lowercase, bytes → Buffer, dizi → JSON string', () => {
    expect(toSqlValue('uint256', 5n)).toBe('5');
    expect(toSqlValue('address', '0xABCDEF0000000000000000000000000000000000'))
      .toBe('0xabcdef0000000000000000000000000000000000');
    expect(toSqlValue('bytes32', '0x01ff')).toEqual(Buffer.from('01ff', 'hex'));
    expect(toSqlValue('uint256[]', [1n, 2n])).toBe('["1","2"]');
  });
});

describe('decodeLogToRow', () => {
  it('ortak kolonlar + parametre kolonları doğru dolu', () => {
    const [def] = extractEventDefs('usdc', ADDR, TRANSFER_ABI as unknown as unknown[]);
    const t = new Date('2026-07-03T00:00:00Z');
    const row = decodeLogToRow(def!, makeLog(), t);
    expect(row.tableName).toBe('usdc_transfer');
    expect(row.columns['block_number']).toBe('42');
    expect(row.columns['block_time']).toBe(t);
    expect(row.columns['contract_address']).toBe(ADDR.toLowerCase());
    expect(row.columns['from']).toBe(FROM);
    expect(row.columns['to']).toBe(TO);
    expect(row.columns['value']).toBe('123456789');
  });

  it('uyumsuz data DecodeError fırlatır', () => {
    const [def] = extractEventDefs('usdc', ADDR, TRANSFER_ABI as unknown as unknown[]);
    const bad = { ...makeLog(), data: '0x01' as const };
    expect(() => decodeLogToRow(def!, bad, new Date())).toThrow(DecodeError);
  });
});
```

- [ ] **Step 2: Testlerin FAIL ettiğini doğrula**

Run: `pnpm --filter @arclight/core test`
Expected: FAIL — `Cannot find module '../src/decode.js'`.

- [ ] **Step 3: İmplementasyonu yaz**

`packages/core/src/decode.ts`:
```ts
import { decodeEventLog } from 'viem';
import type { EventDef } from './abi.js';
import { eventColumns } from './ddl.js';

export class DecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export interface RawLog {
  address: `0x${string}`;
  topics: [`0x${string}`, ...`0x${string}`[]] | [];
  data: `0x${string}`;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;
}

export interface DecodedRow {
  tableName: string;
  columns: Record<string, unknown>;
}

export function toSqlValue(abiType: string, value: unknown): unknown {
  if (abiType.endsWith(']') || abiType.startsWith('tuple')) {
    return JSON.stringify(value, (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
  }
  if (abiType === 'address') return String(value).toLowerCase();
  if (/^bytes(\d+)?$/.test(abiType)) return Buffer.from(String(value).slice(2), 'hex');
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function decodeLogToRow(def: EventDef, log: RawLog, blockTime: Date): DecodedRow {
  let args: unknown;
  try {
    ({ args } = decodeEventLog({ abi: [def.event], data: log.data, topics: log.topics }));
  } catch (cause) {
    throw new DecodeError(`${def.tableName}: log decode edilemedi`, { cause });
  }
  const columns: Record<string, unknown> = {
    block_number: log.blockNumber.toString(),
    block_hash: log.blockHash,
    block_time: blockTime,
    tx_hash: log.transactionHash,
    tx_index: log.transactionIndex,
    log_index: log.logIndex,
    contract_address: log.address.toLowerCase(),
  };
  const cols = eventColumns(def.event);
  for (const [i, col] of cols.entries()) {
    const param = def.event.inputs[i]!;
    const raw = param.name
      ? (args as Record<string, unknown>)[param.name]
      : (args as unknown[])[i];
    if (raw === undefined) {
      throw new DecodeError(`${def.tableName}: '${col.name}' parametresi decode sonucunda yok`);
    }
    columns[col.name] = toSqlValue(col.abiType, raw);
  }
  return { tableName: def.tableName, columns };
}
```

`packages/core/src/index.ts`'e ekle:
```ts
export { DecodeError, decodeLogToRow, toSqlValue, type DecodedRow, type RawLog } from './decode.js';
```

- [ ] **Step 4: Testlerin PASS ettiğini doğrula**

Run: `pnpm --filter @arclight/core test`
Expected: tüm core testleri PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): viem ile log decode ve SQL değer dönüşümü"
```

---

### Task 5: Aralık planlayıcı + worker config şeması (`core/ranges.ts`, `core/config.ts`) (M1)

**Files:**
- Create: `packages/core/src/ranges.ts`, `packages/core/src/config.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/ranges.test.ts`, `packages/core/test/config.test.ts`

**Interfaces:**
- Produces:
  - `interface BlockRange { fromBlock: bigint; toBlock: bigint }`
  - `planRange(lastProcessed: bigint, finalized: bigint, batchBlocks: number): BlockRange | null`
  - `WorkerConfigSchema` (zod), `type WorkerConfig`, `type ContractConfig`
  - `parseWorkerConfig(raw: unknown): WorkerConfig`
- Not: `network.finalityTag` (`'finalized' | 'safe' | 'latest'`, varsayılan `'finalized'`) — anvil/Arc RPC tag davranış farklarına karşı esneklik; üretimde daima `finalized`.

- [ ] **Step 1: Failing testleri yaz**

`packages/core/test/ranges.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { planRange } from '../src/ranges.js';

describe('planRange', () => {
  it('yetişilmişse null', () => {
    expect(planRange(100n, 100n, 1000)).toBeNull();
    expect(planRange(100n, 99n, 1000)).toBeNull();
  });
  it('batchBlocks ile sınırlar', () => {
    expect(planRange(0n, 5000n, 1000)).toEqual({ fromBlock: 1n, toBlock: 1000n });
  });
  it('finalized yakınsa finalized\'a kadar', () => {
    expect(planRange(998n, 1000n, 1000)).toEqual({ fromBlock: 999n, toBlock: 1000n });
  });
});
```

`packages/core/test/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseWorkerConfig } from '../src/config.js';

const VALID = {
  indexerName: 'demo',
  network: { chainId: 5042002, rpc: ['https://arc-testnet.drpc.org'] },
  contracts: [
    { name: 'usdc', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', abiPath: '/etc/arclight/abi.json' },
  ],
};

describe('parseWorkerConfig', () => {
  it('varsayılanları uygular', () => {
    const cfg = parseWorkerConfig(VALID);
    expect(cfg.polling.batchBlocks).toBe(1000);
    expect(cfg.polling.intervalMs).toBe(2000);
    expect(cfg.network.finalityTag).toBe('finalized');
    expect(cfg.contracts[0]!.startBlock).toBe(0);
    expect(cfg.contracts[0]!.events).toEqual([]);
  });
  it('geçersiz adres reddedilir', () => {
    const bad = { ...VALID, contracts: [{ ...VALID.contracts[0], address: 'xyz' }] };
    expect(() => parseWorkerConfig(bad)).toThrow();
  });
  it('boş rpc listesi reddedilir', () => {
    const bad = { ...VALID, network: { ...VALID.network, rpc: [] } };
    expect(() => parseWorkerConfig(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Testlerin FAIL ettiğini doğrula**

Run: `pnpm --filter @arclight/core test`
Expected: FAIL — modüller yok.

- [ ] **Step 3: İmplementasyonu yaz**

`packages/core/src/ranges.ts`:
```ts
export interface BlockRange {
  fromBlock: bigint;
  toBlock: bigint;
}

export function planRange(
  lastProcessed: bigint,
  finalized: bigint,
  batchBlocks: number,
): BlockRange | null {
  if (finalized <= lastProcessed) return null;
  const fromBlock = lastProcessed + 1n;
  const cap = fromBlock + BigInt(batchBlocks - 1);
  return { fromBlock, toBlock: finalized < cap ? finalized : cap };
}
```

`packages/core/src/config.ts`:
```ts
import { z } from 'zod';

export const ContractConfigSchema = z.object({
  name: z.string().min(1),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'geçersiz EVM adresi'),
  abiPath: z.string().min(1),
  startBlock: z.number().int().nonnegative().default(0),
  events: z.array(z.string().min(1)).default([]),
});

export const WorkerConfigSchema = z.object({
  indexerName: z.string().min(1),
  network: z.object({
    chainId: z.number().int().positive(),
    rpc: z.array(z.string().url()).min(1),
    finalityTag: z.enum(['finalized', 'safe', 'latest']).default('finalized'),
  }),
  contracts: z.array(ContractConfigSchema).min(1),
  polling: z
    .object({
      batchBlocks: z.number().int().positive().default(1000),
      intervalMs: z.number().int().positive().default(2000),
    })
    .default({}),
});

export type ContractConfig = z.infer<typeof ContractConfigSchema>;
export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export function parseWorkerConfig(raw: unknown): WorkerConfig {
  return WorkerConfigSchema.parse(raw);
}
```

`packages/core/src/index.ts`'e ekle:
```ts
export { planRange, type BlockRange } from './ranges.js';
export {
  ContractConfigSchema,
  WorkerConfigSchema,
  parseWorkerConfig,
  type ContractConfig,
  type WorkerConfig,
} from './config.js';
```

- [ ] **Step 4: Testlerin PASS ettiğini doğrula**

Run: `pnpm --filter @arclight/core test`
Expected: tüm core testleri PASS. **M1 tamam.**

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): aralık planlayıcı ve zod worker config şeması"
```

---

### Task 6: Worker DB katmanı (`worker/db.ts`) — testcontainers ile (M2)

**Files:**
- Create: `packages/worker/src/db.ts`
- Test: `packages/worker/test/db.test.ts`

**Interfaces:**
- Consumes: `TableSpec`, `DecodedRow`, `buildControlTables`, `buildEventTable`, `extractEventDefs` (core).
- Produces:
  - `bootstrap(pool: pg.Pool, controlStatements: string[], tables: TableSpec[]): Promise<void>` — tek tx, idempotent
  - `getCursor(pool: pg.Pool, schema: string): Promise<bigint | null>`
  - `initCursor(pool: pg.Pool, schema: string, lastBlock: bigint): Promise<void>` — `ON CONFLICT DO NOTHING`
  - `interface DeadLetterEntry { blockNumber: bigint | null; txHash: string | null; logIndex: number | null; address: string | null; topics: string[]; data: string | null; error: string }`
  - `commitBatch(pool: pg.Pool, schema: string, rows: DecodedRow[], deadLetters: DeadLetterEntry[], newCursor: bigint): Promise<number>` — insert'ler + dead-letter'lar + cursor **tek transaction**; eklenen satır sayısını döner

- [ ] **Step 1: Failing testleri yaz**

`packages/worker/test/db.test.ts`:
```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildControlTables, buildEventTable, extractEventDefs, type DecodedRow,
} from '@arclight/core';
import { bootstrap, commitBatch, getCursor, initCursor } from '../src/db.js';

const ADDR = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const ABI = [
  {
    type: 'event', name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
];
const SCHEMA = 'idx_demo';

function row(blockNumber: number, logIndex: number): DecodedRow {
  return {
    tableName: 'usdc_transfer',
    columns: {
      block_number: String(blockNumber),
      block_hash: '0x' + 'a'.repeat(64),
      block_time: new Date('2026-07-03T00:00:00Z'),
      tx_hash: '0x' + 'b'.repeat(64),
      tx_index: 0,
      log_index: logIndex,
      contract_address: ADDR.toLowerCase(),
      from: '0x' + '1'.repeat(40),
      to: '0x' + '2'.repeat(40),
      value: '100',
    },
  };
}

describe('db', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  });
  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it('bootstrap idempotent (iki kez çalışır)', async () => {
    const defs = extractEventDefs('usdc', ADDR, ABI);
    const tables = defs.map((d) => buildEventTable(SCHEMA, d));
    await bootstrap(pool, buildControlTables(SCHEMA), tables);
    await bootstrap(pool, buildControlTables(SCHEMA), tables); // ikinci çağrı hata vermez
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`, [SCHEMA],
    );
    expect(r.rows.map((x) => x.table_name).sort())
      .toEqual(['_cursor', '_dead_letter', '_meta', 'usdc_transfer']);
  });

  it('cursor: init yalnızca boşken yazar', async () => {
    expect(await getCursor(pool, SCHEMA)).toBeNull();
    await initCursor(pool, SCHEMA, 9n);
    await initCursor(pool, SCHEMA, 999n); // etkisiz
    expect(await getCursor(pool, SCHEMA)).toBe(9n);
  });

  it('commitBatch idempotent + cursor ilerletir', async () => {
    const first = await commitBatch(pool, SCHEMA, [row(10, 0), row(10, 1)], [], 10n);
    expect(first).toBe(2);
    const again = await commitBatch(pool, SCHEMA, [row(10, 0), row(10, 1)], [], 10n);
    expect(again).toBe(0); // ON CONFLICT DO NOTHING
    expect(await getCursor(pool, SCHEMA)).toBe(10n);
    const count = await pool.query(`SELECT count(*)::int AS n FROM "${SCHEMA}"."usdc_transfer"`);
    expect(count.rows[0].n).toBe(2);
  });

  it('dead-letter aynı transaction içinde yazılır', async () => {
    await commitBatch(pool, SCHEMA, [], [{
      blockNumber: 11n, txHash: '0x' + 'c'.repeat(64), logIndex: 0,
      address: ADDR.toLowerCase(), topics: ['0xdead'], data: '0x01', error: 'decode hatası',
    }], 11n);
    const r = await pool.query(`SELECT error FROM "${SCHEMA}"._dead_letter`);
    expect(r.rows[0].error).toBe('decode hatası');
    expect(await getCursor(pool, SCHEMA)).toBe(11n);
  });
});
```

- [ ] **Step 2: Testlerin FAIL ettiğini doğrula**

Run: `pnpm --filter @arclight/worker test -- db`
Expected: FAIL — `Cannot find module '../src/db.js'`. (Docker çalışmıyorsa testcontainers container başlatamaz — önce Docker'ı başlat.)

- [ ] **Step 3: İmplementasyonu yaz**

`packages/worker/src/db.ts`:
```ts
import pg from 'pg';
import type { DecodedRow, TableSpec } from '@arclight/core';

const q = (id: string) => `"${id}"`;

export async function bootstrap(
  pool: pg.Pool,
  controlStatements: string[],
  tables: TableSpec[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of controlStatements) await client.query(s);
    for (const t of tables) for (const s of t.statements) await client.query(s);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getCursor(pool: pg.Pool, schema: string): Promise<bigint | null> {
  const r = await pool.query(`SELECT last_block FROM ${q(schema)}._cursor WHERE id = 1`);
  return r.rowCount ? BigInt(r.rows[0].last_block) : null;
}

export async function initCursor(pool: pg.Pool, schema: string, lastBlock: bigint): Promise<void> {
  await pool.query(
    `INSERT INTO ${q(schema)}._cursor (id, last_block) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
    [lastBlock.toString()],
  );
}

export interface DeadLetterEntry {
  blockNumber: bigint | null;
  txHash: string | null;
  logIndex: number | null;
  address: string | null;
  topics: string[];
  data: string | null;
  error: string;
}

export async function commitBatch(
  pool: pg.Pool,
  schema: string,
  rows: DecodedRow[],
  deadLetters: DeadLetterEntry[],
  newCursor: bigint,
): Promise<number> {
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      const cols = Object.keys(row.columns);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const quoted = cols.map(q).join(', ');
      const res = await client.query(
        `INSERT INTO ${q(schema)}.${q(row.tableName)} (${quoted}) VALUES (${placeholders})
         ON CONFLICT (block_number, tx_hash, log_index) DO NOTHING`,
        cols.map((c) => row.columns[c]),
      );
      inserted += res.rowCount ?? 0;
    }
    for (const d of deadLetters) {
      await client.query(
        `INSERT INTO ${q(schema)}._dead_letter
           (block_number, tx_hash, log_index, address, topics, data, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          d.blockNumber?.toString() ?? null, d.txHash, d.logIndex, d.address,
          JSON.stringify(d.topics), d.data, d.error,
        ],
      );
    }
    await client.query(
      `UPDATE ${q(schema)}._cursor SET last_block = $1, updated_at = now() WHERE id = 1`,
      [newCursor.toString()],
    );
    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Testlerin PASS ettiğini doğrula**

Run: `pnpm --filter @arclight/worker test -- db`
Expected: 4 test PASS (ilk çalıştırma postgres:17-alpine imajını çeker, ~1 dk sürebilir).

- [ ] **Step 5: Commit**

```bash
git add packages/worker
git commit -m "feat(worker): tek-transaction idempotent yazım ve cursor DB katmanı"
```

---

### Task 7: RPC katmanı (`worker/rpc.ts`) — anvil ile (M2)

**Files:**
- Create: `packages/worker/src/rpc.ts`, `packages/worker/test/helpers/anvil.ts`
- Test: `packages/worker/test/rpc.test.ts`

**Interfaces:**
- Consumes: `WorkerConfig['network']` (Task 5).
- Produces:
  - `class ChainIdMismatchError extends Error`
  - `createRpc(urls: string[]): PublicClient` — viem `fallback` transport (failover)
  - `filterHealthyRpcs(urls: string[], expectedChainId: number): Promise<string[]>` — her ucu tek tek chainId'yle doğrular, uyanları döner
  - `getFinalizedBlockNumber(client: PublicClient, tag: 'finalized' | 'safe' | 'latest'): Promise<bigint>`
  - `fetchLogs(client: PublicClient, addresses: \`0x${string}\`[], fromBlock: bigint, toBlock: bigint): Promise<Log[]>`
  - `getBlockTimes(client: PublicClient, blockNumbers: bigint[]): Promise<Map<bigint, Date>>`
  - Test helper: `startAnvil(opts?: { chainId?: number; blockTime?: number }): Promise<{ url: string; stop: () => void }>`

- [ ] **Step 1: Anvil test helper'ını yaz**

`packages/worker/test/helpers/anvil.ts`:
```ts
import { spawn, type ChildProcess } from 'node:child_process';

let nextPort = 8600;

export interface AnvilHandle {
  url: string;
  stop: () => void;
}

export async function startAnvil(opts?: {
  chainId?: number;
  blockTime?: number;
}): Promise<AnvilHandle> {
  const port = nextPort++;
  const args = ['--port', String(port), '--silent'];
  if (opts?.chainId) args.push('--chain-id', String(opts.chainId));
  if (opts?.blockTime) args.push('--block-time', String(opts.blockTime));
  const proc: ChildProcess = spawn('anvil', args, { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  // Hazır olana kadar bekle (en fazla 15 sn)
  for (let i = 0; i < 150; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (res.ok) return { url, stop: () => proc.kill() };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  proc.kill();
  throw new Error('anvil başlatılamadı — foundry kurulu mu?');
}
```

- [ ] **Step 2: Failing testleri yaz**

`packages/worker/test/rpc.test.ts`:
```ts
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
```

Not: anvil'in `finalized` tag davranışı sürüme göre değişebildiği için testte `'latest'` kullanılır; `finalityTag` config'i tam da bu yüzden var (üretim/Arc: `finalized`).

- [ ] **Step 3: Testlerin FAIL ettiğini doğrula**

Run: `pnpm --filter @arclight/worker test -- rpc`
Expected: FAIL — `Cannot find module '../src/rpc.js'`.

- [ ] **Step 4: İmplementasyonu yaz**

`packages/worker/src/rpc.ts`:
```ts
import {
  createPublicClient, fallback, http,
  type Log, type PublicClient,
} from 'viem';

export class ChainIdMismatchError extends Error {}

export function createRpc(urls: string[]): PublicClient {
  return createPublicClient({
    transport: fallback(
      urls.map((u) => http(u, { timeout: 10_000, retryCount: 2 })),
      { rank: true },
    ),
  });
}

export async function filterHealthyRpcs(
  urls: string[],
  expectedChainId: number,
): Promise<string[]> {
  const checks = await Promise.all(
    urls.map(async (url) => {
      try {
        const client = createPublicClient({ transport: http(url, { timeout: 5_000, retryCount: 0 }) });
        return (await client.getChainId()) === expectedChainId ? url : null;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((u): u is string => u !== null);
}

export async function getFinalizedBlockNumber(
  client: PublicClient,
  tag: 'finalized' | 'safe' | 'latest',
): Promise<bigint> {
  const block = await client.getBlock({ blockTag: tag });
  if (block.number === null) throw new Error(`'${tag}' bloğunun numarası yok (pending?)`);
  return block.number;
}

export async function fetchLogs(
  client: PublicClient,
  addresses: `0x${string}`[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Log[]> {
  return client.getLogs({ address: addresses, fromBlock, toBlock });
}

export async function getBlockTimes(
  client: PublicClient,
  blockNumbers: bigint[],
): Promise<Map<bigint, Date>> {
  const map = new Map<bigint, Date>();
  for (const n of new Set(blockNumbers.map((b) => b.toString()))) {
    const block = await client.getBlock({ blockNumber: BigInt(n) });
    map.set(BigInt(n), new Date(Number(block.timestamp) * 1000));
  }
  return map;
}
```

- [ ] **Step 5: Testlerin PASS ettiğini doğrula**

Run: `pnpm --filter @arclight/worker test -- rpc`
Expected: 4 test PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/worker
git commit -m "feat(worker): viem fallback transport ile RPC katmanı ve chainId sağlık kontrolü"
```

---

### Task 8: Metrics + faz takibi + health endpoint'leri (M2)

**Files:**
- Create: `packages/worker/src/metrics.ts`, `packages/worker/src/status.ts`, `packages/worker/src/health.ts`
- Test: `packages/worker/test/health.test.ts`

**Interfaces:**
- Produces:
  - `createMetrics(indexerName: string): Metrics` — `registry` + Global Constraints'teki altı metrik (`blocksBehind`, `lastProcessedBlock`, `eventsIngested`, `rpcErrors`, `deadLetters`, `writeLatency`)
  - `type Phase = 'Provisioning' | 'Backfilling' | 'Live' | 'Degraded'`
  - `class PhaseTracker { get phase(): Phase; get lastError(): string | undefined; get healthy(): boolean; set(phase: Phase, error?: string): void }`
  - `startHealthServer(metrics: Metrics, phase: PhaseTracker, port: number): Server` — `/metrics`, `/healthz` (Degraded → 503)

- [ ] **Step 1: Failing testi yaz**

`packages/worker/test/health.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetrics } from '../src/metrics.js';
import { PhaseTracker } from '../src/status.js';
import { startHealthServer } from '../src/health.js';

describe('health + metrics', () => {
  const metrics = createMetrics('demo');
  const phase = new PhaseTracker();
  const server = startHealthServer(metrics, phase, 0);
  const port = () => (server.address() as { port: number }).port;

  beforeAll(() => new Promise<void>((r) => server.once('listening', () => r())));
  afterAll(() => server.close());

  it('/healthz: Provisioning 200, Degraded 503', async () => {
    expect((await fetch(`http://127.0.0.1:${port()}/healthz`)).status).toBe(200);
    phase.set('Degraded', 'rpc koptu');
    const res = await fetch(`http://127.0.0.1:${port()}/healthz`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ phase: 'Degraded', lastError: 'rpc koptu' });
    phase.set('Live');
  });

  it('/metrics: arclight metrikleri indexer etiketiyle', async () => {
    metrics.eventsIngested.inc(5);
    const body = await (await fetch(`http://127.0.0.1:${port()}/metrics`)).text();
    expect(body).toContain('arclight_events_ingested_total{indexer="demo"} 5');
    expect(body).toContain('arclight_blocks_behind');
  });
});
```

- [ ] **Step 2: Testin FAIL ettiğini doğrula**

Run: `pnpm --filter @arclight/worker test -- health`
Expected: FAIL — modüller yok.

- [ ] **Step 3: İmplementasyonu yaz**

`packages/worker/src/metrics.ts`:
```ts
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export function createMetrics(indexerName: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ indexer: indexerName });
  return {
    registry,
    blocksBehind: new Gauge({
      name: 'arclight_blocks_behind',
      help: 'finalized head ile cursor arasındaki blok farkı',
      registers: [registry],
    }),
    lastProcessedBlock: new Gauge({
      name: 'arclight_last_processed_block',
      help: 'işlenen son blok numarası',
      registers: [registry],
    }),
    eventsIngested: new Counter({
      name: 'arclight_events_ingested_total',
      help: 'yazılan toplam event sayısı',
      registers: [registry],
    }),
    rpcErrors: new Counter({
      name: 'arclight_rpc_errors_total',
      help: 'RPC hata sayısı',
      registers: [registry],
    }),
    deadLetters: new Counter({
      name: 'arclight_dead_letter_total',
      help: 'dead-letter tablosuna düşen log sayısı',
      registers: [registry],
    }),
    writeLatency: new Histogram({
      name: 'arclight_write_latency_seconds',
      help: 'batch commit süresi',
      registers: [registry],
    }),
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
```

`packages/worker/src/status.ts`:
```ts
export type Phase = 'Provisioning' | 'Backfilling' | 'Live' | 'Degraded';

export class PhaseTracker {
  #phase: Phase = 'Provisioning';
  #lastError: string | undefined;

  get phase(): Phase {
    return this.#phase;
  }
  get lastError(): string | undefined {
    return this.#lastError;
  }
  get healthy(): boolean {
    return this.#phase !== 'Degraded';
  }
  set(phase: Phase, error?: string): void {
    this.#phase = phase;
    this.#lastError = error;
  }
}
```

`packages/worker/src/health.ts`:
```ts
import { createServer, type Server } from 'node:http';
import type { Metrics } from './metrics.js';
import type { PhaseTracker } from './status.js';

export function startHealthServer(metrics: Metrics, phase: PhaseTracker, port: number): Server {
  const server = createServer((req, res) => {
    if (req.url === '/metrics') {
      void metrics.registry.metrics().then((body) => {
        res.setHeader('content-type', metrics.registry.contentType);
        res.end(body);
      });
    } else if (req.url === '/healthz') {
      res.statusCode = phase.healthy ? 200 : 503;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ phase: phase.phase, lastError: phase.lastError ?? null }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  server.listen(port);
  return server;
}
```

- [ ] **Step 4: Testlerin PASS ettiğini doğrula**

Run: `pnpm --filter @arclight/worker test -- health`
Expected: 2 test PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/worker
git commit -m "feat(worker): prometheus metrikleri, faz takibi ve health endpoint'leri"
```

---

### Task 9: Ingestion pipeline (`worker/pipeline.ts`) — anvil + Postgres entegrasyonu (M2)

**Files:**
- Create: `packages/worker/src/pipeline.ts`
- Create: `packages/worker/test/fixtures/emitter/foundry.toml`, `packages/worker/test/fixtures/emitter/src/Emitter.sol`
- Test: `packages/worker/test/pipeline.test.ts`

**Interfaces:**
- Consumes: core (planRange, decodeLogToRow, extractEventDefs, buildEventTable, buildControlTables), db.ts, rpc.ts, metrics.ts, status.ts.
- Produces:
  - `interface PipelineDeps { client: PublicClient; pool: pg.Pool; cfg: WorkerConfig; defs: EventDef[]; schema: string; metrics: Metrics; phase: PhaseTracker; log: pino.Logger }`
  - `bootstrapIndexer(deps: PipelineDeps): Promise<void>` — kontrol+event tabloları, cursor'ı `min(startBlock)-1` ile init
  - `runOnce(deps: PipelineDeps): Promise<boolean>` — bir aralık işler; işlenecek yoksa `false`
  - `runLoop(deps: PipelineDeps, signal: AbortSignal): Promise<void>` — hata halinde üstel backoff + `Degraded`, düzelince toparlanır

- [ ] **Step 1: Test fixture kontratını yaz**

`packages/worker/test/fixtures/emitter/foundry.toml`:
```toml
[profile.default]
src = "src"
out = "out"
```

`packages/worker/test/fixtures/emitter/src/Emitter.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Emitter {
    event Ping(uint256 indexed n, address who);

    function ping(uint256 n) external {
        emit Ping(n, msg.sender);
    }
}
```

- [ ] **Step 2: Failing entegrasyon testini yaz**

`packages/worker/test/pipeline.test.ts`:
```ts
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import pino from 'pino';
import { createPublicClient, createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractEventDefs, parseWorkerConfig, type WorkerConfig } from '@arclight/core';
import { getCursor } from '../src/db.js';
import { createMetrics } from '../src/metrics.js';
import { bootstrapIndexer, runOnce, type PipelineDeps } from '../src/pipeline.js';
import { createRpc } from '../src/rpc.js';
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

  it('restart simülasyonu: yeni pipeline instance cursor\'dan devam eder, gap/duplikasyon yok', async () => {
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
});
```

- [ ] **Step 3: Testin FAIL ettiğini doğrula**

Run: `pnpm --filter @arclight/worker test -- pipeline`
Expected: FAIL — `Cannot find module '../src/pipeline.js'`.

- [ ] **Step 4: İmplementasyonu yaz**

`packages/worker/src/pipeline.ts`:
```ts
import type pg from 'pg';
import type pino from 'pino';
import type { PublicClient } from 'viem';
import {
  buildControlTables, buildEventTable, decodeLogToRow, planRange,
  type DecodedRow, type EventDef, type RawLog, type WorkerConfig,
} from '@arclight/core';
import { bootstrap, commitBatch, getCursor, initCursor, type DeadLetterEntry } from './db.js';
import { fetchLogs, getBlockTimes, getFinalizedBlockNumber } from './rpc.js';
import type { Metrics } from './metrics.js';
import type { PhaseTracker } from './status.js';

export interface PipelineDeps {
  client: PublicClient;
  pool: pg.Pool;
  cfg: WorkerConfig;
  defs: EventDef[];
  schema: string;
  metrics: Metrics;
  phase: PhaseTracker;
  log: pino.Logger;
}

export async function bootstrapIndexer(deps: PipelineDeps): Promise<void> {
  const tables = deps.defs.map((d) => buildEventTable(deps.schema, d));
  await bootstrap(deps.pool, buildControlTables(deps.schema), tables);
  const minStart = deps.cfg.contracts.reduce(
    (min, c) => (BigInt(c.startBlock) < min ? BigInt(c.startBlock) : min),
    BigInt(deps.cfg.contracts[0]!.startBlock),
  );
  await initCursor(deps.pool, deps.schema, minStart - 1n);
}

export async function runOnce(deps: PipelineDeps): Promise<boolean> {
  const { client, pool, cfg, defs, schema, metrics, phase } = deps;
  const finalized = await getFinalizedBlockNumber(client, cfg.network.finalityTag);
  const cursor = await getCursor(pool, schema);
  if (cursor === null) throw new Error('cursor yok — önce bootstrapIndexer çağrılmalı');
  metrics.blocksBehind.set(Number(finalized - cursor));

  const range = planRange(cursor, finalized, cfg.polling.batchBlocks);
  if (!range) {
    phase.set('Live');
    return false;
  }
  phase.set('Backfilling');

  const byKey = new Map(defs.map((d) => [`${d.address}:${d.topic0}`, d]));
  const startBlocks = new Map(cfg.contracts.map((c) => [c.address.toLowerCase(), BigInt(c.startBlock)]));
  const addresses = [...new Set(defs.map((d) => d.address))];

  const logs = await fetchLogs(client, addresses, range.fromBlock, range.toBlock);
  const times = await getBlockTimes(client, logs.map((l) => l.blockNumber!));

  const rows: DecodedRow[] = [];
  const dead: DeadLetterEntry[] = [];
  for (const log of logs) {
    const address = log.address.toLowerCase() as `0x${string}`;
    const def = byKey.get(`${address}:${log.topics[0]}`);
    if (!def) continue; // izlenmeyen event
    if (log.blockNumber! < (startBlocks.get(address) ?? 0n)) continue;
    try {
      rows.push(decodeLogToRow(def, log as unknown as RawLog, times.get(log.blockNumber!)!));
    } catch (err) {
      dead.push({
        blockNumber: log.blockNumber, txHash: log.transactionHash,
        logIndex: log.logIndex, address,
        topics: [...log.topics], data: log.data,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const end = deps.metrics.writeLatency.startTimer();
  const inserted = await commitBatch(pool, schema, rows, dead, range.toBlock);
  end();

  metrics.eventsIngested.inc(inserted);
  metrics.deadLetters.inc(dead.length);
  metrics.lastProcessedBlock.set(Number(range.toBlock));
  metrics.blocksBehind.set(Number(finalized - range.toBlock));
  if (range.toBlock === finalized) phase.set('Live');
  deps.log.info(
    { fromBlock: range.fromBlock, toBlock: range.toBlock, inserted, dead: dead.length },
    'aralık işlendi',
  );
  return true;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

export async function runLoop(deps: PipelineDeps, signal: AbortSignal): Promise<void> {
  let backoffMs = 1000;
  while (!signal.aborted) {
    try {
      const progressed = await runOnce(deps);
      backoffMs = 1000;
      if (!progressed) await sleep(deps.cfg.polling.intervalMs, signal);
    } catch (err) {
      deps.metrics.rpcErrors.inc();
      deps.phase.set('Degraded', err instanceof Error ? err.message : String(err));
      deps.log.error({ err }, 'pipeline hatası — backoff ile yeniden denenecek');
      await sleep(backoffMs, signal);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    }
  }
}
```

- [ ] **Step 5: Testlerin PASS ettiğini doğrula**

Run: `pnpm --filter @arclight/worker test -- pipeline`
Expected: 3 test PASS (forge build + container başlatma nedeniyle ~1-2 dk).

- [ ] **Step 6: Commit**

```bash
git add packages/worker
git commit -m "feat(worker): gap-free ingestion pipeline (runOnce/runLoop) ve anvil entegrasyon testleri"
```

---

### Task 10: Dead-letter yolu + Degraded davranışı (M2)

**Files:**
- Test: `packages/worker/test/deadletter.test.ts`

**Interfaces:**
- Consumes: Task 9'un tamamı. Yeni üretim kodu beklenmez — bu task, hata yollarını uçtan uca kanıtlar; testler mevcut davranışta boşluk bulursa düzeltme bu task'ta yapılır.

- [ ] **Step 1: Testleri yaz**

`packages/worker/test/deadletter.test.ts`:
```ts
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import pino from 'pino';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractEventDefs, parseWorkerConfig } from '@arclight/core';
import { createMetrics } from '../src/metrics.js';
import { bootstrapIndexer, runLoop, runOnce, type PipelineDeps } from '../src/pipeline.js';
import { createRpc } from '../src/rpc.js';
import { PhaseTracker } from '../src/status.js';
import { startAnvil, type AnvilHandle } from './helpers/anvil.js';

const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const FIXTURE = fileURLToPath(new URL('./fixtures/emitter', import.meta.url));

// Kontratın gerçek event'i: Ping(uint256 indexed n, address who)
// Kasıtlı yanlış ABI: aynı tipler (→ aynı topic0) ama hiçbir parametre indexed değil →
// decodeEventLog data'da 64 bayt bekler, log'da 32 bayt var → DecodeError
// (Dikkat: parametre tipi eklemek/çıkarmak topic0'ı değiştirir ve log hiç eşleşmez.)
const WRONG_ABI = [
  {
    type: 'event', name: 'Ping',
    inputs: [
      { name: 'n', type: 'uint256', indexed: false },
      { name: 'who', type: 'address', indexed: false },
    ],
  },
];

describe('dead-letter + degraded', () => {
  let anvil: AnvilHandle;
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    execSync('forge build', { cwd: FIXTURE, stdio: 'inherit' });
    anvil = await startAnvil();
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  });
  afterAll(async () => {
    await pool.end();
    await container.stop();
    anvil.stop();
  });

  it('decode edilemeyen log dead-letter\'a düşer, pipeline durmaz', async () => {
    const artifact = JSON.parse(
      readFileSync(`${FIXTURE}/out/Emitter.sol/Emitter.json`, 'utf8'),
    ) as { abi: unknown[]; bytecode: { object: `0x${string}` } };
    const wallet = createWalletClient({
      account: privateKeyToAccount(PK), transport: http(anvil.url),
    }).extend(publicActions);
    const hash = await wallet.deployContract({
      abi: artifact.abi as never, bytecode: artifact.bytecode.object, chain: null,
    });
    const receipt = await wallet.waitForTransactionReceipt({ hash });
    const address = receipt.contractAddress!;
    const tx = await wallet.writeContract({
      address, abi: artifact.abi as never, functionName: 'ping', args: [1n], chain: null,
    });
    await wallet.waitForTransactionReceipt({ hash: tx });

    const deps: PipelineDeps = {
      client: createRpc([anvil.url]),
      pool,
      cfg: parseWorkerConfig({
        indexerName: 'dl',
        network: { chainId: 31337, rpc: [anvil.url], finalityTag: 'latest' },
        contracts: [{ name: 'emitter', address, abiPath: 'unused' }],
      }),
      defs: extractEventDefs('emitter', address, WRONG_ABI),
      schema: 'idx_dl',
      metrics: createMetrics('dl'),
      phase: new PhaseTracker(),
      log: pino({ level: 'silent' }),
    };
    await bootstrapIndexer(deps);
    while (await runOnce(deps)) { /* yetiş */ }

    const dl = await pool.query(`SELECT error FROM idx_dl._dead_letter`);
    expect(dl.rows).toHaveLength(1);
    expect(dl.rows[0].error).toContain('decode');
    const rows = await pool.query(`SELECT count(*)::int AS c FROM idx_dl.emitter_ping`);
    expect(rows.rows[0].c).toBe(0);
    expect(deps.phase.phase).toBe('Live'); // pipeline Degraded olmadı
  });

  it('RPC tamamen koparsa runLoop Degraded olur, dönünce toparlar', async () => {
    const flaky = await startAnvil();
    const deps: PipelineDeps = {
      client: createRpc([flaky.url]),
      pool,
      cfg: parseWorkerConfig({
        indexerName: 'dg',
        network: { chainId: 31337, rpc: [flaky.url], finalityTag: 'latest' },
        contracts: [{
          name: 'x', address: '0x0000000000000000000000000000000000000001', abiPath: 'unused',
        }],
        polling: { batchBlocks: 10, intervalMs: 50 },
      }),
      defs: [],
      schema: 'idx_dg',
      metrics: createMetrics('dg'),
      phase: new PhaseTracker(),
      log: pino({ level: 'silent' }),
    };
    await bootstrapIndexer(deps);

    const ctrl = new AbortController();
    const loop = runLoop(deps, ctrl.signal);
    await new Promise((r) => setTimeout(r, 500));
    expect(deps.phase.phase).toBe('Live');

    flaky.stop(); // RPC koptu
    await new Promise((r) => setTimeout(r, 3000));
    expect(deps.phase.phase).toBe('Degraded');
    expect(deps.phase.lastError).toBeTruthy();

    ctrl.abort();
    await loop;
  });
});
```

- [ ] **Step 2: Testleri çalıştır**

Run: `pnpm --filter @arclight/worker test -- deadletter`
Expected: 2 test PASS. FAIL olursa: bulguya göre `pipeline.ts`/`db.ts` düzeltilir (bu task'ın amacı hata yollarını kanıtlamak), düzeltme testle birlikte commit'lenir.

- [ ] **Step 3: Tüm worker testlerini çalıştır**

Run: `pnpm --filter @arclight/worker test`
Expected: db + rpc + health + pipeline + deadletter hepsi PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/worker
git commit -m "test(worker): dead-letter ve Degraded/toparlanma davranışı uçtan uca kanıtlandı"
```

---

### Task 11: Entrypoint + Docker + compose demosu (M2 kapanışı)

**Files:**
- Create: `packages/worker/src/main.ts`, `Dockerfile`, `docker-compose.dev.yml`
- Create: `manifests/demo/worker-config.json`, `manifests/demo/emitter-abi.json`, `packages/worker/scripts/demo-seed.ts`
- Modify: `package.json` (root) ve `packages/worker/package.json` (`demo:seed` script'leri)

**Interfaces:**
- Consumes: Task 5–10'un tamamı.
- Produces: `node dist/main.js` ile çalışan worker. Env sözleşmesi (Part 2'deki operatör bunu üretecek): `DATABASE_URL` (zorunlu), `CONFIG_PATH` (vars. `/etc/arclight/config.json`), `HEALTH_PORT` (vars. `9090`). Config dosyasındaki `abiPath` alanları dosya sisteminden okunur.

- [ ] **Step 1: main.ts'i yaz**

`packages/worker/src/main.ts`:
```ts
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { pino } from 'pino';
import {
  extractEventDefs, parseWorkerConfig, schemaName, type EventDef,
} from '@arclight/core';
import { createMetrics } from './metrics.js';
import { bootstrapIndexer, runLoop, type PipelineDeps } from './pipeline.js';
import { createRpc, filterHealthyRpcs } from './rpc.js';
import { startHealthServer } from './health.js';
import { PhaseTracker } from './status.js';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

async function main(): Promise<void> {
  const dsn = process.env['DATABASE_URL'];
  if (!dsn) throw new Error('DATABASE_URL zorunlu');
  const configPath = process.env['CONFIG_PATH'] ?? '/etc/arclight/config.json';
  const cfg = parseWorkerConfig(JSON.parse(readFileSync(configPath, 'utf8')));

  const metrics = createMetrics(cfg.indexerName);
  const phase = new PhaseTracker();
  const healthPort = Number(process.env['HEALTH_PORT'] ?? 9090);
  const server = startHealthServer(metrics, phase, healthPort);

  const defs: EventDef[] = cfg.contracts.flatMap((c) => {
    const abi = JSON.parse(readFileSync(c.abiPath, 'utf8')) as unknown;
    return extractEventDefs(c.name, c.address, abi, c.events.length ? c.events : undefined);
  });

  // chainId uyuşmayan/ölü uçlar havuzdan düşer; hiçbiri kalmazsa Degraded bekle-yeniden-dene
  let rpcs = await filterHealthyRpcs(cfg.network.rpc, cfg.network.chainId);
  while (rpcs.length === 0) {
    phase.set('Degraded', `hiçbir RPC ucu chainId ${cfg.network.chainId} ile eşleşmedi`);
    log.error({ rpc: cfg.network.rpc }, 'sağlıklı RPC yok — 30 sn sonra yeniden denenecek');
    await new Promise((r) => setTimeout(r, 30_000));
    rpcs = await filterHealthyRpcs(cfg.network.rpc, cfg.network.chainId);
  }

  const pool = new pg.Pool({ connectionString: dsn });
  const deps: PipelineDeps = {
    client: createRpc(rpcs),
    pool,
    cfg,
    defs,
    schema: schemaName(cfg.indexerName),
    metrics,
    phase,
    log,
  };
  await bootstrapIndexer(deps);
  log.info({ indexer: cfg.indexerName, schema: deps.schema, rpcs }, 'arclight worker başladı');

  const ctrl = new AbortController();
  const shutdown = () => {
    log.info('kapanma sinyali alındı');
    ctrl.abort();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await runLoop(deps, ctrl.signal);
  server.close();
  await pool.end();
}

main().catch((err) => {
  log.fatal({ err }, 'worker başlatılamadı');
  process.exit(1);
});
```

- [ ] **Step 2: Build'in geçtiğini doğrula**

Run: `pnpm -r build`
Expected: core + worker derlenir, hata yok.

- [ ] **Step 3: Dockerfile ve compose dosyalarını yaz**

`Dockerfile` (repo kökü):
```dockerfile
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/worker/package.json packages/worker/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
RUN pnpm -r build && pnpm --filter @arclight/worker deploy --legacy --prod /out

FROM node:22-slim
WORKDIR /app
COPY --from=build /out .
USER node
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
```

`docker-compose.dev.yml`:
```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: arclight
      POSTGRES_PASSWORD: arclight
      POSTGRES_DB: arclight
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U arclight"]
      interval: 2s
      timeout: 2s
      retries: 15

  anvil:
    image: ghcr.io/foundry-rs/foundry:latest
    entrypoint: ["anvil", "--host", "0.0.0.0", "--block-time", "1"]
    ports: ["8545:8545"]

  worker:
    build: .
    depends_on:
      postgres: { condition: service_healthy }
      anvil: { condition: service_started }
    environment:
      DATABASE_URL: postgres://arclight:arclight@postgres:5432/arclight
      CONFIG_PATH: /etc/arclight/worker-config.json
    volumes:
      - ./manifests/demo:/etc/arclight:ro
    ports: ["9090:9090"]
```

- [ ] **Step 4: Demo config + seed script'ini yaz**

`manifests/demo/emitter-abi.json`:
```json
[
  {
    "type": "event",
    "name": "Ping",
    "inputs": [
      { "name": "n", "type": "uint256", "indexed": true },
      { "name": "who", "type": "address", "indexed": false }
    ]
  }
]
```

`manifests/demo/worker-config.json` (adres: anvil key#0'ın ilk deploy'unun deterministik adresi):
```json
{
  "indexerName": "demo",
  "network": {
    "chainId": 31337,
    "rpc": ["http://anvil:8545"],
    "finalityTag": "latest"
  },
  "contracts": [
    {
      "name": "emitter",
      "address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      "abiPath": "/etc/arclight/emitter-abi.json"
    }
  ],
  "polling": { "batchBlocks": 100, "intervalMs": 1000 }
}
```

`packages/worker/scripts/demo-seed.ts` (host'tan çalışır; Emitter'ı deploy eder + 10 ping atar; worker paketinde durur ki `viem` worker'ın node_modules'ünden çözülsün):
```ts
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const FIXTURE = fileURLToPath(new URL('../test/fixtures/emitter', import.meta.url));

execSync('forge build', { cwd: FIXTURE, stdio: 'inherit' });
const artifact = JSON.parse(
  readFileSync(`${FIXTURE}/out/Emitter.sol/Emitter.json`, 'utf8'),
) as { abi: never; bytecode: { object: `0x${string}` } };

const wallet = createWalletClient({
  account: privateKeyToAccount(PK),
  transport: http('http://127.0.0.1:8545'),
}).extend(publicActions);

const hash = await wallet.deployContract({
  abi: artifact.abi, bytecode: artifact.bytecode.object, chain: null,
});
const receipt = await wallet.waitForTransactionReceipt({ hash });
console.log('Emitter deploy edildi:', receipt.contractAddress);

for (let i = 1; i <= 10; i++) {
  const tx = await wallet.writeContract({
    address: receipt.contractAddress!, abi: artifact.abi,
    functionName: 'ping', args: [BigInt(i)], chain: null,
  });
  await wallet.waitForTransactionReceipt({ hash: tx });
}
console.log('10 ping gönderildi');
```

`packages/worker/package.json` scripts'e ekle:
```json
"demo:seed": "node --experimental-strip-types scripts/demo-seed.ts"
```

Root `package.json` scripts'e ekle:
```json
"demo:seed": "pnpm --filter @arclight/worker demo:seed"
```

- [ ] **Step 5: Demoyu uçtan uca doğrula**

Run (sırayla):
```bash
docker compose -f docker-compose.dev.yml up -d --build
pnpm demo:seed
sleep 10
docker compose -f docker-compose.dev.yml exec postgres \
  psql -U arclight -c 'SELECT count(*) FROM idx_demo.emitter_ping;'
curl -s localhost:9090/healthz
```
Expected: `count = 10`; healthz `{"phase":"Live","lastError":null}`. Bitince: `docker compose -f docker-compose.dev.yml down -v`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(worker): entrypoint, Dockerfile ve docker-compose demo ortamı"
```

---

## Part 1 Bitiş Kriteri (M2 kapanışı)

- `pnpm lint && pnpm -r build && pnpm -r test` yeşil.
- Spec §7 "şema evrimi" notu: mevcut bir event'in imzası değişirse mekanizma şudur — `CREATE TABLE IF NOT EXISTS` eski tabloyu değiştirmez, eksik/uyumsuz kolona insert SQL hatası verir, `runLoop` bunu yakalayıp `Degraded` + `lastError`'a yazar ve cursor ilerlemez (transaction rollback). Yani sessiz veri bozulması yapısal olarak imkânsız; proaktif bootstrap-anı şema diff'i Part 2/v2 konusudur.
- docker-compose demosu: seed → 10 satır `idx_demo.emitter_ping`'de, worker `Live`.
- Part 2 planı (operatör M3, Helm+kind e2e M4, Arc testnet doğrulaması M5) bu noktada `superpowers:writing-plans` ile yazılır — worker'ın env/config sözleşmesi (Task 11 "Produces") operatörün üreteceği arayüzdür.

