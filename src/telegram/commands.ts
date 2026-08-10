import type TelegramBot from 'node-telegram-bot-api';
import type { WalletRepository } from '../db/wallets.js';
import type { TransactionRepository } from '../db/transactions.js';
import { shortAddress } from '../utils/address.js';
export interface BotStatus { connected: () => boolean }
export function registerCommands(bot: TelegramBot, chatId: string, wallets: WalletRepository, transactions: TransactionRepository, status: BotStatus) {
  const reply = (id: number, text: string) => bot.sendMessage(id, text);
  const authorized = (id: number) => String(id) === chatId;
  bot.onText(/^\/start(?:@\w+)?$/, m => { if (authorized(m.chat.id)) void reply(m.chat.id, 'ARC Wallet Tracker monitors generic EVM token swap flows on ARC Mainnet.\n\n/add <address> [label]\n/remove <address>\n/wallets\n/pause <address>\n/resume <address>\n/status'); });
  bot.onText(/^\/(add|remove|pause|resume)(?:@\w+)?(?:\s+(.+))?$/, (m, match) => { if (!authorized(m.chat.id)) return; try { const command=match![1], parts=match![2]?.trim().split(/\s+/) ?? [], address=parts.shift(); if (!address) throw new Error(`Usage: /${command} <address>${command === 'add' ? ' [label]' : ''}`); let text=''; if(command==='add'){wallets.add(address,parts.join(' '));text='Wallet added.';} else if(command==='remove') text=wallets.remove(address)?'Wallet removed.':'Wallet not found.'; else text=wallets.setEnabled(address,command==='resume')?`Wallet ${command}d.`:'Wallet not found.'; void reply(m.chat.id,text); } catch(e) { void reply(m.chat.id, e instanceof Error ? e.message : 'Command failed.'); } });
  bot.onText(/^\/wallets(?:@\w+)?$/, m => { if (!authorized(m.chat.id)) return; const list=wallets.list(); void reply(m.chat.id, list.length ? list.map(w=>`${w.enabled?'🟢':'⏸'} ${w.label||'Unlabelled'} — ${shortAddress(w.address)}`).join('\n') : 'No tracked wallets.'); });
  bot.onText(/^\/status(?:@\w+)?$/, m => { if (!authorized(m.chat.id)) return; void reply(m.chat.id, `ARC connection: ${status.connected()?'connected':'disconnected'}\nLatest processed block: ${transactions.latestBlock()?.toString() ?? 'not initialized'}\nTracked wallets: ${wallets.list(true).length}`); });
}
