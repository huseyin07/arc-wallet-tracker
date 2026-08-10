import type { Address, Hash } from 'viem';

export type TradeType = 'BUY' | 'SELL' | 'SWAP' | 'UNKNOWN';
export interface AssetAmount { address: Address | 'native'; symbol: string; name: string; decimals: number; rawAmount: bigint }
export interface Trade {
  wallet: Address; walletLabel?: string; type: TradeType;
  tokenIn?: AssetAmount; tokenOut?: AssetAmount; amountIn?: bigint; amountOut?: bigint;
  txHash: Hash; blockNumber: bigint; timestamp: Date;
}
