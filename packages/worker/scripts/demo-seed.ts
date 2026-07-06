import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const FIXTURE = fileURLToPath(new URL('../test/fixtures/emitter', import.meta.url));

execSync('forge build', { cwd: FIXTURE, stdio: 'inherit' });
const artifact = JSON.parse(
  readFileSync(`${FIXTURE}/out/Emitter.sol/Emitter.json`, 'utf8'),
) as { abi: never; bytecode: { object: `0x${string}` } };

const wallet = createWalletClient({
  account: privateKeyToAccount(PK),
  transport: http(process.env['RPC_URL'] ?? 'http://127.0.0.1:8545'),
}).extend(publicActions);

const hash = await wallet.deployContract({
  abi: artifact.abi, bytecode: artifact.bytecode.object, chain: null,
});
const receipt = await wallet.waitForTransactionReceipt({ hash });
console.log('Emitter deploy edildi:', receipt.contractAddress);

for (let i = 1; i <= 10; i++) {
  const tx = await wallet.writeContract({
    address: receipt.contractAddress!, abi: artifact.abi,
    functionName: 'ping', args: [BigInt(i)], chain: null,
  });
  await wallet.waitForTransactionReceipt({ hash: tx });
}
console.log('10 ping gönderildi');
