import { describe, expect, it } from 'vitest';
import { AbiError, extractEventDefs } from '../src/abi.js';

const ERC20_ABI = [
  { type: 'function', name: 'transfer', inputs: [], outputs: [] },
  {
    type: 'event', name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Approval',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'spender', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
];

const ADDR = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

describe('extractEventDefs', () => {
  it('returns all events when no selection given; address lowercased; topic0 computed', () => {
    const defs = extractEventDefs('usdc', ADDR, ERC20_ABI);
    expect(defs.map((d) => d.tableName)).toEqual(['usdc_transfer', 'usdc_approval']);
    expect(defs[0]!.address).toBe(ADDR.toLowerCase());
    expect(defs[0]!.topic0).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
  });

  it('filters down to the selected events', () => {
    const defs = extractEventDefs('usdc', ADDR, ERC20_ABI, ['Transfer']);
    expect(defs).toHaveLength(1);
  });

  it('selecting an event missing from the ABI throws AbiError', () => {
    expect(() => extractEventDefs('usdc', ADDR, ERC20_ABI, ['Mint'])).toThrow(AbiError);
  });

  it('overloaded events get a topic0 suffix', () => {
    const abi = [
      { type: 'event', name: 'Ping', inputs: [{ name: 'a', type: 'uint256', indexed: false }] },
      { type: 'event', name: 'Ping', inputs: [{ name: 'a', type: 'address', indexed: false }] },
    ];
    const defs = extractEventDefs('x', ADDR, abi);
    expect(defs[0]!.tableName).not.toBe(defs[1]!.tableName);
    expect(defs[0]!.tableName).toMatch(/^x_ping_[0-9a-f]{4}$/);
  });
});
