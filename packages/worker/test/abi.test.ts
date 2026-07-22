import { describe, expect, it } from 'vitest';
import { resolveContractAbi } from '../src/abi.js';

const ERC20 = [{ type: 'event', name: 'Transfer', inputs: [] }];
const base = { name: 'usdc', address: `0x${'ab'.repeat(20)}`, events: [] as string[] };

describe('resolveContractAbi', () => {
  it('abiPath: reads and parses the mounted file', async () => {
    const abi = await resolveContractAbi(
      { ...base, abiPath: '/etc/arckive/abis/usdc/abi.json' },
      undefined,
      { readFile: () => JSON.stringify(ERC20) },
    );
    expect(abi).toEqual(ERC20);
  });

  it('abiInline: returns the inline abi without touching fs or network', async () => {
    const abi = await resolveContractAbi({ ...base, abiInline: ERC20 }, 'https://x/api/v2', {
      readFile: () => {
        throw new Error('should not read');
      },
      fetchJson: async () => {
        throw new Error('should not fetch');
      },
    });
    expect(abi).toEqual(ERC20);
  });

  it('explorer: fetches the verified abi by address at the Blockscout route', async () => {
    let url = '';
    const abi = await resolveContractAbi({ ...base }, 'https://testnet.arcscan.app/api/v2', {
      fetchJson: async (u) => {
        url = u;
        return { abi: ERC20 };
      },
    });
    expect(abi).toEqual(ERC20);
    expect(url).toBe(`https://testnet.arcscan.app/api/v2/smart-contracts/${base.address}`);
  });

  it('explorer: throws a clear error when the contract is not verified', async () => {
    await expect(
      resolveContractAbi({ ...base }, 'https://x/api/v2', {
        fetchJson: async () => ({ message: 'Not found' }),
      }),
    ).rejects.toThrow(/no verified ABI/);
  });

  it('throws when there is no ABI source at all', async () => {
    await expect(resolveContractAbi({ ...base }, undefined)).rejects.toThrow(/no ABI source/);
  });
});
