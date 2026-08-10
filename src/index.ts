import 'dotenv/config';
import { formatUnits } from 'viem';
import { openDatabase } from './db/database.js';
import { WalletRepository } from './db/wallets.js';
import { TransactionRepository } from './db/transactions.js';
import { createArcClients } from './arc/client.js';
import { TokenMetadataService } from './arc/tokenMetadata.js';
import { TransactionAnalyzer } from './arc/transactionAnalyzer.js';
import { ArcListener } from './arc/listener.js';
import { TelegramService } from './telegram/bot.js';
import { registerCommands } from './telegram/commands.js';
import { logger } from './utils/logger.js';
import type { Trade } from './types/trade.js';

const required = (name: string, fallback?: string) => { const value=process.env[name] || fallback; if(!value) throw new Error(`Missing required environment variable ${name}`); return value; };
const enabled = (name: string) => (process.env[name] ?? 'true').toLowerCase() === 'true';
async function main() {
  const db=openDatabase(process.env.DATABASE_PATH || './data/arc-wallet-tracker.db');
  const wallets=new WalletRepository(db), transactions=new TransactionRepository(db);
  const chainId = Number(required('ARC_CHAIN_ID'));
  if (chainId !== 5042) throw new Error('ARC_CHAIN_ID must be 5042 (ARC Mainnet)');
  const explorerUrl = required('ARC_EXPLORER_URL').replace(/\/$/, '');
  const {httpClient,wsClient}=createArcClients({
    chainId,
    rpcUrl: required('ARC_RPC_URL'),
    wsUrl: process.env.ARC_WS_URL?.trim() || undefined,
    explorerUrl,
  });
  const telegram=new TelegramService(required('TELEGRAM_BOT_TOKEN'),required('TELEGRAM_CHAT_ID'),explorerUrl);
  const minUsdc=Number(process.env.MIN_USDC_VALUE ?? '0'); if(!Number.isFinite(minUsdc)||minUsdc<0) throw new Error('MIN_USDC_VALUE must be a non-negative number');
  const shouldNotify=(trade:Trade) => { if(!enabled(`NOTIFY_${trade.type}S`)) return false; const usdc=trade.tokenIn?.symbol.toUpperCase()==='USDC'?trade.tokenIn:trade.tokenOut?.symbol.toUpperCase()==='USDC'?trade.tokenOut:undefined; return !usdc || Number(formatUnits(usdc.rawAmount,usdc.decimals))>=minUsdc; };
  const pollInterval = Number(process.env.ARC_POLL_INTERVAL_MS ?? '4000');
  if (!Number.isInteger(pollInterval) || pollInterval < 500) throw new Error('ARC_POLL_INTERVAL_MS must be an integer of at least 500');
  const listener=new ArcListener(httpClient,wsClient,wallets,transactions,new TransactionAnalyzer(new TokenMetadataService(httpClient,db)),async trade=>{if(shouldNotify(trade)) await telegram.notify(trade);},pollInterval);
  registerCommands(telegram.bot,required('TELEGRAM_CHAT_ID'),wallets,transactions,listener); await listener.start();
  let closing=false; const shutdown=async(signal:string)=>{if(closing)return;closing=true;logger.info('Graceful shutdown',{signal});await listener.stop();await telegram.stop();db.close();};
  process.once('SIGINT',()=>void shutdown('SIGINT')); process.once('SIGTERM',()=>void shutdown('SIGTERM'));
}
main().catch(error=>{logger.error('Fatal startup error',{error});process.exitCode=1;});
