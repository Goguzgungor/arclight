import { createHash } from 'node:crypto';
import { z } from 'zod';
import { RpcUrlSchema, WorkerConfigSchema, type WorkerConfig } from './config.js';

export const ABI_MOUNT_DIR = '/etc/arckive/abis';
export const CONFIG_MOUNT_PATH = '/etc/arckive/config/config.json';

export const IndexerSpecSchema = z.object({
  network: z.object({
    chainId: z.number().int().positive(),
    rpc: z.array(RpcUrlSchema).min(1),
    // ws endpoints listened to for newHeads only — not part of the query pool (CRD
    // counterpart of the worker's announceRpc; renderWorkerConfig passes it through as-is)
    announceRpc: z
      .array(z.string().regex(/^wss?:\/\//i, 'announceRpc must be ws(s):// only'))
      .default([]),
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
        // feeds the table name (snake_case) and the K8s volume name — DNS-1123 compliant
        name: z
          .string()
          .regex(/^[a-z][a-z0-9-]{0,29}$/, 'contract name: lowercase letters, digits, hyphens; starts with a letter; <=30'),
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'invalid EVM address'),
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
