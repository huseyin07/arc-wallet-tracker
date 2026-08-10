import type Database from 'better-sqlite3';
export class TransactionRepository {
  constructor(private db: Database.Database) {}
  has(hash: string) { return Boolean(this.db.prepare('SELECT 1 FROM processed_transactions WHERE hash=?').get(hash.toLowerCase())); }
  mark(hash: string, block: bigint) { return this.db.prepare('INSERT OR IGNORE INTO processed_transactions(hash,block_number,processed_at) VALUES(?,?,?)').run(hash.toLowerCase(), block.toString(), new Date().toISOString()).changes > 0; }
  latestBlock(): bigint | undefined { const row = this.db.prepare("SELECT value FROM state WHERE key='latest_block'").get() as {value: string}|undefined; return row ? BigInt(row.value) : undefined; }
  setLatestBlock(block: bigint) { this.db.prepare("INSERT INTO state(key,value) VALUES('latest_block',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(block.toString()); }
}
