import { setDb, type Db } from '../../src/data/db';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { clearAllHandlers } from '../../src/features/events';
import { setClock } from '../../src/utils/id';

/** Fresh migrated in-memory database per test, with a controllable clock. */
export async function freshDb(): Promise<Db> {
  const d = openMemoryDb();
  await migrate(d);
  setDb(d);
  clearAllHandlers();
  return d;
}

let t = Date.parse('2026-10-18T09:00:00+08:00');

/** Each call to the clock advances one second, so timestamps are strictly ordered. */
export function tickingClock(): void {
  t = Date.parse('2026-10-18T09:00:00+08:00');
  setClock(() => new Date((t += 1000)));
}
