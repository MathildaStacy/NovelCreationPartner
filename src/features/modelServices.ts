/** Model service configuration and durable secure-store compensation (G02 §5.11). */
import { db, type Db } from '../data/db';
import * as secure from '../secure';
import { nowIso, uuid } from '../utils/id';
import { modelServiceText as t } from '../locales/modelServices';
import { AiCallError, AppError, isAppError, validation } from './errors';
import { emit } from './events';
import type { ID, ModelService, Protocol } from './types';
import type { Prefs } from './prefs';
import { DEFAULT_OPTIONS, normalizeKey, validateDraft, type ServiceDraft } from './modelServiceConfig';
import { connectionTestLedger } from './aiUsage';
import { testConnection } from '../ai/providers/connectionTest';
import { createProvider } from '../ai/providers/httpProvider';
import { aiFailure, ProviderFailure } from '../ai/providers/errors';
import type { TestResult } from '../ai/providers/types';

export { DEFAULT_OPTIONS, resolveUrl } from './modelServiceConfig';
export type { ServiceDraft } from './modelServiceConfig';
export type { TestResult } from '../ai/providers/types';
export type ServiceDetail = ModelService & { keyMask: string | null; revision: number };
interface ServiceRow {
  id: string; name: string; protocol: Protocol; base_url: string; model: string;
  options: string; is_default: number; has_key: number; key_ref: string | null;
  revision: number; last_test_at: string | null; last_test_ok: number | null;
  last_test_message: string | null; created_at: string; updated_at: string;
}

