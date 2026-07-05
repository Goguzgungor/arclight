# Arclight MVP — Part 2: Operatör + Paketleme + Arc Doğrulama (M3–M5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Indexer` CR'ı apply edince worker'ı kuran Kubernetes operatörü, Helm chart + kind e2e ile paketleme ve Arc testnet'te canlı doğrulama.

**Architecture:** `@arclight/operator` KFC (kubernetes-fluent-client) ile `Indexer` CR'larını watch eder; level-triggered reconcile her seferinde istenen durumu (ServiceAccount + Role + RoleBinding + config ConfigMap + worker Deployment) baştan hesaplayıp SSA ile uygular. Worker'a dokunulmaz — Part 1'in env/config sözleşmesi (DATABASE_URL, CONFIG_PATH) aynen kullanılır; worker'a yalnızca opsiyonel CR-status-patch yeteneği eklenir. Temizlik ownerReferences + Kubernetes GC ile yapılır. Status iki yazarlıdır: operatör provizyon koşullarını merge-patch'ler, worker `phase/currentBlock/headBlock/lag/lastError` alanlarını SSA (`fieldManager=arclight-worker`) ile patch'ler — alan kümeleri ayrıktır.

**Tech Stack:** Part 1 stack'i + kubernetes-fluent-client ^3.11.7, Helm 3, kind, js-yaml (test).

**Spec:** `docs/superpowers/specs/2026-07-03-arclight-mvp-design.md` (§5 CRD/operatör, §8 test piramidi, §9 M3–M5).

## Spec'ten bilinçli sapmalar (onaylanmadan değiştirme)

1. **Finalizer yerine ownerReferences:** Spec §5 finalizer der; temizlenecek tek şey K8s kaynakları (Deployment + ConfigMap + SA/RBAC) ve DB'ye kasıtlı dokunulmuyor — dış kaynak olmadığından ownerReferences + GC aynı davranış sözleşmesini (CR silinince worker kaynakları gider, DB kalır) stuck-deletion riski olmadan verir. E2E bu sözleşmeyi test eder.
2. **CRD'ye `network.finalityTag` eklendi** (enum `finalized|safe|latest`, default `finalized`): spec örneğinde yok ama `WorkerConfig`'te var ve anvil tabanlı e2e `latest` gerektiriyor. Arc için default değişmez.
3. **SSA field-manager ayrımı nüansı:** KFC `Apply` fieldManager'ı `"pepr"` olarak hardcode eder, `PatchStatus` ise `/status`'a merge-patch atar. Operatör status'a yalnız `conditions/observedGeneration` yazar (merge-patch), worker kendi alanlarını raw SSA (`fieldManager=arclight-worker`, force) ile yazar — iki yazar ayrılığı alan-kümesi ayrıklığıyla garanti edilir.
4. **Worker'ın status patch'i KFC ile değil ~60 satır raw HTTPS ile:** worker imajına KFC bağımlılığı sokmamak için; in-cluster ServiceAccount token + CA ile `application/apply-patch+yaml`.

## Global Constraints

