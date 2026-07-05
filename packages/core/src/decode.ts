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
