import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildControlTables, buildEventTable, extractEventDefs, type DecodedRow,
} from '@arclight/core';
import { bootstrap, commitBatch, getCursor, initCursor } from '../src/db.js';

const ADDR = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const ABI = [
  {
    type: 'event', name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
];
const SCHEMA = 'idx_demo';

function row(blockNumber: number, logIndex: number): DecodedRow {
  return {
    tableName: 'usdc_transfer',
    columns: {
      block_number: String(blockNumber),
      block_hash: '0x' + 'a'.repeat(64),
      block_time: new Date('2026-07-03T00:00:00Z'),
      tx_hash: '0x' + 'b'.repeat(64),
      tx_index: 0,
      log_index: logIndex,
      contract_address: ADDR.toLowerCase(),
      from: '0x' + '1'.repeat(40),
      to: '0x' + '2'.repeat(40),
      value: '100',
    },
  };
}

describe('db', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  });
  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it('bootstrap idempotent (iki kez çalışır)', async () => {
    const defs = extractEventDefs('usdc', ADDR, ABI);
    const tables = defs.map((d) => buildEventTable(SCHEMA, d));
    await bootstrap(pool, buildControlTables(SCHEMA), tables);
    await bootstrap(pool, buildControlTables(SCHEMA), tables); // ikinci çağrı hata vermez
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`, [SCHEMA],
    );
    expect(r.rows.map((x) => x.table_name).sort())
      .toEqual(['_cursor', '_dead_letter', '_meta', 'usdc_transfer']);
  });

  it('cursor: init yalnızca boşken yazar', async () => {
    expect(await getCursor(pool, SCHEMA)).toBeNull();
    await initCursor(pool, SCHEMA, 9n);
    await initCursor(pool, SCHEMA, 999n); // etkisiz
    expect(await getCursor(pool, SCHEMA)).toBe(9n);
  });

  it('commitBatch idempotent + cursor ilerletir', async () => {
    const first = await commitBatch(pool, SCHEMA, [row(10, 0), row(10, 1)], [], 10n);
    expect(first).toBe(2);
    const again = await commitBatch(pool, SCHEMA, [row(10, 0), row(10, 1)], [], 10n);
    expect(again).toBe(0); // ON CONFLICT DO NOTHING
    expect(await getCursor(pool, SCHEMA)).toBe(10n);
    const count = await pool.query(`SELECT count(*)::int AS n FROM "${SCHEMA}"."usdc_transfer"`);
    expect(count.rows[0].n).toBe(2);
  });

  it('dead-letter aynı transaction içinde yazılır', async () => {
    await commitBatch(pool, SCHEMA, [], [{
      blockNumber: 11n, txHash: '0x' + 'c'.repeat(64), logIndex: 0,
      address: ADDR.toLowerCase(), topics: ['0xdead'], data: '0x01', error: 'decode hatası',
    }], 11n);
    const r = await pool.query(`SELECT error FROM "${SCHEMA}"._dead_letter`);
    expect(r.rows[0].error).toBe('decode hatası');
    expect(await getCursor(pool, SCHEMA)).toBe(11n);
  });
});
