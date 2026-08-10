import { describe, expect, it, vi } from 'vitest';
import { ArcListener } from './listener.js';

const trackedWallet = '0x00000000000000000000000000000000000000aa';
const unrelatedWallet = '0x00000000000000000000000000000000000000bb';

function transaction(from: string, suffix: string) {
  return {
    from,
    to: '0x00000000000000000000000000000000000000cc',
    hash: `0x${suffix.padStart(64, '0')}`,
    input: '0x12345678',
    value: 0n,
  };
}

function blockHarness(transactionsInBlock: ReturnType<typeof transaction>[]) {
  const receipt = { status: 'success', blockNumber: 11n, logs: [] };
  const getTransactionReceipt = vi.fn(async () => receipt);
  const analyze = vi.fn(async () => ({
    type: 'UNKNOWN',
    wallet: trackedWallet,
    txHash: transactionsInBlock[0]?.hash,
    blockNumber: 11n,
    timestamp: new Date(),
  }));
  const notify = vi.fn(async () => true);
  const listener = new ArcListener(
    {
      getBlock: vi.fn(async () => ({ transactions: transactionsInBlock, timestamp: 1n })),
      getTransactionReceipt,
    } as any,
    undefined,
    { list: () => [{ address: trackedWallet, enabled: true, createdAt: '' }] } as any,
    { has: () => false, mark: vi.fn() } as any,
    { analyze } as any,
    notify,
  );
  const processBlock = () => (listener as any).processBlock(11n) as Promise<void>;
  return { processBlock, getTransactionReceipt, analyze, notify };
}

describe('HTTP polling fallback', () => {
  it('processes every block after the persisted checkpoint in order', async () => {
    const processed: bigint[] = [];
    let checkpoint = 10n;
    const http = {
      getBlockNumber: async () => 13n,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
        processed.push(blockNumber);
        return { transactions: [], timestamp: 1n };
      },
    };
    const transactions = {
      latestBlock: () => checkpoint,
      setLatestBlock: (block: bigint) => { checkpoint = block; },
    };
    const listener = new ArcListener(
      http as any,
      undefined,
      { list: () => [] } as any,
      transactions as any,
      {} as any,
      async () => false,
      5,
    );

    await listener.start();
    while (checkpoint !== 13n) await new Promise((resolve) => setTimeout(resolve, 1));
    await listener.stop();

    expect(processed).toEqual([11n, 12n, 13n]);
    expect(checkpoint).toBe(13n);
  });
});

describe('tracked transaction receipt pre-filter', () => {
  it('does not fetch a receipt for an unrelated transaction', async () => {
    const harness = blockHarness([transaction(unrelatedWallet, '1')]);
    await harness.processBlock();
    expect(harness.getTransactionReceipt).not.toHaveBeenCalled();
    expect(harness.analyze).not.toHaveBeenCalled();
  });

  it('fetches a receipt for a transaction sent by a tracked wallet', async () => {
    const tracked = transaction(trackedWallet.toUpperCase().replace('0X', '0x'), '2');
    const harness = blockHarness([tracked]);
    await harness.processBlock();
    expect(harness.getTransactionReceipt).toHaveBeenCalledOnce();
    expect(harness.getTransactionReceipt).toHaveBeenCalledWith({ hash: tracked.hash });
  });

  it('analyzes and notifies as soon as the tracked receipt is fetched', async () => {
    const events: string[] = [];
    const tracked = transaction(trackedWallet, '3');
    const harness = blockHarness([tracked]);
    harness.getTransactionReceipt.mockImplementation(async () => {
      events.push('receipt');
      return { status: 'success', blockNumber: 11n, logs: [] } as any;
    });
    harness.analyze.mockImplementation(async () => {
      events.push('analyze');
      return { type: 'SWAP', wallet: trackedWallet, txHash: tracked.hash, blockNumber: 11n, timestamp: new Date() } as any;
    });
    harness.notify.mockImplementation(async () => { events.push('notify'); return true; });

    await harness.processBlock();
    expect(events).toEqual(['receipt', 'analyze', 'notify']);
  });

  it('makes no additional receipt calls for a block full of unrelated transactions', async () => {
    const unrelated = Array.from({ length: 1_000 }, (_, index) =>
      transaction(unrelatedWallet, String(index + 10)),
    );
    const tracked = transaction(trackedWallet, '9999');
    const harness = blockHarness([...unrelated, tracked]);
    await harness.processBlock();
    expect(harness.getTransactionReceipt).toHaveBeenCalledOnce();
    expect(harness.analyze).toHaveBeenCalledOnce();
  });
});