- Node >= 22, `"type": "module"`, TS `module: NodeNext`, `strict: true` (Part 1'den).
- Paket: `@arclight/operator`; core'a `workspace:*` ile bağlanır. KFC yalnızca watch/apply/patch sarmalayıcısı olarak kullanılır (spec §10 riski) — reconcile mantığı bizde.
- CRD: grup `arclight.dev`, versiyon `v1alpha1`, kind `Indexer`, plural `indexers`, namespaced, status subresource açık, printer kolonları `PHASE / CURRENT / HEAD / LAG`.
- Fazlar: `Provisioning → Backfilling → Live → Degraded` (worker yazar); operatör koşulu: `Provisioned True/False`.
- Worker kaynak adları: Deployment/SA `arclight-<cr>`, ConfigMap `arclight-<cr>-config`, Role/Binding `arclight-<cr>-status`; 63 karakter aşımı açık hata.
- Worker env sözleşmesi (Part 1): `DATABASE_URL` (Secret'tan), `CONFIG_PATH=/etc/arclight/config/config.json`, `HEALTH_PORT=9090`; yeni opsiyonel: `INDEXER_CR_NAME`, `INDEXER_CR_NAMESPACE` (ikisi de varsa CR status patch açılır).
- ABI mount yolu: `/etc/arclight/abis/<contractName>/<key>`; config mount: `/etc/arclight/config/config.json`.
- İmajlar: tek Dockerfile, hedefler `worker` ve `operator` (`docker build --target ...`).
- Arc testnet: chainId **5042002**, RPC `https://arc-testnet.drpc.org`, explorer `https://testnet.arcscan.app/`.
- kind cluster adları: geliştirme `arclight-dev`, e2e `arclight-e2e`.
- Geliştirme makinesi gereksinimleri: Docker, Foundry (`anvil`, `forge`, `cast`), **kind, kubectl, helm** (yeni).
- Commit mesajları conventional commits; her task kendi commit'iyle biter.

## File Structure

```
packages/core/src/crd.ts                     # IndexerSpecSchema, IndexerStatus, renderWorkerConfig, configHash
packages/core/test/crd.test.ts
packages/operator/
  package.json  tsconfig.json  vitest.config.ts
  src/kinds.ts        # Indexer GenericKind + RegisterKind
  src/resources.ts    # istenen worker kaynaklarını üreten saf fonksiyonlar
  src/kube.ts         # KubeApi arayüzü + KFC implementasyonu (mock edilebilir sınır)
  src/reconcile.ts    # level-triggered reconcile + Provisioned koşulu
  src/main.ts         # watch + resync + health; yalnızca kablolama
  test/kinds.test.ts  test/crd-manifest.test.ts  test/resources.test.ts  test/reconcile.test.ts
charts/arclight/
  Chart.yaml  values.yaml  .helmignore
  crds/indexer.yaml
  templates/_helpers.tpl  templates/serviceaccount.yaml  templates/rbac.yaml
  templates/deployment.yaml  templates/NOTES.txt
packages/worker/src/status.ts                # blok takibi eklenir (mevcut dosya)
packages/worker/src/pipeline.ts              # setBlocks çağrıları (mevcut dosya)
packages/worker/src/crstatus.ts              # raw SSA status patcher
packages/worker/src/main.ts                  # crstatus kablolama (mevcut dosya)
packages/worker/test/crstatus.test.ts
packages/worker/scripts/demo-seed.ts         # RPC_URL env parametresi (mevcut dosya)
packages/worker/scripts/arc-preflight.ts     # M5 ağ teyit script'i
Dockerfile                                   # multi-target: worker + operator (mevcut dosya)
docker-compose.dev.yml                       # target: worker (mevcut dosya)
docker-compose.arc.yml                       # M5: postgres + worker (Arc testnet)
e2e/
  package.json  tsconfig.json  vitest.config.ts
  fixtures/postgres.yaml  fixtures/anvil.yaml
  manifests/demo-secret.yaml  manifests/demo-abi-configmap.yaml  manifests/demo-indexer.yaml
  helpers/sh.ts
  scripts/e2e-setup.sh
  kind.test.ts
scripts/kind-dev.sh                          # M3 smoke ortamı
.github/workflows/ci.yml                     # helm lint adımı + e2e job (mevcut dosya)
README.md
manifests/arc-testnet/
  usdc-abi.json  worker-config.json
  k8s/usdc-abi-configmap.yaml  k8s/indexer.yaml  k8s/pg-dsn-secret.example.yaml
docs/arc-testnet-validation.md               # M5 raporu
```

Sorumluluklar: `crd.ts` = CR spec ↔ worker config köprüsü (saf); `resources.ts` = istenen K8s nesneleri (saf); `kube.ts` = tüm cluster erişimi; `reconcile.ts` = karar mantığı (KFC bilmez, `KubeApi` görür); `main.ts` = kablolama. Worker'daki `crstatus.ts` = tüm K8s erişimi (worker'ın geri kalanı K8s bilmez).

---

### Task 1: CRD tipleri + worker-config render (core) — M3

**Files:**
- Create: `packages/core/src/crd.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/crd.test.ts`

**Interfaces:**
- Consumes: `WorkerConfigSchema`, `WorkerConfig` (`./config.js`, Part 1).
- Produces: `IndexerSpecSchema` (zod), `IndexerSpec`, `IndexerPhase`, `IndexerCondition`, `IndexerStatus` tipleri; `renderWorkerConfig(crName: string, spec: IndexerSpec): WorkerConfig`; `configHash(config: WorkerConfig): string` (16 hex); sabitler `ABI_MOUNT_DIR = '/etc/arclight/abis'`, `CONFIG_MOUNT_PATH = '/etc/arclight/config/config.json'`. Task 4–7 bunları kullanır.

Not: contract `name` alanı hem Postgres tablo adına (snake_case) hem K8s volume adına gider; bu yüzden DNS-1123 uyumlu kısıtlanır: `^[a-z][a-z0-9-]{0,29}$`.

- [ ] **Step 1: Failing test yaz**

`packages/core/test/crd.test.ts`:
```ts
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
```

- [ ] **Step 2: Testin FAIL ettiğini doğrula**

Run: `pnpm --filter @arclight/core test`
Expected: FAIL — `IndexerSpecSchema` export edilmiyor.

- [ ] **Step 3: Implementasyonu yaz**

`packages/core/src/crd.ts`:
```ts
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { WorkerConfigSchema, type WorkerConfig } from './config.js';

export const ABI_MOUNT_DIR = '/etc/arclight/abis';
export const CONFIG_MOUNT_PATH = '/etc/arclight/config/config.json';

export const IndexerSpecSchema = z.object({
  network: z.object({
    chainId: z.number().int().positive(),
    rpc: z.array(z.string().url()).min(1),
    finalityTag: z.enum(['finalized', 'safe', 'latest']).default('finalized'),
  }),
  storage: z.object({
    mode: z.literal('External'),
    external: z.object({
      dsnSecretRef: z.object({
        name: z.string().min(1),
        key: z.string().min(1).default('url'),
      }),
    }),
  }),
  contracts: z
    .array(
      z.object({
        // tablo adına (snake_case) ve K8s volume adına gider — DNS-1123 uyumlu
        name: z.string().regex(/^[a-z][a-z0-9-]{0,29}$/, 'contract adı: küçük harf, rakam, tire; harfle başlar; <=30'),
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'geçersiz EVM adresi'),
        abi: z.object({
          configMapRef: z.object({
            name: z.string().min(1),
            key: z.string().min(1).default('abi.json'),
          }),
        }),
        startBlock: z.number().int().nonnegative().default(0),
        events: z.array(z.string().min(1)).default([]),
      }),
    )
    .min(1),
  polling: z
    .object({
      batchBlocks: z.number().int().positive().default(1000),
      intervalMs: z.number().int().positive().default(2000),
    })
    .default({}),
});

export type IndexerSpec = z.infer<typeof IndexerSpecSchema>;

export type IndexerPhase = 'Provisioning' | 'Backfilling' | 'Live' | 'Degraded';

export interface IndexerCondition {
  type: 'Provisioned';
  status: 'True' | 'False';
  reason: string;
  message?: string;
  lastTransitionTime: string;
}

export interface IndexerStatus {
  phase?: IndexerPhase;
  currentBlock?: number;
  headBlock?: number;
  lag?: number;
  lastError?: string;
  observedGeneration?: number;
  conditions?: IndexerCondition[];
}

export function renderWorkerConfig(crName: string, spec: IndexerSpec): WorkerConfig {
  return WorkerConfigSchema.parse({
    indexerName: crName,
    network: spec.network,
    contracts: spec.contracts.map((c) => ({
      name: c.name,
      address: c.address,
      abiPath: `${ABI_MOUNT_DIR}/${c.name}/${c.abi.configMapRef.key}`,
      startBlock: c.startBlock,
      events: c.events,
    })),
    polling: spec.polling,
  });
}

export function configHash(config: WorkerConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 16);
}
```

`packages/core/src/index.ts` sonuna ekle:
```ts
export {
  ABI_MOUNT_DIR,
  CONFIG_MOUNT_PATH,
  IndexerSpecSchema,
  configHash,
  renderWorkerConfig,
  type IndexerCondition,
  type IndexerPhase,
  type IndexerSpec,
  type IndexerStatus,
} from './crd.js';
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `pnpm --filter @arclight/core test && pnpm --filter @arclight/core build && pnpm lint`
Expected: PASS (mevcut testler dahil hepsi yeşil).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/crd.ts packages/core/src/index.ts packages/core/test/crd.test.ts
git commit -m "feat(core): Indexer CRD zod şeması, worker-config render ve config hash"
```

---

### Task 2: Operatör paket iskeleti + Indexer kind kaydı — M3

**Files:**
- Create: `packages/operator/package.json`, `packages/operator/tsconfig.json`, `packages/operator/vitest.config.ts`, `packages/operator/src/kinds.ts`
- Test: `packages/operator/test/kinds.test.ts`

**Interfaces:**
- Consumes: `IndexerSpec`, `IndexerStatus` (`@arclight/core`, Task 1); KFC `GenericKind`, `RegisterKind`, `modelToGroupVersionKind`.
- Produces: `Indexer` sınıfı (`class Indexer extends GenericKind { spec?: IndexerSpec; status?: IndexerStatus }`), modül import edilince GVK kaydı yapılmış olur. Task 5–6 `K8s(Indexer)` çağrılarında kullanır.

- [ ] **Step 1: Paket dosyalarını yaz**

`packages/operator/package.json`:
```json
{
  "name": "@arclight/operator",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "@arclight/core": "workspace:*",
    "kubernetes-fluent-client": "^3.11.7",
    "pino": "^9.7.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "js-yaml": "^4.1.0"
  }
}
```

`packages/operator/tsconfig.json` (worker'ınkiyle aynı desen):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

`packages/operator/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 2: Failing test yaz**

`packages/operator/test/kinds.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { GenericKind, modelToGroupVersionKind } from 'kubernetes-fluent-client';
import { Indexer } from '../src/kinds.js';

describe('Indexer kind kaydı', () => {
  it('GenericKind türevidir ve GVK kayıtlıdır', () => {
    expect(new Indexer()).toBeInstanceOf(GenericKind);
    const gvk = modelToGroupVersionKind(Indexer.name);
    expect(gvk).toMatchObject({
      group: 'arclight.dev',
      version: 'v1alpha1',
      kind: 'Indexer',
      plural: 'indexers',
    });
  });
});
```

Run: `pnpm install && pnpm --filter @arclight/operator test`
Expected: FAIL — `src/kinds.ts` yok. (`pnpm install` yeni paketi workspace'e bağlar.)

- [ ] **Step 3: kinds.ts yaz**

`packages/operator/src/kinds.ts`:
```ts
import { GenericKind, RegisterKind } from 'kubernetes-fluent-client';
import type { IndexerSpec, IndexerStatus } from '@arclight/core';

export class Indexer extends GenericKind {
  spec?: IndexerSpec;
  status?: IndexerStatus;
}

RegisterKind(Indexer, {
  group: 'arclight.dev',
  version: 'v1alpha1',
  kind: 'Indexer',
  plural: 'indexers',
});
```

- [ ] **Step 4: Testin geçtiğini doğrula**

Run: `pnpm --filter @arclight/core build && pnpm --filter @arclight/operator test && pnpm -r build && pnpm lint`
Expected: PASS. (KFC'nin `modelToGroupVersionKind` export'u yoksa test importunu KFC kaynak yapısına göre uyarlayın — sınıf adıyla `gvkMap`'e kayıt `RegisterKind`'ın sözleşmesidir.)

- [ ] **Step 5: Commit**

```bash
git add packages/operator pnpm-lock.yaml
git commit -m "feat(operator): paket iskeleti ve Indexer GenericKind kaydı"
```

---

### Task 3: Indexer CRD manifesti + tutarlılık testi — M3

**Files:**
- Create: `charts/arclight/crds/indexer.yaml`
- Test: `packages/operator/test/crd-manifest.test.ts`

**Interfaces:**
- Produces: `kubectl apply -f charts/arclight/crds/indexer.yaml` ile kurulabilen CRD; Helm (Task 9) `crds/` klasörünü otomatik kurar. Task 8/10 bu dosyayı apply eder.

- [ ] **Step 1: Failing test yaz**

`packages/operator/test/crd-manifest.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const path = fileURLToPath(
  new URL('../../../charts/arclight/crds/indexer.yaml', import.meta.url),
);

interface CrdDoc {
  metadata: { name: string };
  spec: {
    group: string;
    scope: string;
    names: { kind: string; plural: string; shortNames?: string[] };
    versions: Array<{
      name: string;
      subresources?: { status?: object };
      additionalPrinterColumns?: Array<{ name: string; jsonPath: string; type: string }>;
      schema: { openAPIV3Schema: { properties: { spec: { properties: Record<string, unknown> } } } };
    }>;
  };
}

describe('Indexer CRD manifesti', () => {
  const crd = load(readFileSync(path, 'utf8')) as CrdDoc;
  const v = crd.spec.versions[0]!;

  it('GVK ve scope doğru', () => {
    expect(crd.metadata.name).toBe('indexers.arclight.dev');
    expect(crd.spec.group).toBe('arclight.dev');
    expect(crd.spec.scope).toBe('Namespaced');
    expect(crd.spec.names).toMatchObject({ kind: 'Indexer', plural: 'indexers' });
    expect(v.name).toBe('v1alpha1');
  });

  it('status subresource açık', () => {
    expect(v.subresources?.status).toBeDefined();
  });

  it('printer kolonları PHASE/CURRENT/HEAD/LAG', () => {
    expect(v.additionalPrinterColumns?.map((c) => [c.name, c.jsonPath])).toEqual([
      ['Phase', '.status.phase'],
      ['Current', '.status.currentBlock'],
      ['Head', '.status.headBlock'],
      ['Lag', '.status.lag'],
    ]);
  });

  it('spec şeması zod ile aynı üst alanları tanımlar', () => {
    expect(Object.keys(v.schema.openAPIV3Schema.properties.spec.properties).sort()).toEqual(
      ['contracts', 'network', 'polling', 'storage'],
    );
  });
});
```

Run: `pnpm --filter @arclight/operator test`
Expected: FAIL — yaml dosyası yok.

- [ ] **Step 2: CRD manifestini yaz**

`charts/arclight/crds/indexer.yaml`:
```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: indexers.arclight.dev
spec:
  group: arclight.dev
  names:
    kind: Indexer
    listKind: IndexerList
    plural: indexers
    singular: indexer
    shortNames: [idx]
  scope: Namespaced
  versions:
    - name: v1alpha1
      served: true
      storage: true
      subresources:
        status: {}
      additionalPrinterColumns:
        - name: Phase
          type: string
          jsonPath: .status.phase
        - name: Current
          type: integer
          jsonPath: .status.currentBlock
        - name: Head
          type: integer
          jsonPath: .status.headBlock
        - name: Lag
          type: integer
          jsonPath: .status.lag
      schema:
        openAPIV3Schema:
          type: object
          required: [spec]
          properties:
            spec:
              type: object
              required: [network, storage, contracts]
              properties:
                network:
                  type: object
                  required: [chainId, rpc]
                  properties:
                    chainId:
                      type: integer
                      minimum: 1
                    rpc:
                      type: array
                      minItems: 1
                      items:
                        type: string
                    finalityTag:
                      type: string
                      enum: [finalized, safe, latest]
                      default: finalized
                storage:
                  type: object
                  required: [mode, external]
                  properties:
                    mode:
                      type: string
                      enum: [External]
                    external:
                      type: object
                      required: [dsnSecretRef]
                      properties:
                        dsnSecretRef:
                          type: object
                          required: [name]
                          properties:
                            name:
                              type: string
                            key:
                              type: string
                              default: url
                contracts:
                  type: array
                  minItems: 1
                  items:
                    type: object
                    required: [name, address, abi]
                    properties:
                      name:
                        type: string
                        pattern: "^[a-z][a-z0-9-]{0,29}$"
                      address:
                        type: string
                        pattern: "^0x[0-9a-fA-F]{40}$"
                      abi:
                        type: object
                        required: [configMapRef]
                        properties:
                          configMapRef:
                            type: object
                            required: [name]
                            properties:
                              name:
                                type: string
                              key:
                                type: string
                                default: abi.json
                      startBlock:
                        type: integer
                        minimum: 0
                        default: 0
                      events:
                        type: array
                        items:
                          type: string
                polling:
                  type: object
                  properties:
                    batchBlocks:
                      type: integer
                      minimum: 1
                      default: 1000
                    intervalMs:
                      type: integer
                      minimum: 1
                      default: 2000
            status:
              type: object
              properties:
                phase:
                  type: string
                  enum: [Provisioning, Backfilling, Live, Degraded]
                currentBlock:
                  type: integer
                headBlock:
                  type: integer
                lag:
                  type: integer
                lastError:
                  type: string
                observedGeneration:
                  type: integer
                conditions:
                  type: array
                  items:
                    type: object
                    required: [type, status, reason, lastTransitionTime]
                    properties:
                      type:
                        type: string
                      status:
                        type: string
                      reason:
                        type: string
                      message:
                        type: string
                      lastTransitionTime:
                        type: string
```

- [ ] **Step 3: Testin geçtiğini doğrula**

Run: `pnpm --filter @arclight/operator test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add charts/arclight/crds/indexer.yaml packages/operator/test/crd-manifest.test.ts
git commit -m "feat(operator): Indexer CRD manifesti (status subresource + printer kolonları)"
```

---

### Task 4: resources.ts — istenen worker kaynakları — M3

**Files:**
- Create: `packages/operator/src/resources.ts`
- Test: `packages/operator/test/resources.test.ts`

**Interfaces:**
- Consumes: `renderWorkerConfig`, `configHash`, `ABI_MOUNT_DIR`, `CONFIG_MOUNT_PATH`, `IndexerSpec` (Task 1).
- Produces:
  - `interface OwnerRef { name: string; uid: string }`
  - `interface DesiredResources { configMap; serviceAccount; role; roleBinding; deployment; hash: string }` (KFC `kind.ConfigMap` vb. tipleriyle)
  - `desiredResources(input: { namespace: string; owner: OwnerRef; spec: IndexerSpec; workerImage: string }): DesiredResources`
  - `workerResourceName(crName: string): string` → `arclight-<cr>`, 63 karakteri aşarsa throw.
  Task 5 (reconcile) bunları apply eder.

- [ ] **Step 1: Failing test yaz**

`packages/operator/test/resources.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { IndexerSpecSchema, configHash, renderWorkerConfig } from '@arclight/core';
import { desiredResources, workerResourceName } from '../src/resources.js';

const ADDR = `0x${'ab'.repeat(20)}`;
const spec = IndexerSpecSchema.parse({
  network: { chainId: 31337, rpc: ['http://anvil:8545'], finalityTag: 'latest' },
  storage: { mode: 'External', external: { dsnSecretRef: { name: 'pg-dsn', key: 'url' } } },
  contracts: [
    { name: 'emitter', address: ADDR, abi: { configMapRef: { name: 'emitter-abi' } } },
    { name: 'ikinci', address: ADDR, abi: { configMapRef: { name: 'ikinci-abi', key: 'k.json' } } },
  ],
});
const input = {
  namespace: 'default',
  owner: { name: 'demo', uid: 'uid-123' },
  spec,
  workerImage: 'arclight-worker:test',
};

describe('workerResourceName', () => {
  it('arclight- öneki ekler, 63 karakteri aşınca fırlatır', () => {
    expect(workerResourceName('demo')).toBe('arclight-demo');
    expect(() => workerResourceName('x'.repeat(60))).toThrow(/63/);
  });
});

describe('desiredResources', () => {
  const d = desiredResources(input);

  it('tüm kaynaklarda ownerReference ve isimler doğru', () => {
    for (const r of [d.configMap, d.serviceAccount, d.role, d.roleBinding, d.deployment]) {
      expect(r.metadata?.ownerReferences?.[0]).toMatchObject({
        apiVersion: 'arclight.dev/v1alpha1',
        kind: 'Indexer',
        name: 'demo',
        uid: 'uid-123',
        controller: true,
      });
      expect(r.metadata?.namespace).toBe('default');
    }
    expect(d.deployment.metadata?.name).toBe('arclight-demo');
    expect(d.configMap.metadata?.name).toBe('arclight-demo-config');
    expect(d.role.metadata?.name).toBe('arclight-demo-status');
  });

  it('config ConfigMap render edilmiş worker config içerir ve hash eşleşir', () => {
    const rendered = renderWorkerConfig('demo', spec);
    expect(JSON.parse(d.configMap.data!['config.json']!)).toEqual(
      JSON.parse(JSON.stringify(rendered)),
    );
    expect(d.hash).toBe(configHash(rendered));
    expect(d.deployment.spec?.template.metadata?.annotations).toEqual({
      'arclight.dev/config-hash': d.hash,
    });
  });

  it('deployment: tek replika, Recreate, env ve probe sözleşmesi', () => {
    expect(d.deployment.spec?.replicas).toBe(1);
    expect(d.deployment.spec?.strategy?.type).toBe('Recreate');
    const c = d.deployment.spec!.template.spec!.containers[0]!;
    expect(c.image).toBe('arclight-worker:test');
    expect(c.env).toContainEqual({
      name: 'DATABASE_URL',
      valueFrom: { secretKeyRef: { name: 'pg-dsn', key: 'url' } },
    });
    expect(c.env).toContainEqual({ name: 'CONFIG_PATH', value: '/etc/arclight/config/config.json' });
    expect(c.env).toContainEqual({ name: 'INDEXER_CR_NAME', value: 'demo' });
    expect(c.livenessProbe?.httpGet?.path).toBe('/metrics');
    expect(c.readinessProbe?.httpGet?.path).toBe('/healthz');
  });

  it('her contract için ABI volume + mount üretir', () => {
    const volumes = d.deployment.spec!.template.spec!.volumes!;
    expect(volumes.map((v) => v.name)).toEqual(['config', 'abi-emitter', 'abi-ikinci']);
    const mounts = d.deployment.spec!.template.spec!.containers[0]!.volumeMounts!;
    expect(mounts).toContainEqual({
      name: 'abi-ikinci',
      mountPath: '/etc/arclight/abis/ikinci',
      readOnly: true,
    });
    expect(volumes[2]!.configMap?.name).toBe('ikinci-abi');
  });

  it('role yalnızca kendi CR statusunu patch edebilir', () => {
    expect(d.role.rules).toEqual([
      {
        apiGroups: ['arclight.dev'],
        resources: ['indexers/status'],
        verbs: ['patch'],
        resourceNames: ['demo'],
      },
    ]);
    expect(d.roleBinding.subjects?.[0]).toMatchObject({
      kind: 'ServiceAccount',
      name: 'arclight-demo',
      namespace: 'default',
    });
    expect(d.roleBinding.roleRef.name).toBe('arclight-demo-status');
  });
});
```

Run: `pnpm --filter @arclight/operator test`
Expected: FAIL — `resources.ts` yok.

- [ ] **Step 2: Implementasyonu yaz**

`packages/operator/src/resources.ts`:
```ts
import {
  ABI_MOUNT_DIR,
  CONFIG_MOUNT_PATH,
  configHash,
  renderWorkerConfig,
  type IndexerSpec,
} from '@arclight/core';
import type { kind } from 'kubernetes-fluent-client';

export interface OwnerRef {
  name: string;
  uid: string;
}

export interface DesiredResources {
  configMap: kind.ConfigMap;
  serviceAccount: kind.ServiceAccount;
  role: kind.Role;
  roleBinding: kind.RoleBinding;
  deployment: kind.Deployment;
  hash: string;
}

export function workerResourceName(crName: string): string {
  const name = `arclight-${crName}`;
  if (name.length > 63) throw new Error(`kaynak adı 63 karakteri aşıyor: ${name}`);
  return name;
}

function ownerReferences(owner: OwnerRef) {
  return [
    {
      apiVersion: 'arclight.dev/v1alpha1',
      kind: 'Indexer',
      name: owner.name,
      uid: owner.uid,
      controller: true,
      blockOwnerDeletion: true,
    },
  ];
}

function labels(crName: string): Record<string, string> {
  return {
    'app.kubernetes.io/name': 'arclight-worker',
    'app.kubernetes.io/instance': crName,
    'app.kubernetes.io/managed-by': 'arclight-operator',
  };
}

export function desiredResources(input: {
  namespace: string;
  owner: OwnerRef;
  spec: IndexerSpec;
  workerImage: string;
}): DesiredResources {
  const { namespace, owner, spec, workerImage } = input;
  const base = workerResourceName(owner.name);
  const meta = (name: string) => ({
    name,
    namespace,
    labels: labels(owner.name),
    ownerReferences: ownerReferences(owner),
  });

  const workerConfig = renderWorkerConfig(owner.name, spec);
  const hash = configHash(workerConfig);

  const configMap: kind.ConfigMap = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: meta(`${base}-config`),
    data: { 'config.json': JSON.stringify(workerConfig, null, 2) },
  };

  const serviceAccount: kind.ServiceAccount = {
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: meta(base),
  };

  const role: kind.Role = {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: meta(`${base}-status`),
    rules: [
      {
        apiGroups: ['arclight.dev'],
        resources: ['indexers/status'],
        verbs: ['patch'],
        resourceNames: [owner.name],
      },
    ],
  };

  const roleBinding: kind.RoleBinding = {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: meta(`${base}-status`),
    subjects: [{ kind: 'ServiceAccount', name: base, namespace }],
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'Role',
      name: `${base}-status`,
    },
  };

  const deployment: kind.Deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: meta(base),
    spec: {
      replicas: 1,
      strategy: { type: 'Recreate' },
      selector: {
        matchLabels: {
          'app.kubernetes.io/name': 'arclight-worker',
          'app.kubernetes.io/instance': owner.name,
        },
      },
      template: {
        metadata: {
          labels: labels(owner.name),
          annotations: { 'arclight.dev/config-hash': hash },
        },
        spec: {
          serviceAccountName: base,
          containers: [
            {
              name: 'worker',
              image: workerImage,
              env: [
                {
                  name: 'DATABASE_URL',
                  valueFrom: {
                    secretKeyRef: {
                      name: spec.storage.external.dsnSecretRef.name,
                      key: spec.storage.external.dsnSecretRef.key,
                    },
                  },
                },
                { name: 'CONFIG_PATH', value: CONFIG_MOUNT_PATH },
                { name: 'HEALTH_PORT', value: '9090' },
                { name: 'INDEXER_CR_NAME', value: owner.name },
                {
                  name: 'INDEXER_CR_NAMESPACE',
                  valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } },
                },
              ],
              ports: [{ containerPort: 9090, name: 'health' }],
              livenessProbe: {
                httpGet: { path: '/metrics', port: 9090 },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              readinessProbe: {
                httpGet: { path: '/healthz', port: 9090 },
                initialDelaySeconds: 3,
                periodSeconds: 5,
              },
              resources: {
                requests: { cpu: '50m', memory: '128Mi' },
                limits: { memory: '512Mi' },
              },
              volumeMounts: [
                { name: 'config', mountPath: '/etc/arclight/config', readOnly: true },
                ...spec.contracts.map((c) => ({
                  name: `abi-${c.name}`,
                  mountPath: `${ABI_MOUNT_DIR}/${c.name}`,
                  readOnly: true,
                })),
              ],
            },
          ],
          volumes: [
            { name: 'config', configMap: { name: `${base}-config` } },
            ...spec.contracts.map((c) => ({
              name: `abi-${c.name}`,
              configMap: { name: c.abi.configMapRef.name },
            })),
          ],
        },
      },
    },
  };

  return { configMap, serviceAccount, role, roleBinding, deployment, hash };
}
```

Not: `kind.Role` / `kind.RoleBinding` KFC'nin `kind` haritasında yoksa (build hatası verir), bu iki alan için `KubernetesObject` tipini kullanın ve Task 5'te apply ederken `RegisterKind` ile `GenericKind` türevi kaydedin — davranış aynı kalır.

- [ ] **Step 3: Testlerin geçtiğini doğrula**

Run: `pnpm --filter @arclight/operator test && pnpm -r build && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/operator/src/resources.ts packages/operator/test/resources.test.ts
git commit -m "feat(operator): CR'dan istenen worker kaynaklarını üreten saf üreticiler"
```

---

### Task 5: kube.ts + reconcile.ts — level-triggered reconcile — M3

**Files:**
- Create: `packages/operator/src/kube.ts`, `packages/operator/src/reconcile.ts`
- Test: `packages/operator/test/reconcile.test.ts`

**Interfaces:**
- Consumes: `desiredResources`, `Indexer` (Task 2/4); `IndexerSpecSchema`, `IndexerCondition`, `IndexerStatus` (Task 1).
- Produces:
  - `interface KubeApi { getConfigMap(ns, name): Promise<kind.ConfigMap | null>; getSecret(ns, name): Promise<kind.Secret | null>; applyConfigMap(cm): Promise<void>; applyServiceAccount(sa): Promise<void>; applyRole(r): Promise<void>; applyRoleBinding(rb): Promise<void>; applyDeployment(d): Promise<void>; patchIndexerStatus(ns: string, name: string, status: IndexerStatus): Promise<void>; listIndexers(): Promise<Indexer[]> }`
  - `createKubeApi(): KubeApi` (KFC implementasyonu)
  - `interface ReconcileDeps { kube: KubeApi; workerImage: string; log: Logger }`
  - `reconcile(deps: ReconcileDeps, cr: Indexer): Promise<void>`
  Task 6 (main) bunları kablolar.

- [ ] **Step 1: Failing test yaz**

`packages/operator/test/reconcile.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import type { kind } from 'kubernetes-fluent-client';
import type { IndexerStatus } from '@arclight/core';
import type { Indexer } from '../src/kinds.js';
import type { KubeApi } from '../src/kube.js';
import { reconcile } from '../src/reconcile.js';

