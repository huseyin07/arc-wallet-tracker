import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (address TEXT PRIMARY KEY, label TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS processed_transactions (hash TEXT PRIMARY KEY, block_number TEXT NOT NULL, processed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS token_metadata (address TEXT PRIMARY KEY, symbol TEXT NOT NULL, name TEXT NOT NULL, decimals INTEGER NOT NULL, updated_at TEXT NOT NULL);
  `);
  return db;
}
