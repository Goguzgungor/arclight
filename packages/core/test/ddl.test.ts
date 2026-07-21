import { describe, expect, it } from 'vitest';
import { extractEventDefs } from '../src/abi.js';
import { buildControlTables, buildEventTable, eventColumns, pgTypeFor, DdlError } from '../src/ddl.js';

const ADDR = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const TRANSFER_ABI = [
  {
    type: 'event', name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
];

describe('pgTypeFor', () => {
  it('maps types according to the spec', () => {
    expect(pgTypeFor('address')).toBe('text');
    expect(pgTypeFor('uint256')).toBe('numeric(78,0)');
    expect(pgTypeFor('int128')).toBe('numeric(78,0)');
    expect(pgTypeFor('bool')).toBe('boolean');
    expect(pgTypeFor('bytes')).toBe('bytea');
    expect(pgTypeFor('bytes32')).toBe('bytea');
    expect(pgTypeFor('string')).toBe('text');
    expect(pgTypeFor('uint256[]')).toBe('jsonb');
    expect(pgTypeFor('tuple')).toBe('jsonb');
  });
  it('unknown type throws DdlError', () => {
    expect(() => pgTypeFor('function')).toThrow(DdlError);
  });
});

describe('eventColumns', () => {
  it('parameter colliding with a common column gets a param_ prefix; unnamed parameter becomes argN', () => {
    const abi = [
      {
        type: 'event', name: 'Weird',
        inputs: [
          { name: 'blockNumber', type: 'uint256', indexed: false },
          { name: '', type: 'address', indexed: false },
        ],
      },
    ];
    const [def] = extractEventDefs('x', ADDR, abi);
    const cols = eventColumns(def!.event);
    expect(cols.map((c) => c.name)).toEqual(['param_block_number', 'arg1']);
  });
});

describe('buildEventTable', () => {
  it('common columns + parameters + unique constraint + indexes for indexed params', () => {
    const [def] = extractEventDefs('usdc', ADDR, TRANSFER_ABI);
    const spec = buildEventTable('idx_demo', def!);
    const create = spec.statements[0]!;
    expect(create).toContain('CREATE TABLE IF NOT EXISTS "idx_demo"."usdc_transfer"');
    expect(create).toContain('"block_number" bigint NOT NULL');
    expect(create).toContain('"from" text');
    expect(create).toContain('"value" numeric(78,0)');
    expect(create).toContain('UNIQUE (block_number, tx_hash, log_index)');
    expect(spec.statements.filter((s) => s.startsWith('CREATE INDEX'))).toHaveLength(2);
  });

  it('_ingested_at meta column: in CREATE + ALTER for existing tables', () => {
    const [def] = extractEventDefs('usdc', ADDR, TRANSFER_ABI);
    const spec = buildEventTable('idx_demo', def!);
    expect(spec.statements[0]).toContain('"_ingested_at" timestamptz NOT NULL DEFAULT now()');
    const alter = spec.statements.find((s) => s.startsWith('ALTER TABLE'));
    expect(alter).toContain(
      'ADD COLUMN IF NOT EXISTS "_ingested_at" timestamptz NOT NULL DEFAULT now()',
    );
  });

  it('event parameter named _ingestedAt does not collide with the meta column (becomes ingested_at)', () => {
    const abi = [
      {
        type: 'event',
        name: 'Weird',
        inputs: [{ name: '_ingestedAt', type: 'uint256', indexed: false }],
      },
    ];
    const [def] = extractEventDefs('x', ADDR, abi);
    // toSnakeCase strips the leading _; the result differs from the DB meta column "_ingested_at"
    expect(eventColumns(def!.event).map((c) => c.name)).toEqual(['ingested_at']);
  });
});

describe('buildControlTables', () => {
  it('schema + three control tables', () => {
    const stmts = buildControlTables('idx_demo');
    expect(stmts[0]).toContain('CREATE SCHEMA IF NOT EXISTS "idx_demo"');
    expect(stmts.join(' ')).toContain('_cursor');
    expect(stmts.join(' ')).toContain('_meta');
    expect(stmts.join(' ')).toContain('_dead_letter');
  });
});