const log = pino({ level: 'silent' });
const ADDR = `0x${'ab'.repeat(20)}`;

function makeCr(): Indexer {
  return {
    apiVersion: 'arclight.dev/v1alpha1',
    kind: 'Indexer',
    metadata: { name: 'demo', namespace: 'default', uid: 'uid-1', generation: 3 },
    spec: {
      network: { chainId: 31337, rpc: ['http://anvil:8545'] },
      storage: { mode: 'External', external: { dsnSecretRef: { name: 'pg-dsn', key: 'url' } } },
      contracts: [
        { name: 'emitter', address: ADDR, abi: { configMapRef: { name: 'emitter-abi', key: 'abi.json' } } },
      ],
    },
  } as Indexer;
}

interface FakeKube extends KubeApi {
  applied: string[];
  statusPatches: IndexerStatus[];
}

function makeFake(opts: { cms?: Record<string, Record<string, string>>; secrets?: Record<string, Record<string, string>> } = {}): FakeKube {
  const cms = opts.cms ?? { 'emitter-abi': { 'abi.json': '[]' } };
  const secrets = opts.secrets ?? { 'pg-dsn': { url: 'ZHNu' } };
  const fake: FakeKube = {
    applied: [],
    statusPatches: [],
    getConfigMap: (_ns, name) =>
      Promise.resolve(cms[name] ? ({ data: cms[name] } as kind.ConfigMap) : null),
    getSecret: (_ns, name) =>
      Promise.resolve(secrets[name] ? ({ data: secrets[name] } as kind.Secret) : null),
    applyConfigMap: (cm) => { fake.applied.push(`ConfigMap/${cm.metadata?.name}`); return Promise.resolve(); },
    applyServiceAccount: (sa) => { fake.applied.push(`ServiceAccount/${sa.metadata?.name}`); return Promise.resolve(); },
    applyRole: (r) => { fake.applied.push(`Role/${r.metadata?.name}`); return Promise.resolve(); },
    applyRoleBinding: (rb) => { fake.applied.push(`RoleBinding/${rb.metadata?.name}`); return Promise.resolve(); },
    applyDeployment: (d) => { fake.applied.push(`Deployment/${d.metadata?.name}`); return Promise.resolve(); },
    patchIndexerStatus: (_ns, _name, status) => { fake.statusPatches.push(status); return Promise.resolve(); },
    listIndexers: () => Promise.resolve([]),
  };
  return fake;
}

