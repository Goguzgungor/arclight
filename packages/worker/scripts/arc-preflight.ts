import { createPublicClient, http, parseAbiItem } from 'viem';

const rpcUrl = process.env['ARC_RPC_URL'] ?? 'https://arc-testnet.drpc.org';
const usdc = process.env['USDC_ADDRESS'] as `0x${string}` | undefined;
const EXPECTED_CHAIN_ID = 5042002;

const client = createPublicClient({ transport: http(rpcUrl) });

const chainId = await client.getChainId();
console.log(
  `chainId: ${chainId} (beklenen ${EXPECTED_CHAIN_ID}) → ${chainId === EXPECTED_CHAIN_ID ? 'OK' : 'UYUŞMAZLIK'}`,
);

const latest = await client.getBlock({ blockTag: 'latest' });
const finalized = await client.getBlock({ blockTag: 'finalized' });
console.log(`latest:    ${latest.number} @ ${new Date(Number(latest.timestamp) * 1000).toISOString()}`);
console.log(`finalized: ${finalized.number} @ ${new Date(Number(finalized.timestamp) * 1000).toISOString()}`);
console.log(`finality lag: ${latest.number - finalized.number} blok`);

if (usdc) {
  const fromBlock = finalized.number > 999n ? finalized.number - 999n : 0n;
  const logs = await client.getLogs({
    address: usdc,
    event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
    fromBlock,
    toBlock: finalized.number,
  });
  console.log(`USDC Transfer [${fromBlock}..${finalized.number}]: ${logs.length} log`);
  const suggested = finalized.number > 5000n ? finalized.number - 5000n : 0n;
  console.log(`önerilen startBlock: ${suggested}`);
} else {
  console.log('USDC_ADDRESS verilmedi — getLogs probu atlandı');
}
