import type { PublicClient, Transaction, TransactionReceipt } from 'viem';
import type { TransactionRepository } from '../db/transactions.js';
import type { WalletRepository } from '../db/wallets.js';
import type { Trade } from '../types/trade.js';
import { logger } from '../utils/logger.js';
import type { TransactionAnalyzer } from './transactionAnalyzer.js';

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class ArcListener {
  private stopWatch?: () => void;
  private connectedState = false;
  private queue = Promise.resolve();
  private stopping = false;
  private pollingTask?: Promise<void>;

  constructor(
    private http: PublicClient,
    private ws: PublicClient | undefined,
    private wallets: WalletRepository,
    private txRepo: TransactionRepository,
    private analyzer: TransactionAnalyzer,
    private onTrade: (trade: Trade) => Promise<boolean>,
    private pollingIntervalMs = 1_000,
  ) {}

  connected = () => this.connectedState;

  async start() {
    if (this.txRepo.latestBlock() === undefined) {
      this.txRepo.setLatestBlock(await this.http.getBlockNumber());
    }

    if (this.ws) {
      this.stopWatch = this.ws.watchBlocks({
        emitMissed: true,
        onBlock: (block) => {
          this.connectedState = true;
          this.enqueueCatchUp(block.number);
        },
        onError: (error) => {
          this.connectedState = false;
          logger.error('WebSocket listener error; transport will reconnect', { error });
        },
      });
      logger.info('ARC Mainnet listener started', { mode: 'websocket' });
      return;
    }

    logger.info('ARC Mainnet listener started', {
      mode: 'http-polling',
      intervalMs: this.pollingIntervalMs,
    });
    this.pollingTask = this.pollContinuously();
  }

  private enqueueCatchUp(target: bigint) {
    this.queue = this.queue
      .then(() => this.catchUp(target))
      .catch((error) => logger.error('Queued block processing failed', { error }));
  }

  private async pollContinuously() {
    while (!this.stopping) {
      try {
        const latest = await this.http.getBlockNumber();
        this.connectedState = true;
        await this.catchUp(latest);
      } catch (error) {
        this.connectedState = false;
        logger.error('HTTP block poll failed; retrying', { error });
      }
      if (!this.stopping) await sleep(this.pollingIntervalMs);
    }
  }

  private async catchUp(target: bigint) {
    let next = (this.txRepo.latestBlock() ?? target) + 1n;
    while (!this.stopping && next <= target) {
      try {
        await this.processBlock(next);
        // The checkpoint advances only after the entire block completes successfully.
        this.txRepo.setLatestBlock(next);
        next += 1n;
      } catch (error) {
        logger.error('Block processing failed; block will be retried', { block: next, error });
        return;
      }
    }
  }

  private async processBlock(number: bigint) {
    const block = await this.http.getBlock({ blockNumber: number, includeTransactions: true });
    const wallets = this.wallets.list(true);
    const walletsByAddress = new Map(
      wallets.map((wallet) => [wallet.address.toLowerCase(), wallet] as const),
    );

    for (const transaction of block.transactions as Transaction[]) {
      // Trades monitored by this bot are initiated by a tracked wallet. Filtering
      // by sender before requesting a receipt avoids an RPC call for every other
      // transaction in the block and deliberately ignores incoming airdrops.
      const wallet = walletsByAddress.get(transaction.from.toLowerCase());
      if (!wallet) continue;
      if (this.txRepo.has(transaction.hash)) continue;

      const startedAt = Date.now();
      const timingFields = {
        txHash: transaction.hash,
        wallet: wallet.address,
        blockNumber: number,
      };
      logger.info('Tracked wallet transaction detected', {
        ...timingFields,
        elapsedMs: Date.now() - startedAt,
      });

      let receipt: TransactionReceipt;
      try {
        receipt = await this.http.getTransactionReceipt({ hash: transaction.hash });
        logger.info('Receipt fetched', {
          ...timingFields,
          elapsedMs: Date.now() - startedAt,
        });
      } catch (error) {
        logger.warn('Receipt unavailable; retaining block checkpoint for retry', {
          hash: transaction.hash,
          error,
        });
        throw error;
      }

      try {
        const trade = await this.analyzer.analyze({
          wallet: wallet.address,
          walletLabel: wallet.label,
          transaction,
          receipt,
          timestamp: new Date(Number(block.timestamp) * 1_000),
        });
        logger.info('Trade analyzed', {
          ...timingFields,
          tradeType: trade.type,
          elapsedMs: Date.now() - startedAt,
        });
        if (trade.type !== 'UNKNOWN') {
          const notificationSent = await this.onTrade(trade);
          if (notificationSent) {
            logger.info('Telegram notification sent', {
              ...timingFields,
              tradeType: trade.type,
              elapsedMs: Date.now() - startedAt,
            });
          }
        }
      } catch (error) {
        // A malformed transaction must not prevent later transactions or blocks.
        logger.error('Transaction analysis failed', { hash: transaction.hash, error });
      }
      this.txRepo.mark(transaction.hash, number);
    }

    logger.info('Block processed', { block: number, transactions: block.transactions.length });
  }

  async stop() {
    this.stopping = true;
    this.stopWatch?.();
    await this.queue;
    await this.pollingTask;
    this.connectedState = false;
  }
}