describe('reconcile', () => {
  it('mutlu yol: 5 kaynak apply + Provisioned=True', async () => {
    const kube = makeFake();
    await reconcile({ kube, workerImage: 'w:test', log }, makeCr());
    expect(kube.applied).toEqual([
      'ServiceAccount/arclight-demo',
      'Role/arclight-demo-status',
      'RoleBinding/arclight-demo-status',
      'ConfigMap/arclight-demo-config',
      'Deployment/arclight-demo',
    ]);
    expect(kube.statusPatches).toHaveLength(1);
    expect(kube.statusPatches[0]!.observedGeneration).toBe(3);
    expect(kube.statusPatches[0]!.conditions?.[0]).toMatchObject({
      type: 'Provisioned',
      status: 'True',
      reason: 'Reconciled',
    });
  });

  it('ABI ConfigMap yoksa: apply yok, Provisioned=False/MissingAbiConfigMap', async () => {
    const kube = makeFake({ cms: {} });
    await reconcile({ kube, workerImage: 'w:test', log }, makeCr());
    expect(kube.applied).toEqual([]);
    expect(kube.statusPatches[0]!.conditions?.[0]).toMatchObject({
      status: 'False',
      reason: 'MissingAbiConfigMap',
    });
  });

  it('ABI ConfigMap var ama anahtar yoksa: Provisioned=False', async () => {
    const kube = makeFake({ cms: { 'emitter-abi': { 'baska.json': '[]' } } });
    await reconcile({ kube, workerImage: 'w:test', log }, makeCr());
    expect(kube.applied).toEqual([]);
    expect(kube.statusPatches[0]!.conditions?.[0]!.reason).toBe('MissingAbiConfigMap');
  });

  it('DSN Secret yoksa: Provisioned=False/MissingDsnSecret', async () => {
    const kube = makeFake({ secrets: {} });
    await reconcile({ kube, workerImage: 'w:test', log }, makeCr());
    expect(kube.applied).toEqual([]);
    expect(kube.statusPatches[0]!.conditions?.[0]!.reason).toBe('MissingDsnSecret');
  });

  it('geçersiz spec: Provisioned=False/InvalidSpec', async () => {
    const kube = makeFake();
    const cr = makeCr();
    (cr.spec as { contracts: unknown }).contracts = [];
    await reconcile({ kube, workerImage: 'w:test', log }, cr);
    expect(kube.applied).toEqual([]);
    expect(kube.statusPatches[0]!.conditions?.[0]!.reason).toBe('InvalidSpec');
  });

  it('metadata eksikse hiçbir çağrı yapmaz', async () => {
    const kube = makeFake();
    await reconcile({ kube, workerImage: 'w:test', log }, { metadata: {} } as Indexer);
    expect(kube.applied).toEqual([]);
    expect(kube.statusPatches).toEqual([]);
  });
});
```

Run: `pnpm --filter @arclight/operator test`
Expected: FAIL — `kube.ts` / `reconcile.ts` yok.

- [ ] **Step 2: kube.ts yaz**

`packages/operator/src/kube.ts`:
```ts
import { K8s, kind } from 'kubernetes-fluent-client';
import type { IndexerStatus } from '@arclight/core';
import { Indexer } from './kinds.js';

export interface KubeApi {
  getConfigMap(namespace: string, name: string): Promise<kind.ConfigMap | null>;
  getSecret(namespace: string, name: string): Promise<kind.Secret | null>;
  applyConfigMap(cm: kind.ConfigMap): Promise<void>;
  applyServiceAccount(sa: kind.ServiceAccount): Promise<void>;
  applyRole(role: kind.Role): Promise<void>;
  applyRoleBinding(rb: kind.RoleBinding): Promise<void>;
  applyDeployment(d: kind.Deployment): Promise<void>;
  patchIndexerStatus(namespace: string, name: string, status: IndexerStatus): Promise<void>;
  listIndexers(): Promise<Indexer[]>;
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 404;
}

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export function createKubeApi(): KubeApi {
  return {
    getConfigMap: (ns, name) => orNull(K8s(kind.ConfigMap).InNamespace(ns).Get(name)),
    getSecret: (ns, name) => orNull(K8s(kind.Secret).InNamespace(ns).Get(name)),
    async applyConfigMap(cm) {
      await K8s(kind.ConfigMap).Apply(cm, { force: true });
    },
    async applyServiceAccount(sa) {
      await K8s(kind.ServiceAccount).Apply(sa, { force: true });
    },
    async applyRole(role) {
      await K8s(kind.Role).Apply(role, { force: true });
    },
    async applyRoleBinding(rb) {
      await K8s(kind.RoleBinding).Apply(rb, { force: true });
    },
    async applyDeployment(d) {
      await K8s(kind.Deployment).Apply(d, { force: true });
    },
    async patchIndexerStatus(namespace, name, status) {
      await K8s(Indexer).PatchStatus({
        apiVersion: 'arclight.dev/v1alpha1',
        kind: 'Indexer',
        metadata: { name, namespace },
        status,
      } as Indexer);
    },
    async listIndexers() {
      const list = await K8s(Indexer).Get();
      return list.items;
    },
  };
}
```

- [ ] **Step 3: reconcile.ts yaz**

`packages/operator/src/reconcile.ts`:
```ts
import type { Logger } from 'pino';
import { IndexerSpecSchema, type IndexerCondition } from '@arclight/core';
import type { Indexer } from './kinds.js';
import type { KubeApi } from './kube.js';
import { desiredResources } from './resources.js';

export interface ReconcileDeps {
  kube: KubeApi;
  workerImage: string;
  log: Logger;
}

function condition(
  status: 'True' | 'False',
  reason: string,
  message?: string,
): IndexerCondition {
  return {
    type: 'Provisioned',
    status,
    reason,
    ...(message ? { message } : {}),
    lastTransitionTime: new Date().toISOString(),
  };
}

export async function reconcile(deps: ReconcileDeps, cr: Indexer): Promise<void> {
  const name = cr.metadata?.name;
  const namespace = cr.metadata?.namespace;
  const uid = cr.metadata?.uid;
  if (!name || !namespace || !uid) return;

  const setCondition = (c: IndexerCondition) =>
    deps.kube.patchIndexerStatus(namespace, name, {
      observedGeneration: cr.metadata?.generation,
      conditions: [c],
    });

  const parsed = IndexerSpecSchema.safeParse(cr.spec);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    await setCondition(condition('False', 'InvalidSpec', detail));
    return;
  }
  const spec = parsed.data;

  for (const c of spec.contracts) {
    const ref = c.abi.configMapRef;
    const cm = await deps.kube.getConfigMap(namespace, ref.name);
    if (!cm?.data?.[ref.key]) {
      await setCondition(
        condition('False', 'MissingAbiConfigMap', `ConfigMap ${ref.name}/${ref.key} bulunamadı`),
      );
      return;
    }
  }

  const dsnRef = spec.storage.external.dsnSecretRef;
  const secret = await deps.kube.getSecret(namespace, dsnRef.name);
  if (!secret?.data?.[dsnRef.key]) {
    await setCondition(
      condition('False', 'MissingDsnSecret', `Secret ${dsnRef.name}/${dsnRef.key} bulunamadı`),
    );
    return;
  }

  const desired = desiredResources({
    namespace,
    owner: { name, uid },
    spec,
    workerImage: deps.workerImage,
  });
  await deps.kube.applyServiceAccount(desired.serviceAccount);
  await deps.kube.applyRole(desired.role);
  await deps.kube.applyRoleBinding(desired.roleBinding);
  await deps.kube.applyConfigMap(desired.configMap);
  await deps.kube.applyDeployment(desired.deployment);
  await setCondition(condition('True', 'Reconciled'));
  deps.log.info({ indexer: name, namespace, hash: desired.hash }, 'reconcile tamam');
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `pnpm --filter @arclight/operator test && pnpm -r build && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/operator/src/kube.ts packages/operator/src/reconcile.ts packages/operator/test/reconcile.test.ts
git commit -m "feat(operator): KubeApi sınırı ve level-triggered reconcile + Provisioned koşulu"
```

---

### Task 6: Operatör main.ts + Dockerfile hedefleri — M3

**Files:**
- Create: `packages/operator/src/main.ts`
- Modify: `Dockerfile`, `docker-compose.dev.yml`

**Interfaces:**
- Consumes: `createKubeApi`, `reconcile`, `Indexer` (Task 2/5).
- Produces: `node dist/main.js` ile çalışan operatör. Env sözleşmesi: `WORKER_IMAGE` (zorunlu), `RESYNC_INTERVAL_MS` (vars. `300000`), `HEALTH_PORT` (vars. `8080`), `LOG_LEVEL`. İmaj hedefleri: `docker build --target worker|operator`. Task 8–10 bunları kullanır.

- [ ] **Step 1: main.ts yaz**

`packages/operator/src/main.ts`:
```ts
import { createServer } from 'node:http';
import { pino } from 'pino';
import { K8s, WatchPhase } from 'kubernetes-fluent-client';
import { Indexer } from './kinds.js';
import { createKubeApi } from './kube.js';
import { reconcile, type ReconcileDeps } from './reconcile.js';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

async function main(): Promise<void> {
  const workerImage = process.env['WORKER_IMAGE'];
  if (!workerImage) throw new Error('WORKER_IMAGE zorunlu');
  const resyncMs = Number(process.env['RESYNC_INTERVAL_MS'] ?? 300_000);
  const healthPort = Number(process.env['HEALTH_PORT'] ?? 8080);

  const deps: ReconcileDeps = { kube: createKubeApi(), workerImage, log };

  const safeReconcile = async (cr: Indexer): Promise<void> => {
    try {
      await reconcile(deps, cr);
    } catch (err) {
      log.error({ err, indexer: cr.metadata?.name }, 'reconcile hatası');
    }
  };

  const health = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.end('ok');
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  health.listen(healthPort);

  // silinen CR'ın temizliği ownerReferences + GC'de; Deleted'da iş yok
  const watcher = K8s(Indexer).Watch((cr, phase) => {
    if (phase === WatchPhase.Deleted) return;
    void safeReconcile(cr);
  });
  await watcher.start();

  const resync = setInterval(() => {
    deps.kube
      .listIndexers()
      .then(async (crs) => {
        for (const cr of crs) await safeReconcile(cr);
      })
      .catch((err: unknown) => log.error({ err }, 'resync hatası'));
  }, resyncMs);

  const shutdown = (): void => {
    log.info('kapanma sinyali alındı');
    clearInterval(resync);
    watcher.close();
    health.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  log.info({ workerImage, resyncMs }, 'arclight operatör başladı');
}

main().catch((err: unknown) => {
  log.fatal({ err }, 'operatör başlatılamadı');
  process.exit(1);
});
```

