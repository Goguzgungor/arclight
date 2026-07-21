import { z } from 'zod';

// rpc endpoints: http(s) for polling/reads, ws(s) for newHeads subscription + reads
export const RpcUrlSchema = z
  .string()
  .url()
  .refine(
    (u) => /^(https?|wss?):\/\//i.test(u),
    'rpc URL scheme must be http(s):// or ws(s)://',
  );

export const ContractConfigSchema = z.object({
  name: z.string().min(1),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'invalid EVM address'),
  abiPath: z.string().min(1),
  startBlock: z.number().int().nonnegative().default(0),
  events: z.array(z.string().min(1)).default([]),
});

export const WorkerConfigSchema = z.object({
  indexerName: z.string().min(1),
  network: z.object({
    chainId: z.number().int().positive(),
    rpc: z.array(RpcUrlSchema).min(1),
    // extra ws endpoints used only to listen for newHeads (not part of the query pool):
    // for endpoints fast at announcing but limited for queries (e.g. the official endpoint)
    announceRpc: z
      .array(z.string().regex(/^wss?:\/\//i, 'announceRpc must be ws(s):// only'))
      .default([]),
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