// All configuration/key operations share one short coordinator. No network
// operation may run under it. SQLite transactions never include secure I/O.
let tail: Promise<void> = Promise.resolve();
const requests = new Map<ID, Set<AbortController>>();
const latestTests = new Map<ID, symbol>();
let activeTests = 0;
interface TestAssociation {
  draft: ServiceDraft;
  key: string | undefined;
  keyRef: string | null;
  signal: AbortSignal;
  result: TestResult;
}
const associations = new WeakMap<TestResult, TestAssociation>();
const cancelled = () => new AppError('AI_CANCELLED', t.cancelled);
function abortRequests(id: ID) { requests.get(id)?.forEach(controller => controller.abort()); }
function ownRequest(id: ID | undefined, external: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  external.addEventListener('abort', abort, { once: true });
  if (external.aborted) abort();
  if (id) {
    const set = requests.get(id) ?? new Set<AbortController>();
    set.add(controller); requests.set(id, set);
  }
  return { controller, release() {
    external.removeEventListener('abort', abort);
    if (id) {
      const set = requests.get(id); set?.delete(controller);
      if (set?.size === 0) requests.delete(id);
    }
  } };
}
function sameConnection(a: ServiceDraft, b: ServiceDraft): boolean {
  return a.protocol === b.protocol && a.baseUrl === b.baseUrl && a.model === b.model && a.options.authHeader === b.options.authHeader;
}
function matchingResult(result: TestResult | undefined, draft: ServiceDraft, key: string | undefined, row?: ServiceRow): TestResult | undefined {
  const association = result && associations.get(result);
  if (!association || association.signal.aborted || association.draft.id !== draft.id || association.draft.revision !== draft.revision || !sameConnection(association.draft, draft)) return;
  if (association.key !== undefined ? association.key !== key : key !== undefined || association.keyRef !== row?.key_ref) return;
  return association.result;
}
async function coordinated<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  const previous = tail;
  tail = previous.then(() => next);
  await previous;
  try { return await fn(); } catch (error) { throw localError(error); }
  finally { release(); }
}
function localError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const message = error instanceof Error ? error.message : '';
  return new AppError(/SQLITE_FULL|database or disk is full|No space left/i.test(message) ? 'STORAGE_FULL' : 'DB_ERROR', t.storageFailed);
}
function optionsFrom(row: ServiceRow): ModelService['options'] {
  try {
    const value = JSON.parse(row.options) as Partial<ModelService['options']>;
    return { ...DEFAULT_OPTIONS, ...value, caps: { ...value.caps } };
  } catch { return { ...DEFAULT_OPTIONS, caps: {} }; }
}
function toService(row: ServiceRow): ModelService {
  return {
    id: row.id, name: row.name, protocol: row.protocol, baseUrl: row.base_url,
    model: row.model, isDefault: Number(row.is_default) === 1, options: optionsFrom(row),
    hasKey: Number(row.has_key) === 1,
    lastTest: row.last_test_at == null ? null : {
      at: row.last_test_at, ok: Number(row.last_test_ok) === 1, message: row.last_test_message ?? '',
    },
  };
}
async function rowIn(tx: Db, id: ID): Promise<ServiceRow> {
  const row = await tx.get<ServiceRow>('SELECT * FROM model_services WHERE id = ?', [id]);
  if (!row) throw new AppError('NOT_FOUND', t.missing);
  return row;
}
function checkRevision(row: ServiceRow, draft: ServiceDraft) {
  if (Number(row.revision) !== draft.revision) throw new AppError('CONFLICT_STATE', t.changed);
}
async function nameIn(tx: Db, draft: ServiceDraft): Promise<string> {
  const names = await tx.all<{ name: string }>('SELECT name FROM model_services WHERE id != ?', [draft.id ?? '']);
  const used = new Set(names.map(row => row.name));
  if (draft.name) {
    if (used.has(draft.name)) throw new AppError('DUPLICATE', t.duplicate(draft.name), 'name');
    return draft.name;
  }
  const host = new URL(draft.baseUrl).hostname;
  const base = host === 'api.openai.com' ? 'OpenAI' : host === 'api.anthropic.com' ? 'Anthropic' : host;
  let name = base;
  for (let suffix = 2; used.has(name); suffix++) name = `${base} ${suffix}`;
  return name;
}
async function recentIn(tx: Db, draft: ServiceDraft): Promise<void> {
  const row = await tx.get<{ value: string }>('SELECT value FROM preferences WHERE key = ?', ['recentModels']);
  let recent: Prefs['recentModels'] = [];
  try { const value = JSON.parse(row?.value ?? '[]'); if (Array.isArray(value)) recent = value; } catch { /* defaults */ }
  const next = [{ protocol: draft.protocol, model: draft.model, at: nowIso() }, ...recent.filter(item => item && !(item.protocol === draft.protocol && item.model === draft.model))].slice(0, 20);
  await tx.run('INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['recentModels', JSON.stringify(next)]);
}
async function pendingIn(d: Db): Promise<boolean> {
  return Number((await d.get<{ count: number }>('SELECT COUNT(*) AS count FROM credential_cleanup'))?.count ?? 0) > 0;
}
/** Only called under coordinator; active references are checked BEFORE deletion. */
async function cleanupIn(d: Db): Promise<void> {
  const refs = await d.all<{ key_ref: string }>('SELECT key_ref FROM credential_cleanup');
  let changed = false;
  for (const { key_ref } of refs) {
    try {
      if (await d.get('SELECT id FROM model_services WHERE key_ref = ?', [key_ref])) continue;
      await secure.removeKey(key_ref);
      await d.transaction(async tx => {
        await tx.run('DELETE FROM credential_cleanup WHERE key_ref = ? AND NOT EXISTS (SELECT 1 FROM model_services WHERE key_ref = ?)', [key_ref, key_ref]);
      });
      changed = true;
    } catch { /* Keep durable registration; retry on next active/write/startup. */ }
  }
  if (changed) emit('services.changed', {});
}
async function cleanupResult(d: Db): Promise<boolean> {
  try { await cleanupIn(d); return await pendingIn(d); }
  catch { return true; } // Never report a committed business write as rolled back.
}
export async function retryPendingCleanup(): Promise<void> {
  await coordinated(() => cleanupIn(db()));
}
export async function hasPendingKeyCleanup(): Promise<boolean> {
  try { return await pendingIn(db()); } catch (error) { throw localError(error); }
}
export async function list(): Promise<ModelService[]> {
  try { return (await db().all<ServiceRow>('SELECT * FROM model_services ORDER BY is_default DESC, created_at, id')).map(toService); }
  catch (error) { throw localError(error); }
}
export async function getDefault(): Promise<ModelService | null> {
  try {
    const row = await db().get<ServiceRow>('SELECT * FROM model_services WHERE is_default = 1 LIMIT 1');
    return row ? toService(row) : null;
  } catch (error) { throw localError(error); }
}
async function missingKeyIn(d: Db, row: ServiceRow): Promise<ServiceRow> {
  const updated = await d.transaction(async tx => {
    const current = await rowIn(tx, row.id);
    if (current.key_ref !== row.key_ref) return current;
    await tx.run('UPDATE model_services SET has_key = 0, key_ref = NULL, revision = revision + 1, last_test_at = NULL, last_test_ok = NULL, last_test_message = NULL, updated_at = ? WHERE id = ?', [nowIso(), row.id]);
    return rowIn(tx, row.id);
  });
  emit('services.changed', {});
  abortRequests(row.id);
  return updated;
}
export async function get(id: ID): Promise<ServiceDetail> {
  return coordinated(async () => {
    const d = db();
    let row = await rowIn(d, id);
    let key: string | null = null;
    if (row.key_ref) {
      let available = true;
      try { key = await secure.getKey(row.key_ref); }
      catch { available = false; } // Locked is not missing; retain metadata/revision.
      if (available && key === null) row = await missingKeyIn(d, row);
    }
    const keyMask = key === null ? null : key.length > 8 ? `••••${key.slice(-4)}` : '••••';
    return { ...toService(row), keyMask, revision: Number(row.revision) };
  });
}
export async function revealKey(id: ID): Promise<string> {
  return coordinated(async () => {
    const d = db();
    const row = await rowIn(d, id);
    if (!row.key_ref) throw new AppError('KEY_UNAVAILABLE', t.missingKey);
    const value = await secure.getKey(row.key_ref);
    if (value === null) {
      await missingKeyIn(d, row);
      throw new AppError('KEY_UNAVAILABLE', t.missingKey);
    }
    return value;
  });
}

export async function save(input: ServiceDraft, key?: string, testResult?: TestResult): Promise<{ service: ModelService; keyCleanupPending: boolean }> {
  // Capture and copy before the asynchronous lock wait; UI may edit its draft.
  const draft = validateDraft(input);
  const replacement = normalizeKey(key);
  return coordinated(async () => {
    const d = db();
    const old = draft.id ? await rowIn(d, draft.id) : undefined;
    if (old) checkRevision(old, draft);
    if (old) abortRequests(old.id);
    const tested = matchingResult(testResult, draft, replacement, old);
    if (!replacement && !old?.key_ref) throw validation('key', t.validation.keyRequired);
    if (!draft.id && draft.revision != null) throw validation('revision', t.changed);
    // Validate duplicate before preparing a slot, then check again on commit.
    await nameIn(d, draft);
    const id = old?.id ?? uuid();
    const keyRef = replacement ? uuid() : old!.key_ref;
    if (replacement) {
      await d.transaction(async tx => { await tx.run('INSERT INTO credential_cleanup (key_ref) VALUES (?)', [keyRef]); });
      await secure.setKey(keyRef!, replacement);
      if ((await secure.getKey(keyRef!)) !== replacement) throw new AppError('KEY_UNAVAILABLE', t.keyUnavailable);
    }
    const service = await d.transaction(async tx => {
      const current = old ? await rowIn(tx, id) : undefined;
      if (current) checkRevision(current, draft);
      const name = await nameIn(tx, draft);
      const now = nowIso();
      const oldOptions = current ? optionsFrom(current) : undefined;
      const changed = !current || current.protocol !== draft.protocol || current.base_url !== draft.baseUrl || current.model !== draft.model || oldOptions?.authHeader !== draft.options.authHeader || !!replacement;
      // A connection change invalidates prior evidence before a matching
      // page-scoped result contributes its newly observed capability patch.
      const clearCaps = !!current && (current.protocol !== draft.protocol || current.base_url !== draft.baseUrl || current.model !== draft.model);
      const options = { ...draft.options, caps: { ...(clearCaps ? {} : draft.options.caps), ...tested?.capsPatch } };
      const lastAt = tested?.at ?? (changed ? null : current?.last_test_at ?? null);
      const lastOk = tested ? (tested.ok ? 1 : 0) : (changed ? null : current?.last_test_ok ?? null);
      const lastMessage = tested ? (tested.ok ? t.tested : tested.error!.message) : (changed ? null : current?.last_test_message ?? null);
      if (current) {
        await tx.run('UPDATE model_services SET name = ?, protocol = ?, base_url = ?, model = ?, options = ?, has_key = ?, key_ref = ?, revision = revision + 1, last_test_at = ?, last_test_ok = ?, last_test_message = ?, updated_at = ? WHERE id = ?', [name, draft.protocol, draft.baseUrl, draft.model, JSON.stringify(options), keyRef ? 1 : 0, keyRef, lastAt, lastOk, lastMessage, now, id]);
      } else {
        const isDefault = (await tx.get('SELECT id FROM model_services LIMIT 1')) ? 0 : 1;
        await tx.run('INSERT INTO model_services (id, name, protocol, base_url, model, options, is_default, has_key, key_ref, revision, last_test_at, last_test_ok, last_test_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?, ?, ?, ?)', [id, name, draft.protocol, draft.baseUrl, draft.model, JSON.stringify(options), isDefault, keyRef, lastAt, lastOk, lastMessage, now, now]);
      }
      if (replacement) {
        await tx.run('DELETE FROM credential_cleanup WHERE key_ref = ?', [keyRef]);
        if (current?.key_ref) await tx.run('INSERT OR IGNORE INTO credential_cleanup (key_ref) VALUES (?)', [current.key_ref]);
      }
      await recentIn(tx, draft);
      return toService(await rowIn(tx, id));
    });
    emit('services.changed', {});
    emit('prefs.changed', { key: 'recentModels' });
    return { service, keyCleanupPending: await cleanupResult(d) };
  });
}
export async function remove(id: ID): Promise<{ keyCleanupPending: boolean }> {
  return coordinated(async () => {
    const d = db();
    abortRequests(id);
    await d.transaction(async tx => {
      const row = await rowIn(tx, id);
      await tx.run('DELETE FROM model_services WHERE id = ?', [id]);
      if (row.key_ref) await tx.run('INSERT OR IGNORE INTO credential_cleanup (key_ref) VALUES (?)', [row.key_ref]);
      if (Number(row.is_default) === 1) {
        const next = await tx.get<{ id: string }>('SELECT id FROM model_services ORDER BY created_at, id LIMIT 1');
        if (next) await tx.run('UPDATE model_services SET is_default = 1 WHERE id = ?', [next.id]);
      }
    });
    emit('services.changed', {});
    return { keyCleanupPending: await cleanupResult(d) };
  });
}
export async function setDefault(id: ID): Promise<void> {
  await coordinated(async () => {
    const d = db();
    await d.transaction(async tx => {
      await rowIn(tx, id);
      await tx.run('UPDATE model_services SET is_default = 0 WHERE is_default = 1');
      await tx.run('UPDATE model_services SET is_default = 1 WHERE id = ?', [id]);
    });
    emit('services.changed', {});
    await cleanupResult(d);
  });
}

interface RequestOptions { signal: AbortSignal }
export interface TestOptions extends RequestOptions {
  persist?: boolean;
  onRetry?: (attempt: 1 | 2, delayMs: number) => void;
}
function sameSavedDraft(draft: ServiceDraft, saved: ServiceDraft): boolean {
  return sameConnection(draft, saved) && draft.name === saved.name &&
    (['maxOutputTokens', 'effort', 'store', 'contextBudget'] as const).every(field => draft.options[field] === saved.options[field]) &&
    (['effort', 'streaming', 'jsonSchema'] as const).every(field => draft.options.caps[field] === saved.options.caps[field]);
}
/** The configuration and saved Key are captured under the same short lock. */
async function capture(draft: ServiceDraft, replacement: string | undefined, signal: AbortSignal, persist = false) {
  return coordinated(async () => {
    if (signal.aborted) throw cancelled();
    const d = db();
    const row = draft.id ? await rowIn(d, draft.id) : undefined;
    if (row) checkRevision(row, draft);
    if (persist && (!row || replacement !== undefined || !sameSavedDraft(draft, toService(row)))) throw new AppError('CONFLICT_STATE', t.changed);
    let secret = replacement;
    if (secret === undefined) {
      if (!row?.key_ref) throw new AppError('KEY_UNAVAILABLE', t.missingKey);
      const value = await secure.getKey(row.key_ref);
      if (value === null) {
        await missingKeyIn(d, row);
        throw new AppError('KEY_UNAVAILABLE', t.missingKey);
      }
      secret = value;
    }
    if (signal.aborted) throw cancelled();
    return { secret, keyRef: row?.key_ref ?? null };
  });
}
function copyResult(result: TestResult): TestResult {
  return { ...result, models: result.models && [...result.models], capsPatch: { ...result.capsPatch }, error: result.error && { ...result.error } };
}
function contextFor(draft: ServiceDraft, secret: string) {
  return { ...draft, serviceName: draft.name, sensitiveValues: [secret] };
}

export async function fetchModels(input: ServiceDraft, key: string | undefined, options: RequestOptions): Promise<string[]> {
  const draft = validateDraft(input, false);
  const replacement = normalizeKey(key);
  const owner = ownRequest(draft.id, options.signal);
  try {
    const { secret } = await capture(draft, replacement, owner.controller.signal);
    try {
      const models = await createProvider(draft, secret).listModels({ signal: owner.controller.signal });
      if (owner.controller.signal.aborted) throw cancelled();
      return models;
    } catch (error) {
      if (owner.controller.signal.aborted || isAppError(error, 'AI_CANCELLED') || (error instanceof ProviderFailure && error.info.code === 'AI_CANCELLED')) throw cancelled();
      throw new AiCallError(error instanceof ProviderFailure ? error.info : aiFailure('AI_NETWORK', contextFor(draft, secret)).info);
    }
  } finally { owner.release(); }
}

export async function test(input: ServiceDraft, key: string | undefined, options: TestOptions): Promise<TestResult> {
  const draft = validateDraft(input);
  const replacement = normalizeKey(key);
  if (options.persist && key !== undefined) throw new AppError('CONFLICT_STATE', t.changed);
  if (options.signal.aborted) throw cancelled();
  // Reserve immediately; exceeding capacity never waits for the coordinator.
  if (activeTests >= 3) throw new AppError('CONFLICT_STATE', t.testBusy);
  activeTests++;
  const owner = ownRequest(draft.id, options.signal);
  const sequence = Symbol();
  try {
    const { secret, keyRef } = await capture(draft, replacement, owner.controller.signal, options.persist);
    if (draft.id) latestTests.set(draft.id, sequence);
    const attemptLedger = await connectionTestLedger(draft);
    const result = await testConnection(draft, secret, {
      attempts: attemptLedger,
      signal: owner.controller.signal,
      onRetry: (attempt, delay) => { if (!owner.controller.signal.aborted) options.onRetry?.(attempt, delay); },
    });
    if (options.persist) {
      await coordinated(async () => {
        const d = db();
        await d.transaction(async tx => {
          const row = await rowIn(tx, draft.id!);
          checkRevision(row, draft);
          if (latestTests.get(row.id) !== sequence) throw new AppError('CONFLICT_STATE', t.changed);
          if (owner.controller.signal.aborted || result.error?.code === 'AI_CANCELLED') throw cancelled();
          await tx.run('UPDATE model_services SET last_test_at = ?, last_test_ok = ?, last_test_message = ? WHERE id = ?', [result.at, result.ok ? 1 : 0, result.ok ? t.tested : result.error!.message, row.id]);
        });
        emit('services.changed', {});
      });
    } else if (owner.controller.signal.aborted || result.error?.code === 'AI_CANCELLED') throw cancelled();
    const returned = copyResult(result);
    associations.set(returned, { draft, key: replacement, keyRef, signal: options.signal, result: copyResult(result) });
    return returned;
  } finally {
    if (draft.id && latestTests.get(draft.id) === sequence) latestTests.delete(draft.id);
    activeTests--;
    owner.release();
  }
}

/** Business requests use one consistent configuration/Key snapshot. No secret escapes this closure. */
export async function withGeneration<T>(
  serviceId: ID,
  revision: number,
  signal: AbortSignal,
  run: (scope: {
    service: ModelService;
    signal: AbortSignal;
    providerFactory: (evidence: import('../ai/providers/httpProvider').AttemptEvidence, deadline: number) => import('../ai/providers/types').Provider;
  }) => Promise<T>,
): Promise<T> {
  const owner = ownRequest(serviceId, signal);
  try {
    const snapshot = await coordinated(async () => {
      if (owner.controller.signal.aborted) throw cancelled();
      const row = await rowIn(db(), serviceId);
      if (Number(row.revision) !== revision) throw new AppError('AI_RESULT_STALE', '模型服务已变化，请重新预览。');
      if (!row.key_ref) throw new AppError('KEY_UNAVAILABLE', t.missingKey);
      const secret = await secure.getKey(row.key_ref);
      if (secret === null) {
        await missingKeyIn(db(), row);
        throw new AppError('KEY_UNAVAILABLE', t.missingKey);
      }
      if (owner.controller.signal.aborted) throw cancelled();
      return { service: toService(row), secret };
    });
    return await run({
      service: snapshot.service,
      signal: owner.controller.signal,
      providerFactory: (evidence, deadline) => createProvider(snapshot.service, snapshot.secret, { evidence, deadline }),
    });
  } finally { owner.release(); }
}
