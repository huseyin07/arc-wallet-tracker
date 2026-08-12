import { formatUnits } from 'viem';
import type { Trade, AssetAmount } from '../types/trade.js';
import { shortAddress } from '../utils/address.js';

const escape = (v: string) => v.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!));
const amount = (raw: bigint, decimals: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(Number(formatUnits(raw, decimals)));

function usdcValue(t: Trade): number | undefined {
  const asset = [t.tokenIn, t.tokenOut].find((token): token is AssetAmount => token?.symbol.toUpperCase() === 'USDC');
  if (!asset) return undefined;
  return Number(formatUnits(asset.rawAmount, asset.decimals));
}

function sizeIcon(t: Trade): string {
  const value = usdcValue(t);
  if (value === undefined) return '🔄';
  if (value >= 10_000) return '🐋';
  if (value >= 1_000) return '🔥';
  if (value >= 100) return '⚡';
  return '🪙';
}

export function formatTradeNotification(t: Trade, explorerUrl: string): string {
  const actionIcon = { BUY: '🟢', SELL: '🔴', SWAP: '🔵', UNKNOWN: '⚪' }[t.type];
  const firstLabel = t.type === 'BUY' ? 'Bought' : t.type === 'SELL' ? 'Sold' : 'Sent';
  const secondLabel = t.type === 'BUY' ? 'Spent' : 'Received';
  const firstIcon = t.type === 'BUY' ? '🟢' : t.type === 'SELL' ? '🔴' : '🟠';
  const secondIcon = t.type === 'BUY' ? '🔴' : t.type === 'SELL' ? '🟢' : '🔵';
  const first = t.type === 'BUY' ? t.tokenOut : t.tokenIn;
  const second = t.type === 'BUY' ? t.tokenIn : t.tokenOut;
  if (!first || !second) throw new Error('Trade notification requires two asset flows');

  const walletName = escape(t.walletLabel || 'Unlabelled');
  const firstAmount = amount(first.rawAmount, first.decimals);
  const secondAmount = amount(second.rawAmount, second.decimals);

  return `${actionIcon} ${sizeIcon(t)} <b>ARC ${t.type}</b>\n\n` +
    `🟣 <b>Wallet:</b> <b>${walletName}</b>\n` +
    `<code>${shortAddress(t.wallet)}</code>\n\n` +
    `${firstIcon} <b>${firstLabel}:</b> ${firstAmount} <b>${escape(first.symbol)}</b>\n` +
    `${secondIcon} <b>${secondLabel}:</b> ${secondAmount} <b>${escape(second.symbol)}</b>\n\n` +
    `🔗 <a href="${escape(explorerUrl)}/tx/${t.txHash}"><b>View on ARC Scan</b></a>`;
}
