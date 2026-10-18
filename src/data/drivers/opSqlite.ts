import { open } from '@op-engineering/op-sqlite';
import { createDb, type Db, type Row, type SqlValue } from '../db';

/** Opens the app database on the device. FTS5 is enabled in package.json ("op-sqlite"). */
export function openDeviceDb(name = 'novel.db'): Db {
  const conn = open({ name });
  return createDb({
    async query(sql: string, params: SqlValue[]) {
      const res = await conn.execute(sql, params);
      return { rows: (res.rows ?? []) as Row[], changes: res.rowsAffected ?? 0 };
    },
    async close() {
      conn.close();
    },
  });
}
