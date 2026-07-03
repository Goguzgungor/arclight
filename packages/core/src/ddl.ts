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
