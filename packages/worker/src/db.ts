import pg from 'pg';
import type { DecodedRow, TableSpec } from '@arclight/core';

const q = (id: string) => `"${id}"`;

export async function bootstrap(
  pool: pg.Pool,
  controlStatements: string[],
  tables: TableSpec[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of controlStatements) await client.query(s);
    for (const t of tables) for (const s of t.statements) await client.query(s);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getCursor(pool: pg.Pool, schema: string): Promise<bigint | null> {
  const r = await pool.query(`SELECT last_block FROM ${q(schema)}._cursor WHERE id = 1`);
  return r.rowCount ? BigInt(r.rows[0].last_block) : null;
}

export async function initCursor(pool: pg.Pool, schema: string, lastBlock: bigint): Promise<void> {
  await pool.query(
    `INSERT INTO ${q(schema)}._cursor (id, last_block) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
    [lastBlock.toString()],
  );
}

export interface DeadLetterEntry {
  blockNumber: bigint | null;
  txHash: string | null;
  logIndex: number | null;
  address: string | null;
  topics: string[];
  data: string | null;
  error: string;
}

export async function commitBatch(
  pool: pg.Pool,
  schema: string,
  rows: DecodedRow[],
  deadLetters: DeadLetterEntry[],
  newCursor: bigint,
): Promise<number> {
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      const cols = Object.keys(row.columns);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const quoted = cols.map(q).join(', ');
      const res = await client.query(
        `INSERT INTO ${q(schema)}.${q(row.tableName)} (${quoted}) VALUES (${placeholders})
         ON CONFLICT (block_number, tx_hash, log_index) DO NOTHING`,
        cols.map((c) => row.columns[c]),
      );
      inserted += res.rowCount ?? 0;
    }
    for (const d of deadLetters) {
      await client.query(
        `INSERT INTO ${q(schema)}._dead_letter
           (block_number, tx_hash, log_index, address, topics, data, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          d.blockNumber?.toString() ?? null, d.txHash, d.logIndex, d.address,
          JSON.stringify(d.topics), d.data, d.error,
        ],
      );
    }
    await client.query(
      `UPDATE ${q(schema)}._cursor SET last_block = $1, updated_at = now() WHERE id = 1`,
      [newCursor.toString()],
    );
    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
