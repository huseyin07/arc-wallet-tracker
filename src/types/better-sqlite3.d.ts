declare module 'better-sqlite3' {
  namespace Database {
    interface RunResult { changes: number; lastInsertRowid: number | bigint }
    interface Statement { run(...params: unknown[]): RunResult; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] }
    interface Database { pragma(source: string): unknown; exec(source: string): this; prepare(source: string): Statement; close(): void }
  }
  class Database implements Database.Database {
    constructor(path: string); pragma(source: string): unknown; exec(source: string): this; prepare(source: string): Database.Statement; close(): void;
  }
  export = Database;
}
