import { decodeEventLog, erc20Abi, zeroAddress, type Address, type Hash, type Transaction, type TransactionReceipt } from 'viem';
import type { Trade, AssetAmount } from '../types/trade.js';
import { normalizeAddress } from '../utils/address.js';
import type { TokenMetadataService } from './tokenMetadata.js';

export interface AnalyzeInput { wallet: Address; walletLabel?: string; transaction: Transaction; receipt: TransactionReceipt; timestamp: Date }
type Flow = { address: Address|'native'; amount: bigint };
export class TransactionAnalyzer {
  constructor(private metadata: TokenMetadataService) {}
  async analyze({ wallet, walletLabel, transaction: tx, receipt, timestamp }: AnalyzeInput): Promise<Trade> {
    const base = { wallet, walletLabel, txHash: tx.hash as Hash, blockNumber: receipt.blockNumber, timestamp };
    if (receipt.status !== 'success' || !Array.isArray(receipt.logs)) return { ...base, type: 'UNKNOWN' };
    // Only classify calls initiated by the tracked wallet. This excludes unsolicited
    // wallet-to-wallet transfers and incoming airdrops from being mistaken for swaps.
    const isContractInteraction = normalizeAddress(tx.from) === wallet
      && tx.to !== null
      && tx.input !== '0x';
    if (!isContractInteraction) return { ...base, type: 'UNKNOWN' };
    const sent = new Map<string,bigint>(), received = new Map<string,bigint>();
    for (const log of receipt.logs) { try {
      const decoded = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: log.topics });
      const from = normalizeAddress(decoded.args.from), to = normalizeAddress(decoded.args.to), value = decoded.args.value;
      if (from === wallet && to !== wallet && to !== zeroAddress) sent.set(log.address.toLowerCase(), (sent.get(log.address.toLowerCase()) ?? 0n) + value);
      if (to === wallet && from !== wallet && from !== zeroAddress) received.set(log.address.toLowerCase(), (received.get(log.address.toLowerCase()) ?? 0n) + value);
    } catch { /* unrelated or malformed log */ } }
    if (normalizeAddress(tx.from) === wallet && tx.value > 0n) sent.set('native', (sent.get('native') ?? 0n) + tx.value);
    if (tx.to && normalizeAddress(tx.to) === wallet && tx.value > 0n) received.set('native', (received.get('native') ?? 0n) + tx.value);
    const pick = (map: Map<string, bigint>): Flow | undefined => {
      const largest = [...map].sort((a, b) => (a[1] > b[1] ? -1 : 1))[0];
      return largest
        ? { address: largest[0] as Address | 'native', amount: largest[1] }
        : undefined;
    };
    const outgoing = pick(sent), incoming = pick(received);
    // Bidirectional asset flow is the conservative generic signal. A one-way Transfer is never called a trade.
    if (!outgoing || !incoming || outgoing.address === incoming.address) return { ...base, type: 'UNKNOWN' };
    const asset = async (flow: Flow): Promise<AssetAmount> => flow.address === 'native' ? { address: 'native', symbol: 'USDC', name: 'USD Coin', decimals: 18, rawAmount: flow.amount } : { address: flow.address, ...await this.metadata.get(flow.address), rawAmount: flow.amount };
    const tokenIn = await asset(outgoing), tokenOut = await asset(incoming);
    const inputIsUsdc = tokenIn.symbol.toUpperCase() === 'USDC';
    const outputIsUsdc = tokenOut.symbol.toUpperCase() === 'USDC';
    // Gas fees are deliberately absent: only tx.value and decoded Transfer amounts
    // enter these maps. receipt.gasUsed/effectiveGasPrice are never asset flows.
    const type = inputIsUsdc && !outputIsUsdc
      ? 'BUY'
      : outputIsUsdc && !inputIsUsdc
        ? 'SELL'
        : !inputIsUsdc && !outputIsUsdc
          ? 'SWAP'
          : 'UNKNOWN';
    return { ...base, type, tokenIn, tokenOut, amountIn: outgoing.amount, amountOut: incoming.amount };
  }
}
