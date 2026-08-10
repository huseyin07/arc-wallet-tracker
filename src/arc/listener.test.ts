import { describe, expect, it } from 'vitest';
import { ArcListener } from './listener.js';

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
      async () => undefined,
      5,
    );

    await listener.start();
    while (checkpoint !== 13n) await new Promise((resolve) => setTimeout(resolve, 1));
    await listener.stop();

    expect(processed).toEqual([11n, 12n, 13n]);
    expect(checkpoint).toBe(13n);
  });
});
