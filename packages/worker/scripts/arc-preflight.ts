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

const wsUrl = process.env['ARC_WS_URL'];
if (wsUrl) {
  const wsChainId = await new Promise<number>((resolve, reject) => {
    const sock = new WebSocket(wsUrl);
    const timer = setTimeout(() => { sock.close(); reject(new Error('ws zaman aşımı')); }, 5_000);
    sock.onopen = () =>
      sock.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }));
    sock.onmessage = (ev) => {
      clearTimeout(timer);
      sock.close();
      const body = JSON.parse(String(ev.data)) as { result?: string };
      if (body.result) resolve(Number(body.result));
      else reject(new Error('eth_chainId sonuçsuz'));
    };
    sock.onerror = () => { clearTimeout(timer); sock.close(); reject(new Error('ws bağlantı hatası')); };
  });
  console.log(
    `ws chainId: ${wsChainId} (beklenen ${EXPECTED_CHAIN_ID}) → ${wsChainId === EXPECTED_CHAIN_ID ? 'OK' : 'UYUŞMAZLIK'}`,
  );
} else {
  console.log('ARC_WS_URL verilmedi — WS probu atlandı');
}
