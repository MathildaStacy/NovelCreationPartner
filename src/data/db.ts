/**
 * Database access shared by every service (G02 §1).
 *
 * The app uses op-sqlite and the Jest tests use Node's built-in SQLite. Both are
 * wrapped as a `Driver`; services only see `Db`.
 *
 * One SQLite connection is shared by async callers, so statements from two
 * operations could interleave inside each other's transaction. A simple lock
 * serialises work: a transaction holds the lock until it commits or rolls back,
 * and a statement outside a transaction waits for the lock too.
 */

export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

export interface Driver {
  query(sql: string, params: SqlValue[]): Promise<{ rows: Row[]; changes: number }>;
  close(): Promise<void>;
}

export interface Db {
  all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Runs `fn` inside one transaction. Nested calls join the outer transaction. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class Lock {
  private tail: Promise<void> = Promise.resolve();

  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>(resolve => {
      release = resolve;
    });
    const ready = this.tail.then(() => release);
    this.tail = this.tail.then(() => next);
    return ready;
  }
}

function makeQueryable(
  exec: (sql: string, params: SqlValue[]) => Promise<{ rows: Row[]; changes: number }>,
  transaction: Db['transaction'],
  close: () => Promise<void>,
): Db {
  return {
    async all<T>(sql: string, params: SqlValue[] = []) {
      return (await exec(sql, params)).rows as unknown as T[];
    },
    async get<T>(sql: string, params: SqlValue[] = []) {
      return (await exec(sql, params)).rows[0] as unknown as T | undefined;
    },
    async run(sql: string, params: SqlValue[] = []) {
      return { changes: (await exec(sql, params)).changes };
    },
    transaction,
    close,
  };
}

export function createDb(driver: Driver): Db {
  const lock = new Lock();

  const locked = async (sql: string, params: SqlValue[]) => {
    const release = await lock.acquire();
    try {
      return await driver.query(sql, params);
    } finally {
      release();
    }
  };

  const transaction = async <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
    const release = await lock.acquire();
    const tx: Db = makeQueryable(
      (sql, params) => driver.query(sql, params),
      inner => inner(tx),
      async () => {},
    );
    try {
      await driver.query('BEGIN IMMEDIATE', []);
      try {
        const result = await fn(tx);
        await driver.query('COMMIT', []);
        return result;
      } catch (e) {
        await driver.query('ROLLBACK', []);
        throw e;
      }
    } finally {
      release();
    }
  };

  return makeQueryable(locked, transaction, () => driver.close());
}

let current: Db | null = null;

/** Set once at startup (G02 §10) or by a test before calling services. */
export function setDb(next: Db | null) {
  current = next;
}

export function db(): Db {
  if (!current) {
    throw new Error('Database is not open');
  }
  return current;
}
