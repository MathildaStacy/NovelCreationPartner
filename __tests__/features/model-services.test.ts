import { setDb, type Db, type SqlValue } from '../../src/data/db';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { m0001 } from '../../src/data/migrations/0001_init';
import { on } from '../../src/features/events';
import * as services from '../../src/features/modelServices';
import type { ServiceDraft } from '../../src/features/modelServices';
import * as prefs from '../../src/features/prefs';
import { setSecureDriver, type SecureDriver } from '../../src/secure';
import { freshDb, tickingClock } from '../helpers/db';

let database: Db;
let slots: Map<string, string>;
let secure: jest.Mocked<SecureDriver>;

const temporaryKey = () => `invalid-${globalThis.crypto.randomUUID()}`;
const draft = (patch: Partial<ServiceDraft> = {}): ServiceDraft => ({
  name: '服务', protocol: 'openai_responses', baseUrl: 'https://example.invalid/v1', model: 'model',
  options: { ...services.DEFAULT_OPTIONS, caps: {} }, ...patch,
});

async function editing(id: string, patch: Partial<ServiceDraft> = {}): Promise<ServiceDraft> {
  const service = await services.get(id);
  return { ...service, ...patch };
}

async function credential(id: string) {
  return database.get<{ key_ref: string | null; revision: number; has_key: number }>(
    'SELECT key_ref, revision, has_key FROM model_services WHERE id = ?', [id],
  );
}

async function cleanupRefs(): Promise<string[]> {
  return (await database.all<{ key_ref: string }>('SELECT key_ref FROM credential_cleanup')).map(row => row.key_ref);
}

async function recoverWithFreshModules(): Promise<void> {
  await jest.isolateModulesAsync(async () => {
    const restartedDb: typeof import('../../src/data/db') = require('../../src/data/db');
    const restartedSecure: typeof import('../../src/secure') = require('../../src/secure');
    const restartedServices: typeof import('../../src/features/modelServices') = require('../../src/features/modelServices');
    restartedDb.setDb(database);
    restartedSecure.setSecureDriver(secure);
    try { await restartedServices.retryPendingCleanup(); }
    finally { restartedDb.setDb(null); restartedSecure.setSecureDriver(undefined); }
  });
}

/** Decorate both the connection and transaction handles, keeping real SQLite rollback. */
function decorateDb(target: Db, before: (sql: string, params: SqlValue[]) => void): Db {
  return {
    all: (sql, params = []) => { before(sql, params); return target.all(sql, params); },
    get: (sql, params = []) => { before(sql, params); return target.get(sql, params); },
    run: (sql, params = []) => { before(sql, params); return target.run(sql, params); },
    transaction: fn => target.transaction(tx => fn(decorateDb(tx, before))),
    close: () => target.close(),
  };
}

function failNextStatement(predicate: (sql: string, params: SqlValue[]) => boolean): void {
  let armed = true;
  setDb(decorateDb(database, (sql, params) => {
    if (armed && predicate(sql, params)) {
      armed = false;
      throw new Error('simulated database failure');
    }
  }));
}

beforeEach(async () => {
  tickingClock();
  database = await freshDb();
  slots = new Map();
  secure = {
    setKey: jest.fn(async (ref, key) => { slots.set(ref, key); }),
    getKey: jest.fn(async ref => slots.get(ref) ?? null),
    removeKey: jest.fn(async ref => { slots.delete(ref); }),
  };
  setSecureDriver(secure);
});

afterEach(async () => {
  setSecureDriver(undefined);
  setDb(null);
  await database.close();
});

