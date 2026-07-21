import { describe, expect, it } from 'vitest';
import { eventTableName, schemaName, toSnakeCase } from '../src/naming.js';

describe('naming', () => {
  it('camelCase → snake_case', () => {
    expect(toSnakeCase('TransferSingle')).toBe('transfer_single');
    expect(toSnakeCase('USDCPool')).toBe('usdc_pool');
    expect(toSnakeCase('my-contract')).toBe('my_contract');
  });

  it('schema name gets an idx_ prefix', () => {
    expect(schemaName('usdc-arc')).toBe('idx_usdc_arc');
  });

  it('table name; topic0 suffix when overloaded', () => {
    expect(eventTableName('usdc', 'Transfer')).toBe('usdc_transfer');
    expect(eventTableName('usdc', 'Transfer', '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'))
      .toBe('usdc_transfer_ddf2');
  });

  it('rejects identifiers longer than 63 bytes', () => {
    expect(() => eventTableName('a'.repeat(60), 'VeryLongEventName')).toThrow();
  });
});
