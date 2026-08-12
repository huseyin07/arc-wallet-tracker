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
  private lastRecoveryAt = 0;

  constructor(
    private http: PublicClient,
    private ws: PublicClient | undefined,
    private wallets: WalletRepository,
    private txRepo: TransactionRepository,
    private analyzer: TransactionAnalyzer,
    private onTrade: (trade: Trade) => Promise<boolean>,
    private pollingIntervalMs = 1_000,
    private recoveryIntervalMs = 5_000,
    private recoveryLookbackBlocks = 12n,
  ) {}

  connected = () => this.connectedState;

  async start() {
    if (this.txRepo.latestBlock() === undefined) {
      const tip = await this.http.getBlockNumber();
      // Re-read a short recent window after a fresh/recreated runtime. This avoids
      // losing a trade that landed while the service was restarting/deploying.
      const start = tip > this.recoveryLookbackBlocks
        ? tip - this.recoveryLookbackBlocks
        : 0n;
      this.txRepo.setLatestBlock(start);
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
      recoveryIntervalMs: this.recoveryIntervalMs,
      recoveryLookbackBlocks: this.recoveryLookbackBlocks,
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

        // A provider can occasionally return a block before all indexed data is
        // available. Re-reading a tiny recent window lets us recover a tracked
        // transaction that was absent from an earlier response. txRepo prevents
        // duplicate notifications for transactions already handled.
        if (Date.now() - this.lastRecoveryAt >= this.recoveryIntervalMs) {
          await this.recoverRecentBlocks(latest);
          this.lastRecoveryAt = Date.now();
        }
      } catch (error) {
        this.connectedState = false;
        logger.error('HTTP block poll failed; retrying', { error });
      }
      if (!this.stopping) await sleep(this.pollingIntervalMs);
    }
  }

  private async recoverRecentBlocks(tip: bigint) {
    const start = tip >= this.recoveryLookbackBlocks
      ? tip - this.recoveryLookbackBlocks + 1n
      : 0n;

    let recovered = 0;
    for (let block = start; block <= tip && !this.stopping; block += 1n) {
      try {
        recovered += await this.processBlock(block, true);
      } catch (error) {
        // Recovery is best-effort. The normal ordered catch-up path remains the
        // source of truth and will retry current-block failures without skipping.
        logger.warn('Recent block recovery read failed', { block, error });
      }
    }

    if (recovered > 0) {
      logger.info('Recovered missed tracked transactions', {
        count: recovered,
        fromBlock: start,
        toBlock: tip,
      });
    }
  }

  private async catchUp(target: bigint) {
    let next = (this.txRepo.latestBlock() ?? target) + 1n;
    while (!this.stopping && next <= target) {
      try {
        await this.processBlock(next, false);
        this.txRepo.setLatestBlock(next);
        next += 1n;
      } catch (error) {
        logger.error('Block processing failed; block will be retried', { block: next, error });
        return;
      }
    }
  }

  private async processBlock(number: bigint, recovery = false): Promise<number> {
    const block = await this.http.getBlock({ blockNumber: number, includeTransactions: true });
    const wallets = this.wallets.list(true);
    const walletsByAddress = new Map(
      wallets.map((wallet) => [wallet.address.toLowerCase(), wallet] as const),
    );
    let processedTracked = 0;

    for (const transaction of block.transactions as Transaction[]) {
      const wallet = walletsByAddress.get(transaction.from.toLowerCase());
      if (!wallet) continue;
      if (this.txRepo.has(transaction.hash)) continue;

      const startedAt = Date.now();
      const timingFields = {
        txHash: transaction.hash,
        wallet: wallet.address,
        blockNumber: number,
        recovery,
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
        logger.warn('Receipt unavailable; transaction will be retried', {
          ...timingFields,
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
        logger.error('Transaction analysis failed', { hash: transaction.hash, error });
      }

      this.txRepo.mark(transaction.hash, number);
      processedTracked += 1;
    }

    if (!recovery) {
      logger.info('Block processed', { block: number, transactions: block.transactions.length });
    }
    return processedTracked;
  }

  async stop() {
    this.stopping = true;
    this.stopWatch?.();
    await this.queue;
    await this.pollingTask;
    this.connectedState = false;
  }
}
