import type { PublicClient, Transaction, TransactionReceipt } from 'viem';
import type { TransactionRepository } from '../db/transactions.js';
import type { Wallet, WalletRepository } from '../db/wallets.js';
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
    private onTrade: (trade: Trade) => Promise<void>,
    private pollingIntervalMs = 4_000,
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

    for (const transaction of block.transactions as Transaction[]) {
      if (this.txRepo.has(transaction.hash)) continue;

      let receipt: TransactionReceipt;
      try {
        receipt = await this.http.getTransactionReceipt({ hash: transaction.hash });
      } catch (error) {
        logger.warn('Receipt unavailable; retaining block checkpoint for retry', {
          hash: transaction.hash,
          error,
        });
        throw error;
      }

      for (const wallet of this.involvedWallets(wallets, transaction, receipt)) {
        try {
          const trade = await this.analyzer.analyze({
            wallet: wallet.address,
            walletLabel: wallet.label,
            transaction,
            receipt,
            timestamp: new Date(Number(block.timestamp) * 1_000),
          });
          if (trade.type !== 'UNKNOWN') await this.onTrade(trade);
        } catch (error) {
          // A malformed transaction must not prevent later transactions or blocks.
          logger.error('Transaction analysis failed', { hash: transaction.hash, error });
        }
      }
      this.txRepo.mark(transaction.hash, number);
    }

    logger.info('Block processed', { block: number, transactions: block.transactions.length });
  }

  private involvedWallets(
    wallets: Wallet[],
    transaction: Transaction,
    receipt: TransactionReceipt,
  ) {
    const addresses = [
      transaction.from,
      transaction.to,
      ...receipt.logs.flatMap((log) => [
        log.topics[1] ? `0x${log.topics[1].slice(-40)}` : '',
        log.topics[2] ? `0x${log.topics[2].slice(-40)}` : '',
      ]),
    ].map((address) => address?.toLowerCase());
    return wallets.filter((wallet) => addresses.includes(wallet.address));
  }

  async stop() {
    this.stopping = true;
    this.stopWatch?.();
    await this.queue;
    await this.pollingTask;
    this.connectedState = false;
  }
}
