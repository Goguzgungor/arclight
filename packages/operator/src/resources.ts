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
  if (name.length > 63) throw new Error(`resource name exceeds 63 characters: ${name}`);
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
