import type Database from 'better-sqlite3';
import { erc20Abi, type Address } from 'viem';
import type { ArcClient } from './client.js';
export interface TokenMetadata { symbol: string; name: string; decimals: number }
export class TokenMetadataService {
  constructor(private client: ArcClient, private db: Database.Database) {}
  async get(address: Address): Promise<TokenMetadata> {
    const cached = this.db.prepare('SELECT symbol,name,decimals FROM token_metadata WHERE address=?').get(address.toLowerCase()) as TokenMetadata|undefined;
    if (cached) return cached;
    const fallback = { symbol: `TOKEN-${address.slice(2, 6).toUpperCase()}`, name: 'Unknown token', decimals: 18 };
    const safe = async <T>(functionName: 'symbol'|'name'|'decimals', defaultValue: T): Promise<T> => { try { return await this.client.readContract({ address, abi: erc20Abi, functionName }) as T; } catch { return defaultValue; } };
    const metadata = { symbol: await safe('symbol', fallback.symbol), name: await safe('name', fallback.name), decimals: Number(await safe('decimals', fallback.decimals)) };
    if (!Number.isInteger(metadata.decimals) || metadata.decimals < 0 || metadata.decimals > 255) metadata.decimals = 18;
    this.db.prepare('INSERT OR REPLACE INTO token_metadata VALUES(?,?,?,?,?)').run(address.toLowerCase(), metadata.symbol, metadata.name, metadata.decimals, new Date().toISOString()); return metadata;
  }
}
