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

function makeFake(
  opts: {
    cms?: Record<string, Record<string, string>>;
    secrets?: Record<string, Record<string, string>>;
  } = {},
): FakeKube {
  const cms = opts.cms ?? { 'emitter-abi': { 'abi.json': '[]' } };
  const secrets = opts.secrets ?? { 'pg-dsn': { url: 'ZHNu' } };
  const fake: FakeKube = {
    applied: [],
    statusPatches: [],
    getConfigMap: (_ns, name) =>
      Promise.resolve(cms[name] ? ({ data: cms[name] } as kind.ConfigMap) : null),
    getSecret: (_ns, name) =>
      Promise.resolve(secrets[name] ? ({ data: secrets[name] } as kind.Secret) : null),
    applyConfigMap: (cm) => {
      fake.applied.push(`ConfigMap/${cm.metadata?.name}`);
      return Promise.resolve();
    },
    applyServiceAccount: (sa) => {
      fake.applied.push(`ServiceAccount/${sa.metadata?.name}`);
      return Promise.resolve();
    },
    applyRole: (r) => {
      fake.applied.push(`Role/${r.metadata?.name}`);
      return Promise.resolve();
    },
    applyRoleBinding: (rb) => {
      fake.applied.push(`RoleBinding/${rb.metadata?.name}`);
      return Promise.resolve();
    },
    applyDeployment: (d) => {
      fake.applied.push(`Deployment/${d.metadata?.name}`);
      return Promise.resolve();
    },
    patchIndexerStatus: (_ns, _name, status) => {
      fake.statusPatches.push(status);
      return Promise.resolve();
    },
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

  it('status zaten güncelse tekrar patch atmaz (reconcile fırtınası koruması)', async () => {
    const kube = makeFake();
    const cr = makeCr();
    cr.status = {
      observedGeneration: 3,
      conditions: [
        {
          type: 'Provisioned',
          status: 'True',
          reason: 'Reconciled',
          lastTransitionTime: '2026-07-06T00:00:00.000Z',
        },
      ],
    };
    await reconcile({ kube, workerImage: 'w:test', log }, cr);
    expect(kube.applied).toHaveLength(5); // kaynaklar yine apply edilir (SSA idempotent)
    expect(kube.statusPatches).toEqual([]);
  });

  it('generation değiştiyse status yeniden patch\'lenir', async () => {
    const kube = makeFake();
    const cr = makeCr();
    cr.metadata!.generation = 4;
    cr.status = {
      observedGeneration: 3,
      conditions: [
        {
          type: 'Provisioned',
          status: 'True',
          reason: 'Reconciled',
          lastTransitionTime: '2026-07-06T00:00:00.000Z',
        },
      ],
    };
    await reconcile({ kube, workerImage: 'w:test', log }, cr);
    expect(kube.statusPatches).toHaveLength(1);
    expect(kube.statusPatches[0]!.observedGeneration).toBe(4);
  });

  it('aynı hata koşulu tekrar patch\'lenmez', async () => {
    const kube = makeFake({ cms: {} });
    const cr = makeCr();
    cr.status = {
      observedGeneration: 3,
      conditions: [
        {
          type: 'Provisioned',
          status: 'False',
          reason: 'MissingAbiConfigMap',
          message: 'ConfigMap emitter-abi/abi.json bulunamadı',
          lastTransitionTime: '2026-07-06T00:00:00.000Z',
        },
      ],
    };
    await reconcile({ kube, workerImage: 'w:test', log }, cr);
    expect(kube.statusPatches).toEqual([]);
  });

  it('metadata eksikse hiçbir çağrı yapmaz', async () => {
    const kube = makeFake();
    await reconcile({ kube, workerImage: 'w:test', log }, { metadata: {} } as Indexer);
    expect(kube.applied).toEqual([]);
    expect(kube.statusPatches).toEqual([]);
  });
});
