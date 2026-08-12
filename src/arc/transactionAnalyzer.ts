import { decodeEventLog, erc20Abi, zeroAddress, type Address, type Hash, type Transaction, type TransactionReceipt } from 'viem';
import type { Trade, AssetAmount } from '../types/trade.js';
import { normalizeAddress } from '../utils/address.js';
import { ARC_USDC_ERC20, type TokenMetadataService } from './tokenMetadata.js';

export interface AnalyzeInput { wallet: Address; walletLabel?: string; transaction: Transaction; receipt: TransactionReceipt; timestamp: Date }
type Flow = { address: Address|'native'; amount: bigint };

export class TransactionAnalyzer {
  constructor(private metadata: TokenMetadataService) {}

  async analyze({ wallet, walletLabel, transaction: tx, receipt, timestamp }: AnalyzeInput): Promise<Trade> {
    const base = { wallet, walletLabel, txHash: tx.hash as Hash, blockNumber: receipt.blockNumber, timestamp };
    if (receipt.status !== 'success' || !Array.isArray(receipt.logs)) return { ...base, type: 'UNKNOWN' };

    const isContractInteraction = normalizeAddress(tx.from) === wallet
      && tx.to !== null
      && tx.input !== '0x';
    if (!isContractInteraction) return { ...base, type: 'UNKNOWN' };

    const sent = new Map<string,bigint>(), received = new Map<string,bigint>();
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: log.topics });
        const from = normalizeAddress(decoded.args.from), to = normalizeAddress(decoded.args.to), value = decoded.args.value;
        const address = log.address.toLowerCase();
        if (from === wallet && to !== wallet && to !== zeroAddress) sent.set(address, (sent.get(address) ?? 0n) + value);
        if (to === wallet && from !== wallet && from !== zeroAddress) received.set(address, (received.get(address) ?? 0n) + value);
      } catch { /* unrelated or malformed log */ }
    }

    if (normalizeAddress(tx.from) === wallet && tx.value > 0n) {
      sent.set('native', (sent.get('native') ?? 0n) + tx.value);
    }
    if (tx.to && normalizeAddress(tx.to) === wallet && tx.value > 0n) {
      received.set('native', (received.get('native') ?? 0n) + tx.value);
    }

    // Arc's USDC has both native and ERC-20 representations. Raw integer values
    // cannot be compared across decimals (6 vs 18), so never let an 18-decimal
    // mirror event win merely because its bigint is larger. Prefer the canonical
    // 6-decimal USDC ERC-20 Transfer whenever it is present for the wallet flow.
    const pick = (map: Map<string, bigint>): Flow | undefined => {
      const canonicalUsdc = map.get(ARC_USDC_ERC20.toLowerCase());
      if (canonicalUsdc !== undefined) {
        return { address: ARC_USDC_ERC20, amount: canonicalUsdc };
      }
      const nativeUsdc = map.get('native');
      if (nativeUsdc !== undefined) {
        return { address: 'native', amount: nativeUsdc };
      }
      const largest = [...map].sort((a, b) => (a[1] > b[1] ? -1 : 1))[0];
      return largest
        ? { address: largest[0] as Address | 'native', amount: largest[1] }
        : undefined;
    };

    const outgoing = pick(sent), incoming = pick(received);
    if (!outgoing || !incoming || outgoing.address === incoming.address) return { ...base, type: 'UNKNOWN' };

    const asset = async (flow: Flow): Promise<AssetAmount> => flow.address === 'native'
      ? { address: 'native', symbol: 'USDC', name: 'USD Coin', decimals: 18, rawAmount: flow.amount }
      : { address: flow.address, ...await this.metadata.get(flow.address), rawAmount: flow.amount };

    const tokenIn = await asset(outgoing), tokenOut = await asset(incoming);
    const inputIsUsdc = tokenIn.symbol.toUpperCase() === 'USDC';
    const outputIsUsdc = tokenOut.symbol.toUpperCase() === 'USDC';

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
