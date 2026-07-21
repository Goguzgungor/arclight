import { describe, expect, it } from 'vitest';
import { IndexerSpecSchema, configHash, renderWorkerConfig } from '@arclight/core';
import { desiredResources, workerResourceName } from '../src/resources.js';

const ADDR = `0x${'ab'.repeat(20)}`;
const spec = IndexerSpecSchema.parse({
  network: { chainId: 31337, rpc: ['http://anvil:8545'], finalityTag: 'latest' },
  storage: { mode: 'External', external: { dsnSecretRef: { name: 'pg-dsn', key: 'url' } } },
  contracts: [
    { name: 'emitter', address: ADDR, abi: { configMapRef: { name: 'emitter-abi' } } },
    { name: 'second', address: ADDR, abi: { configMapRef: { name: 'second-abi', key: 'k.json' } } },
  ],
});
const input = {
  namespace: 'default',
  owner: { name: 'demo', uid: 'uid-123' },
  spec,
  workerImage: 'arclight-worker:test',
};

describe('workerResourceName', () => {
  it('adds the arclight- prefix, throws when exceeding 63 characters', () => {
    expect(workerResourceName('demo')).toBe('arclight-demo');
    expect(() => workerResourceName('x'.repeat(60))).toThrow(/63/);
  });
});

describe('desiredResources', () => {
  const d = desiredResources(input);

  it('ownerReference and names are correct on all resources', () => {
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

  it('config ConfigMap contains the rendered worker config and the hash matches', () => {
    const rendered = renderWorkerConfig('demo', spec);
    expect(JSON.parse(d.configMap.data!['config.json']!)).toEqual(
      JSON.parse(JSON.stringify(rendered)),
    );
    expect(d.hash).toBe(configHash(rendered));
    expect(d.deployment.spec?.template.metadata?.annotations).toEqual({
      'arclight.dev/config-hash': d.hash,
    });
  });

  it('deployment: single replica, Recreate, env and probe contract', () => {
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

  it('produces an ABI volume + mount for each contract', () => {
    const volumes = d.deployment.spec!.template.spec!.volumes!;
    expect(volumes.map((v) => v.name)).toEqual(['config', 'abi-emitter', 'abi-second']);
    const mounts = d.deployment.spec!.template.spec!.containers[0]!.volumeMounts!;
    expect(mounts).toContainEqual({
      name: 'abi-second',
      mountPath: '/etc/arclight/abis/second',
      readOnly: true,
    });
    expect(volumes[2]!.configMap?.name).toBe('second-abi');
  });

  it('role can only patch its own CR status', () => {
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