Not: `WatchPhase` KFC'den export edilir (`Added|Modified|Deleted`). Export adı farklıysa `kubernetes-fluent-client`'ın `dist` tip bildirimlerinden doğrulayıp uyarlayın; string karşılığı `"DELETED"`.

- [ ] **Step 2: Dockerfile'ı çok-hedefli yap**

`Dockerfile` (tamamını değiştir):
```dockerfile
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/worker/package.json packages/worker/
COPY packages/operator/package.json packages/operator/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
RUN pnpm -r build \
  && pnpm --filter @arclight/worker deploy --legacy --prod /out/worker \
  && pnpm --filter @arclight/operator deploy --legacy --prod /out/operator

FROM node:22-slim AS worker
WORKDIR /app
COPY --from=build /out/worker .
USER node
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]

FROM node:22-slim AS operator
WORKDIR /app
COPY --from=build /out/operator .
USER node
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
```

`docker-compose.dev.yml` içinde worker servisinin `build: .` satırını şununla değiştir:
```yaml
    build:
      context: .
      target: worker
```

- [ ] **Step 3: Build + imajları doğrula**

Run:
```bash
pnpm -r build && pnpm lint
docker build --target worker -t arclight-worker:dev .
docker build --target operator -t arclight-operator:dev .
docker compose -f docker-compose.dev.yml build
```
Expected: dördü de başarılı. Ayrıca compose demosunun hâlâ çalıştığını hızlıca teyit et:
```bash
docker compose -f docker-compose.dev.yml up -d
sleep 5 && curl -s localhost:9090/healthz
docker compose -f docker-compose.dev.yml down -v
```
Expected: healthz JSON döner (`phase` alanı var).

- [ ] **Step 4: Commit**

```bash
git add packages/operator/src/main.ts Dockerfile docker-compose.dev.yml
git commit -m "feat(operator): watch+resync main döngüsü ve çok-hedefli Dockerfile (worker|operator)"
```

---

### Task 7: Worker CR status patcher — M3

**Files:**
- Modify: `packages/worker/src/status.ts`, `packages/worker/src/pipeline.ts`, `packages/worker/src/main.ts`
- Create: `packages/worker/src/crstatus.ts`
- Test: `packages/worker/test/crstatus.test.ts`

**Interfaces:**
- Consumes: `PhaseTracker` (mevcut), Task 4'ün Deployment env sözleşmesi (`INDEXER_CR_NAME`, `INDEXER_CR_NAMESPACE`).
- Produces:
  - `PhaseTracker.setBlocks(current: bigint, head: bigint): void` + getter'lar `currentBlock`, `headBlock`, `lag` (bigint).
  - `interface CrStatusTarget { baseUrl: string; token: string; ca?: Buffer; namespace: string; name: string }`
  - `crStatusTargetFromEnv(env?: NodeJS.ProcessEnv): CrStatusTarget | null` — `INDEXER_CR_NAME` veya `KUBERNETES_SERVICE_HOST` yoksa `null`.
  - `patchCrStatus(target: CrStatusTarget, status: { phase: string; currentBlock: number; headBlock: number; lag: number; lastError?: string }): Promise<void>` — SSA (`application/apply-patch+yaml`, `fieldManager=arclight-worker&force=true`).
  - `startCrStatusLoop(target: CrStatusTarget, tracker: PhaseTracker, log: Logger, intervalMs?: number): () => void` — durdurma fonksiyonu döner.

- [ ] **Step 1: Failing test yaz**

`packages/worker/test/crstatus.test.ts`:
```ts
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crStatusTargetFromEnv, patchCrStatus, startCrStatusLoop } from '../src/crstatus.js';
import { PhaseTracker } from '../src/status.js';

interface Captured {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server;
let baseUrl: string;
let statusCode = 200;
const captured: Captured[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      captured.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.statusCode = statusCode;
      res.end('{}');
    });
  });
  server.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

const target = () => ({ baseUrl, token: 'test-token', namespace: 'default', name: 'demo' });

describe('crStatusTargetFromEnv', () => {
  it('INDEXER_CR_NAME yoksa null döner', () => {
    expect(crStatusTargetFromEnv({})).toBeNull();
  });
  it('KUBERNETES_SERVICE_HOST yoksa null döner', () => {
    expect(crStatusTargetFromEnv({ INDEXER_CR_NAME: 'demo' })).toBeNull();
  });
});

describe('patchCrStatus', () => {
  it('SSA apply-patch isteğini doğru atar', async () => {
    captured.length = 0;
    await patchCrStatus(target(), { phase: 'Live', currentBlock: 42, headBlock: 42, lag: 0 });
    expect(captured).toHaveLength(1);
    const r = captured[0]!;
    expect(r.method).toBe('PATCH');
    expect(r.url).toBe(
      '/apis/arclight.dev/v1alpha1/namespaces/default/indexers/demo/status'
      + '?fieldManager=arclight-worker&force=true&fieldValidation=Strict',
    );
    expect(r.headers.authorization).toBe('Bearer test-token');
    expect(r.headers['content-type']).toBe('application/apply-patch+yaml');
    const body = JSON.parse(r.body) as { status: { phase: string; currentBlock: number } };
    expect(body.status).toEqual({ phase: 'Live', currentBlock: 42, headBlock: 42, lag: 0 });
  });

  it('2xx dışı yanıtta reject eder', async () => {
    statusCode = 403;
    await expect(
      patchCrStatus(target(), { phase: 'Live', currentBlock: 1, headBlock: 1, lag: 0 }),
    ).rejects.toThrow(/403/);
    statusCode = 200;
  });
});

describe('startCrStatusLoop', () => {
  it('periyodik patch atar, tracker durumunu yansıtır ve durdurulabilir', async () => {
    captured.length = 0;
    const tracker = new PhaseTracker();
    tracker.set('Backfilling');
    tracker.setBlocks(10n, 100n);
    const stop = startCrStatusLoop(target(), tracker, pino({ level: 'silent' }), 25);
    await new Promise((r) => setTimeout(r, 90));
    stop();
    const seen = captured.length;
    expect(seen).toBeGreaterThanOrEqual(2);
    const body = JSON.parse(captured[0]!.body) as { status: { phase: string; lag: number } };
    expect(body.status.phase).toBe('Backfilling');
    expect(body.status.lag).toBe(90);
    await new Promise((r) => setTimeout(r, 60));
    expect(captured.length).toBe(seen); // durduktan sonra istek yok
  });
});
```

Run: `pnpm --filter @arclight/worker test crstatus`
Expected: FAIL — `crstatus.ts` yok / `setBlocks` yok.

- [ ] **Step 2: status.ts'i genişlet**

`packages/worker/src/status.ts` (tamamını değiştir):
```ts
export type Phase = 'Provisioning' | 'Backfilling' | 'Live' | 'Degraded';

export class PhaseTracker {
  #phase: Phase = 'Provisioning';
  #lastError: string | undefined;
  #currentBlock = 0n;
  #headBlock = 0n;

  get phase(): Phase {
    return this.#phase;
  }
  get lastError(): string | undefined {
    return this.#lastError;
  }
  get healthy(): boolean {
    return this.#phase !== 'Degraded';
  }
  get currentBlock(): bigint {
    return this.#currentBlock;
  }
  get headBlock(): bigint {
    return this.#headBlock;
  }
  get lag(): bigint {
    const d = this.#headBlock - this.#currentBlock;
    return d > 0n ? d : 0n;
  }
  set(phase: Phase, error?: string): void {
    this.#phase = phase;
    this.#lastError = error;
  }
  setBlocks(current: bigint, head: bigint): void {
    this.#currentBlock = current;
    this.#headBlock = head;
  }
}
```

- [ ] **Step 3: crstatus.ts yaz**

`packages/worker/src/crstatus.ts`:
```ts
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { Logger } from 'pino';
import type { PhaseTracker } from './status.js';

const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';

export interface CrStatusTarget {
  baseUrl: string;
  token: string;
  ca?: Buffer;
  namespace: string;
  name: string;
}

export interface CrRuntimeStatus {
  phase: string;
  currentBlock: number;
  headBlock: number;
  lag: number;
  lastError?: string;
}

export function crStatusTargetFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CrStatusTarget | null {
  const name = env['INDEXER_CR_NAME'];
  const host = env['KUBERNETES_SERVICE_HOST'];
  if (!name || !host) return null;
  const port = env['KUBERNETES_SERVICE_PORT_HTTPS'] ?? env['KUBERNETES_SERVICE_PORT'] ?? '443';
  const namespace =
    env['INDEXER_CR_NAMESPACE'] ?? readFileSync(`${SA_DIR}/namespace`, 'utf8').trim();
  return {
    baseUrl: `https://${host}:${port}`,
    token: readFileSync(`${SA_DIR}/token`, 'utf8').trim(),
    ca: readFileSync(`${SA_DIR}/ca.crt`),
    namespace,
    name,
  };
}

