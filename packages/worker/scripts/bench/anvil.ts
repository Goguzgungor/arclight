// Local anvil helpers: emitter deploy, automatic/manual block production,
// dense ping sending with manually managed nonces (burst seeding).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createWalletClient, http, publicActions, type Abi, type WalletClient, type PublicActions,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// anvil's deterministic account #0
const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const FIXTURE = fileURLToPath(new URL('../../test/fixtures/emitter', import.meta.url));

export const ANVIL_URL = process.env['BENCH_LOCAL_RPC'] ?? 'http://127.0.0.1:8545';
export const ANVIL_CHAIN_ID = 31337;

export interface EmitterHandle {
  wallet: WalletClient & PublicActions;
  abi: Abi;
  address: `0x${string}`;
  deployBlock: bigint;
}

export async function rpcCall(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(ANVIL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

export const setAutomine = (on: boolean) => rpcCall('evm_setAutomine', [on]);
export const setIntervalMining = (sec: number) => rpcCall('evm_setIntervalMining', [sec]);
export const mine = (blocks: number) => rpcCall('anvil_mine', [`0x${blocks.toString(16)}`]);

export async function deployEmitter(): Promise<EmitterHandle> {
  execSync('forge build', { cwd: FIXTURE, stdio: 'pipe' });
  const artifact = JSON.parse(
    readFileSync(`${FIXTURE}/out/Emitter.sol/Emitter.json`, 'utf8'),
  ) as { abi: Abi; bytecode: { object: `0x${string}` } };

  const wallet = createWalletClient({
    account: privateKeyToAccount(PK),
    transport: http(ANVIL_URL),
  }).extend(publicActions);

  const hash = await wallet.deployContract({
    abi: artifact.abi, bytecode: artifact.bytecode.object, chain: null,
  });
  const receipt = await wallet.waitForTransactionReceipt({ hash });
  return {
    wallet, abi: artifact.abi,
    address: receipt.contractAddress!,
    deployBlock: receipt.blockNumber,
  };
}

// sends n ping txs without waiting for receipts, assigning nonces manually
// (with automine off they pile up in the mempool; the caller mines)
export async function sendPings(e: EmitterHandle, start: number, n: number, nonce0: number): Promise<number> {
  for (let i = 0; i < n; i++) {
    await e.wallet.writeContract({
      address: e.address, abi: e.abi, functionName: 'ping',
      args: [BigInt(start + i)], chain: null, nonce: nonce0 + i,
      account: e.wallet.account!,
    });
  }
  return nonce0 + n;
}

export async function currentNonce(e: EmitterHandle): Promise<number> {
  return e.wallet.getTransactionCount({ address: e.wallet.account!.address, blockTag: 'pending' });
}
