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
  it('spec tip eşlemesi', () => {
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
  it('bilinmeyen tip DdlError', () => {
    expect(() => pgTypeFor('function')).toThrow(DdlError);
  });
});

describe('eventColumns', () => {
  it('ortak kolonla çakışan parametre param_ önekli; adsız parametre argN', () => {
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
  it('ortak kolonlar + parametreler + unique + indexed index', () => {
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
});

describe('buildControlTables', () => {
  it('şema + üç kontrol tablosu', () => {
    const stmts = buildControlTables('idx_demo');
    expect(stmts[0]).toContain('CREATE SCHEMA IF NOT EXISTS "idx_demo"');
    expect(stmts.join(' ')).toContain('_cursor');
    expect(stmts.join(' ')).toContain('_meta');
    expect(stmts.join(' ')).toContain('_dead_letter');
  });
});