export function patchCrStatus(target: CrStatusTarget, status: CrRuntimeStatus): Promise<void> {
  const url = new URL(
    `/apis/arclight.dev/v1alpha1/namespaces/${target.namespace}/indexers/${target.name}/status`
      + '?fieldManager=arclight-worker&force=true&fieldValidation=Strict',
    target.baseUrl,
  );
  const body = JSON.stringify({
    apiVersion: 'arclight.dev/v1alpha1',
    kind: 'Indexer',
    metadata: { name: target.name, namespace: target.namespace },
    status,
  });
  const opts: RequestOptions = {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${target.token}`,
      'content-type': 'application/apply-patch+yaml',
      'content-length': Buffer.byteLength(body),
    },
    ...(target.ca ? { ca: target.ca } : {}),
  };
  const req = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const r = req(url, opts, (res) => {
      res.resume();
      if (res.statusCode !== undefined && res.statusCode < 300) resolve();
      else reject(new Error(`CR status patch başarısız: HTTP ${res.statusCode}`));
    });
    r.on('error', reject);
    r.end(body);
  });
}

export function startCrStatusLoop(
  target: CrStatusTarget,
  tracker: PhaseTracker,
  log: Logger,
  intervalMs = 10_000,
): () => void {
  const push = (): void => {
    void patchCrStatus(target, {
      phase: tracker.phase,
      currentBlock: Number(tracker.currentBlock),
      headBlock: Number(tracker.headBlock),
      lag: Number(tracker.lag),
      ...(tracker.lastError ? { lastError: tracker.lastError } : {}),
    }).catch((err: unknown) => log.warn({ err }, 'CR status patch başarısız'));
  };
  push();
  const t = setInterval(push, intervalMs);
  return () => clearInterval(t);
}
```

- [ ] **Step 4: pipeline ve main'e kablola**

`packages/worker/src/pipeline.ts` — `runOnce` içinde iki ekleme:

`metrics.blocksBehind.set(Number(finalized - cursor));` satırından hemen sonra:
```ts
  phase.setBlocks(cursor, finalized);
```

`metrics.blocksBehind.set(Number(finalized - range.toBlock));` satırından hemen sonra:
```ts
  phase.setBlocks(range.toBlock, finalized);
```

`packages/worker/src/main.ts`:

Import bloğuna ekle:
```ts
import { crStatusTargetFromEnv, startCrStatusLoop, type CrStatusTarget } from './crstatus.js';
```

`await bootstrapIndexer(deps);` satırından sonra ekle:
```ts
  let crTarget: CrStatusTarget | null = null;
  try {
    crTarget = crStatusTargetFromEnv();
  } catch (err) {
    log.warn({ err }, 'CR status hedefi kurulamadı — status patch kapalı');
  }
  const stopCrStatus = crTarget ? startCrStatusLoop(crTarget, phase, log) : (): void => {};
  if (crTarget) log.info({ cr: `${crTarget.namespace}/${crTarget.name}` }, 'CR status patch açık');
```

`await runLoop(deps, ctrl.signal);` satırından sonra (`server.close();` öncesine) ekle:
```ts
  stopCrStatus();
```

- [ ] **Step 5: Testlerin geçtiğini doğrula**

Run: `pnpm --filter @arclight/worker test && pnpm -r build && pnpm lint`
Expected: PASS — crstatus testleri dahil worker'ın tüm testleri (pipeline/deadletter entegrasyonları Docker + anvil ister) yeşil.

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/status.ts packages/worker/src/crstatus.ts packages/worker/src/pipeline.ts packages/worker/src/main.ts packages/worker/test/crstatus.test.ts
git commit -m "feat(worker): Indexer CR status'una SSA patch (fieldManager=arclight-worker)"
```

---

### Task 8: M3 kapanışı — kind üzerinde CR → çalışan worker smoke'u

**Files:**
- Create: `e2e/fixtures/postgres.yaml`, `e2e/fixtures/anvil.yaml`, `e2e/manifests/demo-secret.yaml`, `e2e/manifests/demo-abi-configmap.yaml`, `e2e/manifests/demo-indexer.yaml`, `scripts/kind-dev.sh`
- Modify: `packages/worker/scripts/demo-seed.ts` (RPC_URL parametresi)

**Interfaces:**
- Consumes: CRD manifesti (Task 3), worker imajı (Task 6), operatör (Task 5–6).
- Produces: Task 10'un e2e testinin aynen kullanacağı fixture/manifest'ler; M3 "bitti demek" kanıtı (lokal cluster'da CR → çalışan worker). Anvil'de ilk tx'in deterministik kontrat adresi: `0x5FbDB2315678afecb367f032d93F642f64180aa3`.

- [ ] **Step 1: Fixture'ları yaz**

`e2e/fixtures/postgres.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
spec:
  replicas: 1
  selector:
    matchLabels: { app: postgres }
  template:
    metadata:
      labels: { app: postgres }
    spec:
      containers:
        - name: postgres
          image: postgres:17-alpine
          env:
            - { name: POSTGRES_USER, value: arclight }
            - { name: POSTGRES_PASSWORD, value: arclight }
            - { name: POSTGRES_DB, value: arclight }
          ports:
            - containerPort: 5432
          readinessProbe:
            exec:
              command: [pg_isready, -U, arclight]
            periodSeconds: 2
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  selector: { app: postgres }
  ports:
    - port: 5432
```

`e2e/fixtures/anvil.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: anvil
spec:
  replicas: 1
  selector:
    matchLabels: { app: anvil }
  template:
    metadata:
      labels: { app: anvil }
    spec:
      containers:
        - name: anvil
          image: ghcr.io/foundry-rs/foundry:latest
          command: [anvil, --host, 0.0.0.0, --block-time, "1"]
          ports:
            - containerPort: 8545
---
apiVersion: v1
kind: Service
metadata:
  name: anvil
spec:
  selector: { app: anvil }
  ports:
    - port: 8545
```

- [ ] **Step 2: Demo manifest'leri yaz**

`e2e/manifests/demo-secret.yaml`:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: pg-dsn
stringData:
  url: postgres://arclight:arclight@postgres:5432/arclight
```

`e2e/manifests/demo-abi-configmap.yaml`:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: emitter-abi
data:
  abi.json: |
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

`e2e/manifests/demo-indexer.yaml`:
```yaml
apiVersion: arclight.dev/v1alpha1
kind: Indexer
metadata:
  name: demo
spec:
  network:
    chainId: 31337
    rpc: ["http://anvil:8545"]
    finalityTag: latest
  storage:
    mode: External
    external:
      dsnSecretRef: { name: pg-dsn, key: url }
  contracts:
    - name: emitter
      address: "0x5FbDB2315678afecb367f032d93F642f64180aa3"
      abi:
        configMapRef: { name: emitter-abi, key: abi.json }
      startBlock: 0
      events: []
  polling:
    batchBlocks: 100
    intervalMs: 1000
```

- [ ] **Step 3: kind-dev script'i + demo-seed parametresi**

`scripts/kind-dev.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
CLUSTER=${CLUSTER:-arclight-dev}

kind get clusters | grep -qx "$CLUSTER" || kind create cluster --name "$CLUSTER"
docker build --target worker -t arclight-worker:dev .
kind load docker-image arclight-worker:dev --name "$CLUSTER"
kubectl apply -f charts/arclight/crds/indexer.yaml
kubectl apply -f e2e/fixtures/
kubectl rollout status deploy/postgres deploy/anvil --timeout=120s

echo "Hazır. Operatörü lokal başlat:"
echo "  pnpm -r build && WORKER_IMAGE=arclight-worker:dev pnpm --filter @arclight/operator start"
```

`chmod +x scripts/kind-dev.sh`

`packages/worker/scripts/demo-seed.ts` içinde
```ts
  transport: http('http://127.0.0.1:8545'),
```
satırını şununla değiştir:
```ts
  transport: http(process.env['RPC_URL'] ?? 'http://127.0.0.1:8545'),
```

- [ ] **Step 4: Smoke'u uçtan uca koş (manuel, bir kez)**

```bash
./scripts/kind-dev.sh
pnpm -r build
WORKER_IMAGE=arclight-worker:dev pnpm --filter @arclight/operator start &   # kubeconfig ile lokal
kubectl port-forward deploy/anvil 8545:8545 &
pnpm --filter @arclight/worker demo:seed
kubectl apply -f e2e/manifests/
kubectl get indexer demo -w   # PHASE: Live, CURRENT/HEAD dolu, LAG 0 bekle
kubectl exec deploy/postgres -- psql -U arclight -t -c "select count(*) from idx_demo.emitter_ping"
kubectl delete indexer demo
kubectl get deploy arclight-demo   # NotFound bekle (GC)
kubectl exec deploy/postgres -- psql -U arclight -t -c "select count(*) from idx_demo.emitter_ping"
kill %1 %2
```
Expected: `PHASE=Live`, satır sayısı `10`; CR silinince Deployment gider, tablo ve 10 satır kalır. **Bu M3'ün kapanış kanıtıdır** — çıktıları not et (Task 13 raporuna girmez ama PR açıklamasına girer).

- [ ] **Step 5: Commit**

```bash
git add e2e/fixtures e2e/manifests scripts/kind-dev.sh packages/worker/scripts/demo-seed.ts
git commit -m "feat(e2e): kind fixture/manifest seti ve M3 smoke ortamı — M3 kapandı"
```

---

### Task 9: Helm chart — M4

**Files:**
- Create: `charts/arclight/Chart.yaml`, `charts/arclight/values.yaml`, `charts/arclight/.helmignore`, `charts/arclight/templates/_helpers.tpl`, `charts/arclight/templates/serviceaccount.yaml`, `charts/arclight/templates/rbac.yaml`, `charts/arclight/templates/deployment.yaml`, `charts/arclight/templates/NOTES.txt`
- Modify: `.github/workflows/ci.yml` (helm lint/template adımı)

**Interfaces:**
- Consumes: CRD (Task 3, `crds/` klasörü Helm tarafından otomatik kurulur), operatör imajı/env sözleşmesi (Task 6).
- Produces: `helm install arclight charts/arclight --set workerImage.tag=...` ile kurulabilen operatör; operatör Deployment adı `arclight-operator`. Task 10 bunu kullanır.

- [ ] **Step 1: Chart dosyalarını yaz**

`charts/arclight/Chart.yaml`:
```yaml
apiVersion: v2
name: arclight
description: Kubernetes-native contract-event indexer for Arc — operator chart
type: application
version: 0.1.0
appVersion: "0.1.0"
```

`charts/arclight/values.yaml`:
```yaml
image:
  repository: arclight-operator
  tag: dev
  pullPolicy: IfNotPresent

workerImage:
  repository: arclight-worker
  tag: dev

logLevel: info
resyncIntervalMs: 300000

resources:
  requests:
    cpu: 50m
    memory: 128Mi
  limits:
    memory: 256Mi
```

`charts/arclight/.helmignore`:
```
*.tgz
.DS_Store
```

`charts/arclight/templates/_helpers.tpl`:
```
{{- define "arclight.labels" -}}
app.kubernetes.io/name: arclight-operator
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
```

`charts/arclight/templates/serviceaccount.yaml`:
```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: arclight-operator
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "arclight.labels" . | nindent 4 }}
```

`charts/arclight/templates/rbac.yaml`:
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: arclight-operator
  labels:
    {{- include "arclight.labels" . | nindent 4 }}
rules:
  - apiGroups: [arclight.dev]
    resources: [indexers]
    verbs: [get, list, watch]
  - apiGroups: [arclight.dev]
    resources: [indexers/status]
    verbs: [patch]
  - apiGroups: [apps]
    resources: [deployments]
    verbs: [get, list, watch, create, patch]
  - apiGroups: [""]
    resources: [configmaps, serviceaccounts]
    verbs: [get, list, watch, create, patch]
  - apiGroups: [""]
    resources: [secrets]
    verbs: [get]
  - apiGroups: [rbac.authorization.k8s.io]
    resources: [roles, rolebindings]
    verbs: [get, list, watch, create, patch]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: arclight-operator
  labels:
    {{- include "arclight.labels" . | nindent 4 }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: arclight-operator
subjects:
  - kind: ServiceAccount
    name: arclight-operator
    namespace: {{ .Release.Namespace }}
```

`charts/arclight/templates/deployment.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: arclight-operator
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "arclight.labels" . | nindent 4 }}
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app.kubernetes.io/name: arclight-operator
  template:
    metadata:
      labels:
        {{- include "arclight.labels" . | nindent 8 }}
    spec:
      serviceAccountName: arclight-operator
      containers:
        - name: operator
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          env:
            - name: WORKER_IMAGE
              value: "{{ .Values.workerImage.repository }}:{{ .Values.workerImage.tag }}"
            - name: LOG_LEVEL
              value: {{ .Values.logLevel | quote }}
            - name: RESYNC_INTERVAL_MS
              value: {{ .Values.resyncIntervalMs | quote }}
          ports:
            - containerPort: 8080
              name: health
          livenessProbe:
            httpGet: { path: /healthz, port: 8080 }
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }
            initialDelaySeconds: 3
            periodSeconds: 5
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
```

`charts/arclight/templates/NOTES.txt`:
```
Arclight operatörü kuruldu.

Bir indexer başlatmak için 3 YAML yeter:
  1. DSN Secret'ı        (kubectl create secret generic pg-dsn --from-literal=url=postgres://...)
  2. ABI ConfigMap'i     (kubectl create configmap usdc-abi --from-file=abi.json)
  3. Indexer CR'ı        (kubectl apply -f indexer.yaml)

İzle: kubectl get indexers
```

- [ ] **Step 2: Lint + template doğrula**

Run:
```bash
helm lint charts/arclight
helm template arclight charts/arclight | grep -A1 'name: WORKER_IMAGE'
```
Expected: `1 chart(s) linted, 0 chart(s) failed`; template çıktısında `value: "arclight-worker:dev"`.

- [ ] **Step 3: CI'a helm adımı ekle**

`.github/workflows/ci.yml` — `test` job'ının son satırından (`- run: pnpm -r test`) sonra ekle:
```yaml
      - run: helm lint charts/arclight && helm template arclight charts/arclight > /dev/null
