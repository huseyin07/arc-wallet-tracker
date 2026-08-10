import type Database from 'better-sqlite3';
import type { Address } from 'viem';
import { normalizeAddress } from '../utils/address.js';
export interface Wallet { address: Address; label?: string; enabled: boolean; createdAt: string }
export class WalletRepository {
  constructor(private db: Database.Database) {}
  add(address: string, label?: string) { const a = normalizeAddress(address); this.db.prepare(`INSERT INTO wallets(address,label,enabled,created_at) VALUES(?,?,1,?) ON CONFLICT(address) DO UPDATE SET label=excluded.label,enabled=1`).run(a, label?.trim() || null, new Date().toISOString()); return a; }
  remove(address: string) { return this.db.prepare('DELETE FROM wallets WHERE address=?').run(normalizeAddress(address)).changes > 0; }
  setEnabled(address: string, enabled: boolean) { return this.db.prepare('UPDATE wallets SET enabled=? WHERE address=?').run(enabled ? 1 : 0, normalizeAddress(address)).changes > 0; }
  list(enabledOnly = false): Wallet[] { const rows = this.db.prepare(`SELECT address,label,enabled,created_at FROM wallets${enabledOnly ? ' WHERE enabled=1' : ''} ORDER BY created_at`).all() as any[]; return rows.map(r => ({ address: r.address, label: r.label ?? undefined, enabled: Boolean(r.enabled), createdAt: r.created_at })); }
}
