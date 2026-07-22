import { readFileSync } from 'node:fs';
import type { ContractConfig } from '@arckive/core';

export interface AbiDeps {
  readFile?: (path: string) => string;
  fetchJson?: (url: string) => Promise<unknown>;
}

// Resolve a contract's ABI in priority order: mounted file (abiPath) > inline
// (abiInline) > auto-fetch the verified ABI from the explorer by address.
export async function resolveContractAbi(
  contract: ContractConfig,
  explorerApi: string | undefined,
  deps: AbiDeps = {},
): Promise<unknown> {
  if (contract.abiPath) {
    const readFile = deps.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
    return JSON.parse(readFile(contract.abiPath));
  }
  if (contract.abiInline) return contract.abiInline;
  if (explorerApi) {
    const fetchJson =
      deps.fetchJson ??
      (async (url: string) => {
        const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`explorer HTTP ${r.status}: ${url}`);
        return r.json();
      });
    const url = `${explorerApi.replace(/\/$/, '')}/smart-contracts/${contract.address}`;
    const body = (await fetchJson(url)) as { abi?: unknown; message?: string };
    if (!body.abi) {
      throw new Error(
        `no verified ABI on the explorer for ${contract.name} (${contract.address})` +
          (body.message ? `: ${body.message}` : '') +
          ' — set abi.configMapRef or abi.inline',
      );
    }
    return body.abi;
  }
  throw new Error(
    `no ABI source for ${contract.name}: set abi.configMapRef, abi.inline, or network.explorerApi`,
  );
}