describe('model service storage', () => {
  test('migrates v1 records without losing writing data or trusting legacy Key metadata', async () => {
    const legacy = openMemoryDb();
    try {
      await legacy.transaction(async tx => {
        for (const sql of m0001) { await tx.run(sql); }
        await tx.run('PRAGMA user_version = 1');
        await tx.run("INSERT INTO works (id, premise, created_at, updated_at) VALUES ('w', 'idea', 'x', 'x')");
        for (const [id, created] of [['later', '2026-02'], ['earlier', '2026-01']]) {
          await tx.run(
            `INSERT INTO model_services (id, name, protocol, base_url, model, is_default, has_key,
             last_test_at, last_test_ok, last_test_message, created_at, updated_at)
             VALUES (?, ?, 'openai_responses', 'https://example.invalid/v1', 'm', 1, 1, 'x', 1, 'ok', ?, ?)`,
            [id, id, created, created],
          );
        }
      });
      await expect(migrate(legacy)).resolves.toMatchObject({ from: 1, to: 2 });
      setDb(legacy);
      expect((await services.getDefault())?.id).toBe('earlier');
      expect(await services.get('earlier')).toMatchObject({ hasKey: false, keyMask: null, revision: 1, lastTest: null });
      expect(await legacy.get('SELECT premise FROM works WHERE id = ?', ['w'])).toEqual({ premise: 'idea' });
      await expect(legacy.run("UPDATE model_services SET is_default = 1 WHERE id = 'later'")).rejects.toThrow();
      await expect(migrate(legacy)).resolves.toMatchObject({ from: 2, to: 2 });
    } finally {
      setDb(database);
      await legacy.close();
    }
  });

  test('keeps raw Keys and masks out of SQLite and list/default output', async () => {
    const key = temporaryKey();
    const { service, keyCleanupPending } = await services.save(draft(), key);
    expect(keyCleanupPending).toBe(false);
    expect(service).toMatchObject({ isDefault: true, hasKey: true });
    const detail = await services.get(service.id);
    expect(detail).toMatchObject({ revision: 1, keyMask: `••••${key.slice(-4)}` });
    expect(await services.revealKey(service.id)).toBe(key);
    const stored = JSON.stringify([
      await database.all('SELECT * FROM model_services'), await database.all('SELECT * FROM preferences'),
      await database.all('SELECT * FROM credential_cleanup'),
    ]);
    expect(stored).not.toContain(key);
    expect(stored).not.toContain(detail.keyMask);
    for (const value of [service, await services.list(), await services.getDefault()]) {
      expect(JSON.stringify(value)).not.toContain(key);
      expect(JSON.stringify(value)).not.toContain('keyMask');
    }
    await expect(services.get('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('masks short Keys without disclosing any of their characters', async () => {
    const key = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const { service } = await services.save(draft(), key);
    expect((await services.get(service.id)).keyMask).toBe('••••');
  });

  test('maintains one default, deterministic successor and recent-model history', async () => {
    const first = (await services.save(draft({ name: 'first' }), temporaryKey())).service;
    const second = (await services.save(draft({ name: 'second', model: 'other' }), temporaryKey())).service;
    await services.setDefault(second.id);
    expect((await services.list()).map(value => [value.id, value.isDefault])).toEqual([[second.id, true], [first.id, false]]);
    const before = await services.get(first.id);
    await services.setDefault(first.id);
    expect((await services.get(first.id)).revision).toBe(before.revision);
    await services.save(await editing(first.id));
    expect((await prefs.get('recentModels')).map(value => value.model)).toEqual(['model', 'other']);
    await services.remove(first.id);
    expect((await services.getDefault())?.id).toBe(second.id);
    await services.remove(second.id);
    expect(await services.getDefault()).toBeNull();
    await expect(services.setDefault('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('keeps secure I/O outside transactions and emits only after committed state is readable', async () => {
    let depth = 0;
    const writes: number[] = [];
    const secureDepths: number[] = [];
    const eventDepths: number[] = [];
    const observed: Promise<unknown>[] = [];
    function tracking(target: Db): Db {
      return {
        ...target,
        run: (sql, params) => {
          if (/^\s*(insert|update|delete)/i.test(sql)) { writes.push(depth); }
          return target.run(sql, params);
        },
        transaction: fn => target.transaction(async tx => {
          depth++;
          try { return await fn(tracking(tx)); } finally { depth--; }
        }),
      };
    }
    setDb(tracking(database));
    secure.setKey.mockImplementation(async (ref, key) => { secureDepths.push(depth); slots.set(ref, key); });
    secure.getKey.mockImplementation(async ref => { secureDepths.push(depth); return slots.get(ref) ?? null; });
    secure.removeKey.mockImplementation(async ref => { secureDepths.push(depth); slots.delete(ref); });
    on('services.changed', () => {
      eventDepths.push(depth);
      observed.push(database.get('SELECT name FROM model_services WHERE is_default = 1'));
    });
    on('prefs.changed', () => {
      eventDepths.push(depth);
      observed.push(prefs.get('recentModels'));
    });
    const { service } = await services.save(draft(), temporaryKey());
    expect(await Promise.all(observed)).toEqual([{ name: service.name }, [expect.objectContaining({ model: service.model })]]);
    await services.save(await editing(service.id), temporaryKey());
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every(value => value > 0)).toBe(true);
    expect(secureDepths.every(value => value === 0)).toBe(true);
    expect(eventDepths.every(value => value === 0)).toBe(true);
  });

  test('deduplicates recent models by protocol and retains the latest twenty', async () => {
    const { service } = await services.save(draft(), temporaryKey());
    for (let index = 0; index < 22; index++) {
      await services.save(await editing(service.id, { model: `model-${index}` }));
    }
    await services.save(await editing(service.id, { model: 'model-20' }));
    const recent = await prefs.get('recentModels');
    expect(recent).toHaveLength(20);
    expect(recent.slice(0, 2).map(value => value.model)).toEqual(['model-20', 'model-21']);
    expect(new Set(recent.map(value => `${value.protocol}:${value.model}`)).size).toBe(20);
  });

  test('preserves a Key during blank edits even while secure storage is locked', async () => {
    const key = temporaryKey();
    const { service } = await services.save(draft(), key);
    const edit = await editing(service.id, { name: 'renamed' });
    const oldRef = (await credential(service.id))?.key_ref;
    secure.getKey.mockRejectedValue(new Error('device locked'));
    secure.setKey.mockClear();
    secure.getKey.mockClear();
    await services.save(edit);
    const next = { ...edit, revision: edit.revision! + 1, name: 'renamed twice' };
    await services.save(next, '');
    expect(secure.setKey).not.toHaveBeenCalled();
    expect(secure.getKey).not.toHaveBeenCalled();
    expect(await credential(service.id)).toMatchObject({ key_ref: oldRef, has_key: 1, revision: edit.revision! + 2 });
    expect(slots.get(oldRef!)).toBe(key);
  });

  test('distinguishes an unreadable slot from a confirmed missing slot', async () => {
    const { service } = await services.save(draft(), temporaryKey());
    const before = await services.get(service.id);
    const changed = jest.fn();
    on('services.changed', changed);
    secure.getKey.mockRejectedValue(new Error('device locked'));
    expect(await services.get(service.id)).toMatchObject({ hasKey: true, keyMask: null, revision: before.revision });
    await expect(services.revealKey(service.id)).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
    expect(changed).not.toHaveBeenCalled();
    await database.run("UPDATE model_services SET last_test_at = 'x', last_test_ok = 1, last_test_message = 'ok' WHERE id = ?", [service.id]);
    secure.getKey.mockImplementation(async ref => slots.get(ref) ?? null);
    slots.clear();
    expect(await services.get(service.id)).toMatchObject({ hasKey: false, keyMask: null, revision: before.revision + 1, lastTest: null });
    expect(await credential(service.id)).toMatchObject({ key_ref: null, has_key: 0 });
    expect(changed).toHaveBeenCalled();
    await expect(services.revealKey(service.id)).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
    await expect(services.save(await editing(service.id))).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  test('rejects old revisions and concurrent edits without overwriting the winner', async () => {
    const { service } = await services.save(draft(), temporaryKey());
    const edit = await editing(service.id);
    const keys = [temporaryKey(), temporaryKey()];
    const results = await Promise.allSettled(keys.map((key, index) => services.save({ ...edit, name: `writer-${index}` }, key)));
    const winner = results.findIndex(result => result.status === 'fulfilled');
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results[1 - winner]).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT_STATE' } });
    expect(await services.get(service.id)).toMatchObject({ name: `writer-${winner}`, revision: edit.revision! + 1 });
    expect(await services.revealKey(service.id)).toBe(keys[winner]);
    await expect(services.save(edit)).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
    await services.retryPendingCleanup();
    expect([...slots.values()]).toEqual([keys[winner]]);
  });

  test('rejects invalid and duplicate drafts without touching the existing credential', async () => {
    const { service } = await services.save(draft(), temporaryKey());
    const before = await credential(service.id);
    secure.setKey.mockClear();
    await expect(services.save(draft({ name: 'bad', baseUrl: 'http://example.invalid' }), temporaryKey()))
      .rejects.toMatchObject({ code: 'VALIDATION', field: 'baseUrl' });
    await expect(services.save(draft(), temporaryKey())).rejects.toMatchObject({ code: 'DUPLICATE' });
    await expect(services.save(draft({ name: 'missing key' }))).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await credential(service.id)).toEqual(before);
    expect(secure.setKey).not.toHaveBeenCalled();
  });
});

describe('durable credential compensation', () => {
  test.each([false, true])('recovers a prepared unreferenced slot after process loss (slot written: %s)', async written => {
    const ref = globalThis.crypto.randomUUID();
    await database.transaction(tx => tx.run('INSERT INTO credential_cleanup (key_ref) VALUES (?)', [ref]));
    if (written) { slots.set(ref, temporaryKey()); }
    await recoverWithFreshModules();
    expect(await cleanupRefs()).toEqual([]);
    expect(slots.size).toBe(0);
    expect(await services.list()).toEqual([]);
  });

  test('does not write a secure slot when preparation cannot be recorded', async () => {
    const changed = jest.fn();
    on('services.changed', changed);
    failNextStatement(sql => /insert\s+(?:or\s+\w+\s+)?into\s+credential_cleanup/i.test(sql));
    await expect(services.save(draft(), temporaryKey())).rejects.toMatchObject({ code: 'DB_ERROR' });
    expect(secure.setKey).not.toHaveBeenCalled();
    expect(await services.list()).toEqual([]);
    expect(await prefs.get('recentModels')).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
  });

  test.each(['write', 'verify'] as const)('retains cleanup registration after a secure %s failure and recovers on restart', async boundary => {
    const { service } = await services.save(draft(), temporaryKey());
    const edit = await editing(service.id, { name: 'replacement' });
    const old = await credential(service.id);
    const replacement = temporaryKey();
    if (boundary === 'write') {
      secure.setKey.mockImplementationOnce(async (ref, key) => { slots.set(ref, key); throw new Error('write failed after allocation'); });
    } else {
      secure.getKey.mockRejectedValueOnce(new Error('device locked during verification'));
    }
    await expect(services.save(edit, replacement)).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
    expect(await credential(service.id)).toEqual(old);
    expect((await services.get(service.id)).name).toBe(service.name);
    // Recovery relies only on SQLite and the system store, not a saved JavaScript closure.
    const registered = await cleanupRefs();
    expect(registered).toHaveLength(1);
    expect(registered).not.toContain(old?.key_ref);
    await recoverWithFreshModules();
    expect(await cleanupRefs()).toEqual([]);
    expect([...slots.keys()]).toEqual([old?.key_ref]);
    expect(await services.hasPendingKeyCleanup()).toBe(false);
  });

  test('rolls back configuration, recentModels and default when the business transaction fails', async () => {
    const { service } = await services.save(draft(), temporaryKey());
    const before = await credential(service.id);
    const recent = await prefs.get('recentModels');
    const changed = jest.fn();
    const preferencesChanged = jest.fn();
    on('services.changed', changed);
    on('prefs.changed', preferencesChanged);
    const edit = await editing(service.id, { name: 'changed', model: 'new-model' });
    failNextStatement(sql => /insert\s+(?:or\s+\w+\s+)?into\s+preferences/i.test(sql));
    await expect(services.save(edit, temporaryKey())).rejects.toMatchObject({ code: 'DB_ERROR' });
    expect(await credential(service.id)).toEqual(before);
    expect(await services.getDefault()).toMatchObject({ id: service.id, name: service.name, model: service.model });
    expect(await prefs.get('recentModels')).toEqual(recent);
    expect(changed).not.toHaveBeenCalled();
    expect(preferencesChanged).not.toHaveBeenCalled();
    setDb(database);
    await recoverWithFreshModules();
    expect([...slots.keys()]).toEqual([before?.key_ref]);
  });

  test('rolls back a completed first-service transaction if commit is rejected', async () => {
    const events: string[] = [];
    on('services.changed', () => { events.push('service'); });
    on('prefs.changed', () => { events.push('preferences'); });
    let failed = false;
    const decorated: Db = {
      ...database,
      transaction: fn => database.transaction(async tx => {
        let businessWrite = false;
        const result = await fn(decorateDb(tx, sql => {
          if (/insert\s+into\s+model_services/i.test(sql)) { businessWrite = true; }
        }));
        if (businessWrite && !failed) {
          failed = true;
          throw new Error('simulated commit failure');
        }
        return result;
      }),
    };
    setDb(decorated);
    await expect(services.save(draft(), temporaryKey())).rejects.toMatchObject({ code: 'DB_ERROR' });
    expect(failed).toBe(true);
    expect(await services.list()).toEqual([]);
    expect(await services.getDefault()).toBeNull();
    expect(await prefs.get('recentModels')).toEqual([]);
    expect(events).toEqual([]);
    expect(await cleanupRefs()).toHaveLength(1);
    setDb(database);
    await recoverWithFreshModules();
    expect(slots.size).toBe(0);
    expect(await cleanupRefs()).toEqual([]);
  });

  test('reports success and pending cleanup when old-slot deletion fails after commit', async () => {
    const { service } = await services.save(draft(), temporaryKey());
    const edit = await editing(service.id, { model: 'new-model' });
    const oldRef = (await credential(service.id))!.key_ref!;
    const replacement = temporaryKey();
    secure.removeKey.mockRejectedValue(new Error('device locked'));
    const result = await services.save(edit, replacement);
    expect(result).toMatchObject({ keyCleanupPending: true, service: { id: service.id, model: 'new-model' } });
    expect((await credential(service.id))?.key_ref).not.toBe(oldRef);
    expect(await services.revealKey(service.id)).toBe(replacement);
    expect(await cleanupRefs()).toContain(oldRef);
    expect(await services.hasPendingKeyCleanup()).toBe(true);
    secure.removeKey.mockImplementation(async ref => { slots.delete(ref); });
    await services.retryPendingCleanup();
    expect(await cleanupRefs()).toEqual([]);
    expect([...slots.values()]).toEqual([replacement]);
  });

  test('retains the durable record when deleting the cleanup registration fails', async () => {
    const { service } = await services.save(draft(), temporaryKey());
    const edit = await editing(service.id);
    const oldRef = (await credential(service.id))!.key_ref!;
    failNextStatement((sql, params) => /delete\s+from\s+credential_cleanup/i.test(sql) && params.includes(oldRef));
    const replacement = temporaryKey();
    expect(await services.save(edit, replacement)).toMatchObject({ keyCleanupPending: true });
    expect(slots.has(oldRef)).toBe(false);
    expect(await cleanupRefs()).toContain(oldRef);
    setDb(database);
    await services.retryPendingCleanup();
    expect(await cleanupRefs()).toEqual([]);
    expect(await services.revealKey(service.id)).toBe(replacement);
  });

  test('never removes a referenced slot even if a stale cleanup registration exists', async () => {
    const key = temporaryKey();
    const { service } = await services.save(draft(), key);
    const ref = (await credential(service.id))!.key_ref!;
    await database.transaction(tx => tx.run('INSERT INTO credential_cleanup (key_ref) VALUES (?)', [ref]));
    secure.removeKey.mockClear();
    await services.retryPendingCleanup();
    expect(secure.removeKey).not.toHaveBeenCalledWith(ref);
    expect(slots.get(ref)).toBe(key);
    expect(await services.revealKey(service.id)).toBe(key);
  });

  test('does not delete a Key when removing its service cannot commit', async () => {
    const { service } = await services.save(draft(), temporaryKey());
    const ref = (await credential(service.id))!.key_ref!;
    secure.removeKey.mockClear();
    failNextStatement(sql => /delete\s+from\s+model_services/i.test(sql));
    await expect(services.remove(service.id)).rejects.toMatchObject({ code: 'DB_ERROR' });
    expect(secure.removeKey).not.toHaveBeenCalled();
    expect(slots.has(ref)).toBe(true);
    expect((await services.getDefault())?.id).toBe(service.id);
    expect(await cleanupRefs()).toEqual([]);
  });

  test('commits deletion and successor default even when Key cleanup is deferred', async () => {
    const first = (await services.save(draft({ name: 'first' }), temporaryKey())).service;
    const second = (await services.save(draft({ name: 'second' }), temporaryKey())).service;
    const oldRef = (await credential(first.id))!.key_ref!;
    secure.removeKey.mockRejectedValue(new Error('device locked'));
    expect(await services.remove(first.id)).toMatchObject({ keyCleanupPending: true });
    await expect(services.get(first.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await services.getDefault())?.id).toBe(second.id);
    expect(await cleanupRefs()).toContain(oldRef);
    secure.removeKey.mockImplementation(async ref => { slots.delete(ref); });
    await services.retryPendingCleanup();
    expect(await services.hasPendingKeyCleanup()).toBe(false);
    expect(slots.has(oldRef)).toBe(false);
  });

  test('serializes replacement, removal and default selection while secure storage is waiting', async () => {
    const first = (await services.save(draft({ name: 'first' }), temporaryKey())).service;
    const second = (await services.save(draft({ name: 'second' }), temporaryKey())).service;
    const edit = await editing(first.id);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    secure.setKey.mockImplementationOnce(async (ref, key) => { entered(); await wait; slots.set(ref, key); });
    const saving = services.save(edit, temporaryKey());
    await started;
    const removing = services.remove(first.id);
    const choosing = services.setDefault(second.id);
    const cleaning = services.retryPendingCleanup();
    release();
    await Promise.all([saving, removing, choosing, cleaning]);
    expect((await services.list()).map(value => [value.id, value.isDefault])).toEqual([[second.id, true]]);
    expect([...slots.keys()]).toEqual([(await credential(second.id))?.key_ref]);
    expect(await cleanupRefs()).toEqual([]);
  });
});