```

- [ ] **Step 4: Commit**

```bash
git add charts/arclight .github/workflows/ci.yml
git commit -m "feat(helm): operatör chart'ı (CRD + RBAC + Deployment) ve CI helm lint"
```

---

### Task 10: kind e2e testi + CI job — M4

**Files:**
- Create: `e2e/package.json`, `e2e/tsconfig.json`, `e2e/vitest.config.ts`, `e2e/helpers/sh.ts`, `e2e/scripts/e2e-setup.sh`, `e2e/kind.test.ts`
- Modify: `pnpm-workspace.yaml`, `package.json` (kök), `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: fixtures/manifests (Task 8), chart (Task 9), Dockerfile hedefleri (Task 6).
- Produces: `pnpm --filter @arclight/e2e test:e2e` — Helm install → CR apply → `Live` + 10 satır → CR delete → Deployment temiz, veri duruyor. Spec §8 madde 3'ün otomasyonu; **M4 "bitti demek"** kanıtı.

- [ ] **Step 1: e2e paketini kur**

`e2e/package.json`:
```json
{
  "name": "@arclight/e2e",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test:e2e": "vitest run"
  }
}
```
(`test` script'i bilinçli yok — `pnpm -r test` e2e'yi atlar; vitest binary'si kök devDependency'den PATH'e gelir.)

`e2e/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["."]
}
```

`e2e/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
```

`pnpm-workspace.yaml` (tamamı):
```yaml
packages:
  - packages/*
  - e2e
```

Kök `package.json` scripts bloğuna ekle:
```json
    "e2e": "pnpm --filter @arclight/e2e test:e2e",
```

- [ ] **Step 2: Yardımcılar + kurulum script'i**

`e2e/helpers/sh.ts`:
```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { ...opts, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

export async function retry<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs: number,
  everyMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn().catch(() => undefined as T);
    if (value !== undefined && ok(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(`retry zaman aşımı (${timeoutMs}ms): son değer ${JSON.stringify(value)}`);
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
```

`e2e/scripts/e2e-setup.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLUSTER=${CLUSTER:-arclight-e2e}

kind get clusters | grep -qx "$CLUSTER" || kind create cluster --name "$CLUSTER"
docker build --target worker -t arclight-worker:e2e "$ROOT"
docker build --target operator -t arclight-operator:e2e "$ROOT"
kind load docker-image arclight-worker:e2e arclight-operator:e2e --name "$CLUSTER"

helm upgrade --install arclight "$ROOT/charts/arclight" \
  --set image.tag=e2e --set workerImage.tag=e2e

kubectl apply -f "$ROOT/e2e/fixtures/"
kubectl rollout status deploy/postgres deploy/anvil deploy/arclight-operator --timeout=180s
```

`chmod +x e2e/scripts/e2e-setup.sh`

- [ ] **Step 3: e2e testini yaz**

`e2e/kind.test.ts`:
```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { retry, sh } from './helpers/sh.js';

const E2E_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));

const kubectl = (...args: string[]) => sh('kubectl', args);
const psqlCount = () =>
  kubectl(
    'exec', 'deploy/postgres', '--',
    'psql', '-U', 'arclight', '-t', '-A', '-c',
    'select count(*) from idx_demo.emitter_ping',
  );

let portForward: ChildProcess | undefined;

beforeAll(async () => {
  await sh('bash', [`${E2E_DIR}scripts/e2e-setup.sh`], { cwd: REPO });

  // anvil'i port-forward edip Emitter'ı deploy et + 10 event üret
  portForward = spawn('kubectl', ['port-forward', 'deploy/anvil', '8545:8545'], {
    stdio: 'ignore',
  });
  await retry(
    async () => {
      const res = await fetch('http://127.0.0.1:8545', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
      });
      return res.ok;
    },
    (ok) => ok,
    60_000,
    1_000,
  );
  await sh('pnpm', ['--filter', '@arclight/worker', 'demo:seed'], { cwd: REPO });
  portForward.kill();
});

afterAll(() => {
  portForward?.kill();
});

describe('kind e2e', () => {
  it('2-3 YAML → Live fazında indexer ve 10 satır', async () => {
    await kubectl('apply', '-f', `${E2E_DIR}manifests/`);

    const phase = await retry(
      () => kubectl('get', 'indexer', 'demo', '-o', 'jsonpath={.status.phase}'),
      (p) => p === 'Live',
      300_000,
    );
    expect(phase).toBe('Live');

    const count = await retry(psqlCount, (c) => c === '10', 120_000);
    expect(count).toBe('10');

    const table = await kubectl('get', 'indexer', 'demo');
    expect(table).toMatch(/PHASE/);
    expect(table).toMatch(/CURRENT/);
    expect(table).toMatch(/Live/);
  });

  it('CR silinince worker kaynakları temizlenir, veri kalır', async () => {
    await kubectl('delete', 'indexer', 'demo', '--wait=true');

    await retry(
      async () => {
        try {
          await kubectl('get', 'deploy', 'arclight-demo');
          return 'var';
        } catch {
          return 'yok';
        }
      },
      (s) => s === 'yok',
      120_000,
    );

    expect(await psqlCount()).toBe('10');
  });
});
```

- [ ] **Step 4: Lokal koş**

Run:
```bash
pnpm install && pnpm -r build
pnpm e2e
```
Expected: 2 test PASS (ilk koşu imaj build'leriyle ~5-10 dk). Temizlik: `kind delete cluster --name arclight-e2e`.

- [ ] **Step 5: CI e2e job'ı ekle**

`.github/workflows/ci.yml` — `test` job'ının altına aynı hizada ekle:
```yaml
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: foundry-rs/foundry-toolchain@v1
      - uses: helm/kind-action@v1
        with:
          cluster_name: arclight-e2e
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - run: pnpm e2e
```

- [ ] **Step 6: Commit + CI doğrula**

```bash
git add e2e pnpm-workspace.yaml package.json pnpm-lock.yaml .github/workflows/ci.yml
git commit -m "test(e2e): kind uçtan uca test (helm install -> CR -> Live -> temiz silme) ve CI job"
```
Push sonrası CI'da hem `test` hem `e2e` job'larının yeşil olduğunu doğrula.

---

### Task 11: README + quickstart — M4 kapanışı

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: chart (Task 9), CRD (Task 3), compose demo (Part 1), e2e (Task 10).
- Produces: "2-3 YAML → indexer" quickstart'ı; **M4 "bitti demek"** dokümantasyon ayağı.

- [ ] **Step 1: README'yi yaz**

`README.md`:
````markdown
# Arclight

Arc (Circle'ın stablecoin-odaklı EVM L1'i) için Kubernetes-native, self-hosted
contract-event indexer. Bir `Indexer` custom resource'u tanımlarsın; operatör
worker'ı kurar, worker şema/tabloları bootstrap edip event'leri **kendi
Postgres'ine** yazar — her event kendi tablosunda, doğrudan SQL ile okunur.

```
kubectl apply (ConfigMap[ABI] + Indexer CR + Secret[DSN])
        │ watch/reconcile
        ▼
[ Operator ] ──kurar──▶ worker Deployment + config ConfigMap
                              │
Arc RPC'ler ──finalized'a kadar poll──▶ [ Worker ] ──tek tx──▶ [ Postgres ]
                                            └──status patch──▶ Indexer .status
```

## Quickstart (3 YAML)

Önkoşul: çalışan bir Kubernetes cluster'ı ve erişilebilir bir Postgres.

```bash
# 1) Operatörü kur (CRD dahil)
helm install arclight charts/arclight \
  --set image.repository=<registry>/arclight-operator --set image.tag=<tag> \
  --set workerImage.repository=<registry>/arclight-worker --set workerImage.tag=<tag>

# 2) DSN Secret + ABI ConfigMap + Indexer CR
kubectl create secret generic pg-dsn --from-literal=url='postgres://user:pass@host:5432/db'
kubectl create configmap usdc-abi --from-file=abi.json=manifests/arc-testnet/usdc-abi.json
kubectl apply -f manifests/arc-testnet/k8s/indexer.yaml

# 3) İzle
kubectl get indexers
# NAME       PHASE   CURRENT   HEAD      LAG
# usdc-arc   Live    8123456   8123456   0
```

Veri: `idx_<indexer>` şemasında `<contract>_<event>` tabloları
(`idx_usdc_arc.usdc_transfer` gibi) + `_cursor`, `_meta`, `_dead_letter`
kontrol tabloları. CR silinince worker kaynakları temizlenir, **DB'ye
dokunulmaz**.

## Gözlemlenebilirlik

Worker `:9090/metrics` (Prometheus) ve `:9090/healthz` sunar:
`arclight_blocks_behind`, `arclight_events_ingested_total`,
`arclight_rpc_errors_total`, `arclight_last_processed_block`,
`arclight_dead_letter_total`, `arclight_write_latency_seconds`.

## Geliştirme

```bash
pnpm install
pnpm -r build && pnpm -r test        # birim + entegrasyon (Docker + Foundry gerekir)
docker compose -f docker-compose.dev.yml up   # operatörsüz lokal demo (anvil + pg)
pnpm demo:seed                                # demo kontratı deploy + 10 event
./scripts/kind-dev.sh                         # kind geliştirme ortamı
pnpm e2e                                      # kind uçtan uca test (kind + helm gerekir)
```

Tasarım: `docs/superpowers/specs/2026-07-03-arclight-mvp-design.md` ·
Arc testnet doğrulaması: `docs/arc-testnet-validation.md`
````

- [ ] **Step 2: Quickstart komutlarını sözleşmelere karşı kontrol et**

Run: `helm template arclight charts/arclight --set workerImage.tag=x > /dev/null && ls manifests/arc-testnet/usdc-abi.json 2>/dev/null || echo "arc manifestleri Task 12'de gelecek"`
Expected: template hatasız; arc manifest'i henüz yoksa uyarı satırı (Task 12 tamamlayacak — README bu haliyle commit edilebilir).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README ve 3-YAML quickstart — M4 kapandı"
```

---

### Task 12: Arc preflight script'i + arc-testnet manifest'leri — M5

**Files:**
- Create: `packages/worker/scripts/arc-preflight.ts`, `manifests/arc-testnet/usdc-abi.json`, `manifests/arc-testnet/worker-config.json`, `manifests/arc-testnet/k8s/usdc-abi-configmap.yaml`, `manifests/arc-testnet/k8s/indexer.yaml`, `manifests/arc-testnet/k8s/pg-dsn-secret.example.yaml`, `docker-compose.arc.yml`
- Modify: `packages/worker/package.json`, kök `package.json` (script)

**Interfaces:**
- Consumes: viem (Part 1), worker config şeması.
- Produces: `pnpm arc:preflight` — chainId/finality/getLogs teyidi + önerilen `startBlock`; Task 13'ün koşacağı compose ortamı ve k8s manifest'leri. **USDC adresi bu task'ta keşfedilir ve dosyalara gömülür** (aşağıda Step 1).

- [ ] **Step 1: Arc testnet USDC adresini teyit et (elle, bir kez)**

```bash
# 1) https://testnet.arcscan.app/ adresinde "USDC" ara; token kontrat adresini al.
# 2) Adresi zincir üzerinde teyit et (Foundry cast):
cast call <ADAY_ADRES> "symbol()(string)"  --rpc-url https://arc-testnet.drpc.org   # "USDC" beklenir
cast call <ADAY_ADRES> "decimals()(uint8)" --rpc-url https://arc-testnet.drpc.org   # 6 beklenir
```
Teyit edilen adres aşağıdaki adımlarda `<USDC_ADDRESS>` yerine **gerçek değer olarak** yazılır. Teyit başarısızsa (sembol USDC değilse) durup explorer'da doğru kontratı bulun; spec §2 bu adımı M5'e bilinçli bırakmıştır.

- [ ] **Step 2: Preflight script'ini yaz**

`packages/worker/scripts/arc-preflight.ts`:
```ts
import { createPublicClient, http, parseAbiItem } from 'viem';

const rpcUrl = process.env['ARC_RPC_URL'] ?? 'https://arc-testnet.drpc.org';
const usdc = process.env['USDC_ADDRESS'] as `0x${string}` | undefined;
const EXPECTED_CHAIN_ID = 5042002;

const client = createPublicClient({ transport: http(rpcUrl) });

const chainId = await client.getChainId();
console.log(
  `chainId: ${chainId} (beklenen ${EXPECTED_CHAIN_ID}) → ${chainId === EXPECTED_CHAIN_ID ? 'OK' : 'UYUŞMAZLIK'}`,
);

const latest = await client.getBlock({ blockTag: 'latest' });
const finalized = await client.getBlock({ blockTag: 'finalized' });
console.log(`latest:    ${latest.number} @ ${new Date(Number(latest.timestamp) * 1000).toISOString()}`);
console.log(`finalized: ${finalized.number} @ ${new Date(Number(finalized.timestamp) * 1000).toISOString()}`);
console.log(`finality lag: ${latest.number - finalized.number} blok`);

if (usdc) {
  const fromBlock = finalized.number > 999n ? finalized.number - 999n : 0n;
  const logs = await client.getLogs({
    address: usdc,
    event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
    fromBlock,
    toBlock: finalized.number,
  });
  console.log(`USDC Transfer [${fromBlock}..${finalized.number}]: ${logs.length} log`);
  const suggested = finalized.number > 5000n ? finalized.number - 5000n : 0n;
  console.log(`önerilen startBlock: ${suggested}`);
} else {
  console.log('USDC_ADDRESS verilmedi — getLogs probu atlandı');
}
```

`packages/worker/package.json` scripts bloğuna ekle:
```json
    "arc:preflight": "node --experimental-strip-types scripts/arc-preflight.ts"
```

Kök `package.json` scripts bloğuna ekle:
```json
    "arc:preflight": "pnpm --filter @arclight/worker arc:preflight",
```

- [ ] **Step 3: Script'i anvil'e karşı smoke-test et**

Run:
```bash
anvil --port 8545 & sleep 2
ARC_RPC_URL=http://127.0.0.1:8545 pnpm arc:preflight
kill %1
```
Expected: `chainId: 31337 (beklenen 5042002) → UYUŞMAZLIK` satırı ve latest/finalized blok çıktıları — script mismatch'te bile rapor verir, exit 0. (Gerçek ağ teyidi Task 13'te.)

- [ ] **Step 4: Manifest'leri yaz**

`manifests/arc-testnet/usdc-abi.json`:
```json
[
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      { "name": "from", "type": "address", "indexed": true },
      { "name": "to", "type": "address", "indexed": true },
      { "name": "value", "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "Approval",
    "inputs": [
      { "name": "owner", "type": "address", "indexed": true },
      { "name": "spender", "type": "address", "indexed": true },
      { "name": "value", "type": "uint256", "indexed": false }
    ]
  }
]
```

`manifests/arc-testnet/worker-config.json` — `<USDC_ADDRESS>` Step 1'den, `<START_BLOCK>` Step 2/3 preflight çıktısındaki "önerilen startBlock" değerinden (Task 13'te gerçek ağa karşı koşulunca güncellenir):
```json
{
  "indexerName": "arc-usdc",
  "network": {
    "chainId": 5042002,
    "rpc": ["https://arc-testnet.drpc.org"],
    "finalityTag": "finalized"
  },
  "contracts": [
    {
      "name": "usdc",
      "address": "<USDC_ADDRESS>",
      "abiPath": "/etc/arclight/usdc-abi.json",
      "startBlock": 0,
      "events": ["Transfer", "Approval"]
    }
  ],
  "polling": { "batchBlocks": 1000, "intervalMs": 2000 }
}
```

`docker-compose.arc.yml`:
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

  worker:
    build:
      context: .
      target: worker
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://arclight:arclight@postgres:5432/arclight
      CONFIG_PATH: /etc/arclight/worker-config.json
    volumes:
      - ./manifests/arc-testnet:/etc/arclight:ro
    ports: ["9090:9090"]
```

`manifests/arc-testnet/k8s/usdc-abi-configmap.yaml` — `data.abi.json` içeriği `usdc-abi.json` ile birebir aynı:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: usdc-abi
data:
  abi.json: |
    [
      {
        "type": "event",
        "name": "Transfer",
        "inputs": [
          { "name": "from", "type": "address", "indexed": true },
          { "name": "to", "type": "address", "indexed": true },
          { "name": "value", "type": "uint256", "indexed": false }
        ]
      },
      {
        "type": "event",
        "name": "Approval",
        "inputs": [
          { "name": "owner", "type": "address", "indexed": true },
          { "name": "spender", "type": "address", "indexed": true },
          { "name": "value", "type": "uint256", "indexed": false }
        ]
      }
    ]
```

`manifests/arc-testnet/k8s/indexer.yaml` (`<USDC_ADDRESS>`/`<START_BLOCK>` yukarıdaki gibi):
```yaml
apiVersion: arclight.dev/v1alpha1
kind: Indexer
metadata:
  name: usdc-arc
spec:
  network:
    chainId: 5042002
    rpc: ["https://arc-testnet.drpc.org"]
  storage:
    mode: External
    external:
      dsnSecretRef: { name: pg-dsn, key: url }
  contracts:
    - name: usdc
      address: "<USDC_ADDRESS>"
      abi:
        configMapRef: { name: usdc-abi, key: abi.json }
      startBlock: 0
      events: [Transfer, Approval]
```

`manifests/arc-testnet/k8s/pg-dsn-secret.example.yaml`:
```yaml
# Örnektir: gerçek DSN'inizi koyup dosyayı commit ETMEDEN apply edin,
# ya da: kubectl create secret generic pg-dsn --from-literal=url='postgres://...'
apiVersion: v1
kind: Secret
metadata:
  name: pg-dsn
stringData:
  url: postgres://KULLANICI:PAROLA@HOST:5432/VERITABANI
```

- [ ] **Step 5: Doğrula + Commit**

Run: `pnpm lint && node -e "JSON.parse(require('node:fs').readFileSync('manifests/arc-testnet/worker-config.json','utf8')); console.log('json ok')"`
Expected: lint temiz, `json ok`.

```bash
git add packages/worker/scripts/arc-preflight.ts packages/worker/package.json package.json manifests/arc-testnet docker-compose.arc.yml
git commit -m "feat(arc): preflight script'i, Arc testnet USDC manifest'leri ve compose ortamı"
```

---

### Task 13: Arc testnet canlı doğrulama + rapor — M5 kapanışı

**Files:**
- Create: `docs/arc-testnet-validation.md`
- Modify (gerekirse): `manifests/arc-testnet/worker-config.json` (`startBlock` güncellemesi)

**Interfaces:**
- Consumes: Task 12'nin compose ortamı + preflight'ı; worker (Part 1).
- Produces: spec §2/§8-4/§9-M5'in kanıtı — gerçek ağda `Live` faz, lag ~0, rapor. **MVP burada biter.**

Bu task ağ erişimi ister ve süre ölçümü içerir; adımlar sırayla, çıktılar rapora kopyalanarak yürütülür.

- [ ] **Step 1: Preflight'ı gerçek ağa karşı koş**

Run: `USDC_ADDRESS=<Task12-Step1-adresi> pnpm arc:preflight`
Expected: `chainId: 5042002 → OK`; `finalized` tag çalışıyor (blok numarası dönüyor); finality lag ve Transfer log sayısı yazdırılıyor. Çıktının tamamını kaydet (rapora girecek). `finalized` tag desteklenmiyorsa veya sapma varsa: **dur**, spec §2 gereği cursor stratejisi gözden geçirilir — bulguyu rapora yaz ve kullanıcıyla görüş.

- [ ] **Step 2: startBlock'u güncelle ve worker'ı başlat**

`manifests/arc-testnet/worker-config.json` içindeki `"startBlock": 0` değerini preflight'ın önerdiği değerle değiştir (yaklaşık `finalized - 5000`; tam backfill MVP doğrulaması için gereksiz).

```bash
docker compose -f docker-compose.arc.yml up --build -d
```

- [ ] **Step 3: Backfill → Live geçişini izle**

```bash
watch -n 5 'curl -s localhost:9090/healthz; echo; curl -s localhost:9090/metrics | grep -E "arclight_(blocks_behind|events_ingested_total|last_processed_block|dead_letter_total)"'
```
Expected: faz `Backfilling` → `Live`; `arclight_blocks_behind` 0'a iner. Satırları kontrol et:
```bash
docker compose -f docker-compose.arc.yml exec postgres \
  psql -U arclight -c "select count(*) from idx_arc_usdc.usdc_transfer;" \
       -c "select count(*) from idx_arc_usdc.usdc_approval;" \
       -c "select count(*) from idx_arc_usdc._dead_letter;"
```
Expected: transfer > 0, dead_letter = 0.

- [ ] **Step 4: 15 dakika canlı izle**

En az 15 dk sonra tekrar ölç: faz `Live` kalmalı, `arclight_blocks_behind` ≤ 5, transfer sayısı artmış olmalı (Arc testnet'te USDC trafiği varsa; yoksa `cast send` ile kendi transferinizi üretin — rapora not düşün).

- [ ] **Step 5: Raporu yaz**

`docs/arc-testnet-validation.md` — aşağıdaki iskeleti gerçek ölçümlerle doldur:
```markdown
# Arc Testnet Doğrulama Raporu (M5)

> Tarih: <koşu tarihi> · Worker imajı: <git sha> · RPC: https://arc-testnet.drpc.org

## Ağ parametre teyidi (spec §2)
- chainId: 5042002 → OK/FAIL
- `finalized` tag: destekleniyor mu, latest-finalized farkı: <n> blok
- `eth_getLogs`: 1000 bloklu aralıkta sorun var mı (limit/hata): <gözlem>
- USDC kontratı: <adres> (symbol=USDC, decimals=6 teyitli)

## Koşu
- startBlock: <n> · backfill süresi: <süre> · Live'a geçiş: <blok/saat>
- Satırlar: usdc_transfer=<n>, usdc_approval=<n>, _dead_letter=0
- 15 dk canlı izleme: blocks_behind aralığı <min>-<max>, faz kesintisi yok/var

## Sonuç
- Cursor stratejisi değişikliği gerekli mi: hayır/evet (+gerekçe)
- Açık konular: <varsa>
```

- [ ] **Step 6: Kapat + Commit**

```bash
docker compose -f docker-compose.arc.yml down
git add docs/arc-testnet-validation.md manifests/arc-testnet/worker-config.json
git commit -m "docs(arc): Arc testnet canlı doğrulama raporu — M5 ve MVP kapandı"
```

---

## Self-Review Notları

- **Spec kapsaması:** §5 CRD/reconcile/RBAC/printer → Task 1–6; §5 status iki-yazarlı → Task 5 (operatör) + Task 7 (worker); §8-3 kind e2e → Task 10; §9 M4 Helm/README → Task 9/11; §9 M5 + §2 ağ teyidi → Task 12–13. Finalizer sapması ve finalityTag eklentisi başta "Spec'ten bilinçli sapmalar"da gerekçeli.
- **Tip tutarlılığı:** `IndexerSpec/IndexerStatus` (Task 1) → kinds.ts (Task 2) → resources/reconcile (Task 4–5) → CRD yaml (Task 3) aynı alan adlarını kullanır; worker env adları Task 4 (üretici) ve Task 7 (tüketici) arasında birebir (`INDEXER_CR_NAME`, `INDEXER_CR_NAMESPACE`).
- **Dış API riski:** KFC `kind.Role`/`WatchPhase`/`modelToGroupVersionKind` export'ları v3.11 tip bildirimlerinden doğrulandı; yine de Task 2/4/6 notlarında sapma halinde uyarlama talimatı var.
- **Bilinen sınırlar (MVP, bilinçli):** eksik ConfigMap/Secret yalnızca ~5 dk'lık resync ile yeniden denenir (ayrı watch yok); operatör metriği yok (healthz var); CRD Helm upgrade'de güncellenmez (Helm `crds/` davranışı — README'de not).
