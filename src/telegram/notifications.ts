import { formatUnits } from 'viem';
import type { Trade } from '../types/trade.js';
import { shortAddress } from '../utils/address.js';
const escape = (v: string) => v.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!));
const amount = (raw: bigint, decimals: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(Number(formatUnits(raw, decimals)));
export function formatTradeNotification(t: Trade, explorerUrl: string): string {
  const icons = { BUY: '🟢', SELL: '🔴', SWAP: '🔵', UNKNOWN: '⚪' };
  const firstLabel = t.type === 'BUY' ? 'Bought' : t.type === 'SELL' ? 'Sold' : 'Sent';
  const secondLabel = t.type === 'BUY' ? 'Spent' : 'Received';
  const first = t.type === 'BUY' ? t.tokenOut : t.tokenIn;
  const second = t.type === 'BUY' ? t.tokenIn : t.tokenOut;
  if (!first || !second) throw new Error('Trade notification requires two asset flows');
  return `${icons[t.type]} <b>ARC ${t.type}</b>\n\n<b>Wallet:</b> ${escape(t.walletLabel || 'Unlabelled')}\n<code>${shortAddress(t.wallet)}</code>\n\n<b>${firstLabel}:</b>\n${amount(first.rawAmount, first.decimals)} ${escape(first.symbol)}\n\n<b>${secondLabel}:</b>\n${amount(second.rawAmount, second.decimals)} ${escape(second.symbol)}\n\n<b>Transaction:</b>\n<a href="${escape(explorerUrl)}/tx/${t.txHash}">View on ARC Scan</a>`;
}
