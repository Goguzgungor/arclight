import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { describe, expect, it } from 'vitest';
import { extractEventDefs } from '../src/abi.js';
import { DecodeError, decodeLogToRow, toSqlValue, type RawLog } from '../src/decode.js';

const ADDR = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const TRANSFER_ABI = [
  {
    type: 'event', name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;

const FROM = '0x1111111111111111111111111111111111111111' as const;
const TO = '0x2222222222222222222222222222222222222222' as const;

function makeLog(): RawLog {
  return {
    address: ADDR,
    topics: encodeEventTopics({
      abi: TRANSFER_ABI, eventName: 'Transfer', args: { from: FROM, to: TO },
    }) as RawLog['topics'],
    data: encodeAbiParameters([{ type: 'uint256' }], [123456789n]),
    blockNumber: 42n,
    blockHash: '0xabc0000000000000000000000000000000000000000000000000000000000000',
    transactionHash: '0xdef0000000000000000000000000000000000000000000000000000000000000',
    transactionIndex: 3,
    logIndex: 7,
  };
}

describe('toSqlValue', () => {
  it('bigint → string, address → lowercase, bytes → Buffer, array → JSON string', () => {
    expect(toSqlValue('uint256', 5n)).toBe('5');
    expect(toSqlValue('address', '0xABCDEF0000000000000000000000000000000000'))
      .toBe('0xabcdef0000000000000000000000000000000000');
    expect(toSqlValue('bytes32', '0x01ff')).toEqual(Buffer.from('01ff', 'hex'));
    expect(toSqlValue('uint256[]', [1n, 2n])).toBe('["1","2"]');
  });
});

describe('decodeLogToRow', () => {
  it('common columns + parameter columns filled correctly', () => {
    const [def] = extractEventDefs('usdc', ADDR, TRANSFER_ABI as unknown as unknown[]);
    const t = new Date('2026-07-03T00:00:00Z');
    const row = decodeLogToRow(def!, makeLog(), t);
    expect(row.tableName).toBe('usdc_transfer');
    expect(row.columns['block_number']).toBe('42');
    expect(row.columns['block_time']).toBe(t);
    expect(row.columns['contract_address']).toBe(ADDR.toLowerCase());
    expect(row.columns['from']).toBe(FROM);
    expect(row.columns['to']).toBe(TO);
    expect(row.columns['value']).toBe('123456789');
  });

  it('mismatched data throws DecodeError', () => {
    const [def] = extractEventDefs('usdc', ADDR, TRANSFER_ABI as unknown as unknown[]);
    const bad = { ...makeLog(), data: '0x01' as const };
    expect(() => decodeLogToRow(def!, bad, new Date())).toThrow(DecodeError);
  });
});
