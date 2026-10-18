/// <reference types="node" />
/**
 * Test-only driver backed by Node's built-in SQLite (node:sqlite, Node >= 22.13).
 * Never import this from app code: Metro cannot bundle node: modules.
 */
import { DatabaseSync } from 'node:sqlite';
import { createDb, type Db, type Row, type SqlValue } from '../db';

const READS = /^\s*(select|with|pragma\s+\w+\s*$|pragma\s+table_info)/i;

export function openMemoryDb(): Db {
  const conn = new DatabaseSync(':memory:');
  conn.exec('PRAGMA foreign_keys = ON');
  return createDb({
    async query(sql: string, params: SqlValue[]) {
      const stmt = conn.prepare(sql);
      if (READS.test(sql) || /\breturning\b/i.test(sql)) {
        const rows = stmt.all(...params) as Row[];
        return { rows: rows.map(r => ({ ...r })), changes: 0 };
      }
      const res = stmt.run(...params);
      return { rows: [], changes: Number(res.changes) };
    },
    async close() {
      conn.close();
    },
  });
}
