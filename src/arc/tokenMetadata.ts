import type Database from 'better-sqlite3';
import { erc20Abi, type Address } from 'viem';
import type { ArcClient } from './client.js';

export const ARC_USDC_ERC20 = '0x3600000000000000000000000000000000000000' as Address;
export interface TokenMetadata { symbol: string; name: string; decimals: number }

export class TokenMetadataService {
  constructor(private client: ArcClient, private db: Database.Database) {}

  async get(address: Address): Promise<TokenMetadata> {
    const normalized = address.toLowerCase();

    // Arc exposes the same USDC balance through an ERC-20 face at this address.
    // Always return canonical metadata before consulting the cache so an old
    // fallback such as TOKEN-FFFF can never override USDC in notifications.
    if (normalized === ARC_USDC_ERC20) {
      return { symbol: 'USDC', name: 'USD Coin', decimals: 6 };
    }

    const cached = this.db
      .prepare('SELECT symbol,name,decimals FROM token_metadata WHERE address=?')
      .get(normalized) as TokenMetadata | undefined;

    // Legacy fallback values are deliberately ignored and retried. They were
    // previously persisted when an RPC metadata read failed once.
    if (cached && !cached.symbol.startsWith('TOKEN-')) return cached;

    const fallback = {
      symbol: `TOKEN-${address.slice(2, 6).toUpperCase()}`,
      name: 'Unknown token',
      decimals: 18,
    };

    const safe = async <T>(functionName: 'symbol' | 'name' | 'decimals', defaultValue: T): Promise<T> => {
      try {
        return await this.client.readContract({ address, abi: erc20Abi, functionName }) as T;
      } catch {
        return defaultValue;
      }
    };

    const metadata = {
      symbol: await safe('symbol', fallback.symbol),
      name: await safe('name', fallback.name),
      decimals: Number(await safe('decimals', fallback.decimals)),
    };

    if (!Number.isInteger(metadata.decimals) || metadata.decimals < 0 || metadata.decimals > 255) {
      metadata.decimals = 18;
    }

    // Do not persist guessed metadata. A temporary RPC failure should not poison
    // future notifications with a permanent TOKEN-XXXX label.
    if (!metadata.symbol.startsWith('TOKEN-')) {
      this.db
        .prepare('INSERT OR REPLACE INTO token_metadata VALUES(?,?,?,?,?)')
        .run(normalized, metadata.symbol, metadata.name, metadata.decimals, new Date().toISOString());
    }

    return metadata;
  }
}
