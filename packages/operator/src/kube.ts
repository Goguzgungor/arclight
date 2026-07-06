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
