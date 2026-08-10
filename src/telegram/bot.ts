import TelegramBot from 'node-telegram-bot-api';
import type { Trade } from '../types/trade.js';
import { formatTradeNotification } from './notifications.js';
export class TelegramService {
  readonly bot: TelegramBot;
  constructor(token: string, private chatId: string, private explorerUrl: string) { this.bot = new TelegramBot(token, { polling: true }); }
  async notify(trade: Trade) { await this.bot.sendMessage(this.chatId, formatTradeNotification(trade, this.explorerUrl), { parse_mode: 'HTML', disable_web_page_preview: true }); }
  async stop() { await this.bot.stopPolling(); }
}
