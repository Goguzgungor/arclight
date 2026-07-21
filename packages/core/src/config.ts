import { z } from 'zod';

// rpc uçları: http(s) polling/okuma, ws(s) newHeads aboneliği + okuma
export const RpcUrlSchema = z
  .string()
  .url()
  .refine(
    (u) => /^(https?|wss?):\/\//i.test(u),
    'rpc URL şeması http(s):// veya ws(s):// olmalı',
  );

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
    rpc: z.array(RpcUrlSchema).min(1),
    // yalnızca newHeads dinlemek için ek ws uçları (sorgu havuzuna girmez):
    // duyuruda hızlı ama sorguda kısıtlı uçlar (ör. resmi uç) için
    announceRpc: z
      .array(z.string().regex(/^wss?:\/\//i, 'announceRpc yalnızca ws(s):// olabilir'))
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
