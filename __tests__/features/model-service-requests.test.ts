import { setDb, type Db } from '../../src/data/db';
import * as services from '../../src/features/modelServices';
import type { ServiceDraft } from '../../src/features/modelServices';
import { AppError } from '../../src/features/errors';
import { on } from '../../src/features/events';
import { setSecureDriver, type SecureDriver } from '../../src/secure';
import { testConnection } from '../../src/ai/providers/connectionTest';
import { createProvider } from '../../src/ai/providers/httpProvider';
import type { TestResult } from '../../src/ai/providers/types';
import { aiFailure } from '../../src/ai/providers/errors';
import { freshDb, tickingClock } from '../helpers/db';

jest.mock('../../src/ai/providers/connectionTest', () => ({ testConnection: jest.fn() }));
jest.mock('../../src/ai/providers/httpProvider', () => ({ createProvider: jest.fn() }));

let database: Db;
let slots: Map<string, string>;
let secure: jest.Mocked<SecureDriver>;
const testConnectionMock = jest.mocked(testConnection);
const createProviderMock = jest.mocked(createProvider);
const modelListMock = jest.fn<Promise<string[]>, [{ signal: AbortSignal }]>();
const pendingCleanups = new Set<() => void>();
const temporaryKey = () => `invalid-${globalThis.crypto.randomUUID()}`;
const draft = (patch: Partial<ServiceDraft> = {}): ServiceDraft => ({
  name: '请求测试服务', protocol: 'openai_responses', baseUrl: 'https://example.invalid/v1', model: 'test-model',
  options: { ...services.DEFAULT_OPTIONS, caps: {} }, ...patch,
});
const result = (patch: Partial<TestResult> = {}): TestResult => ({
  ok: true, at: '2026-10-18T01:00:00.000Z', latencyMs: 100, models: ['test-model'],
  modelCount: 1, modelListed: true, responseModel: 'test-model', streaming: true,
  capsPatch: { streaming: true }, error: null, ...patch,
});
const options = (signal = new AbortController().signal) => ({ signal });
async function editing(id: string, patch: Partial<ServiceDraft> = {}): Promise<ServiceDraft> {
  return { ...await services.get(id), ...patch };
}
async function stored(id: string) {
  return database.get<{ revision: number; has_key: number; key_ref: string | null; options: string; last_test_at: string | null; last_test_ok: number | null; last_test_message: string | null }>(
    'SELECT revision, has_key, key_ref, options, last_test_at, last_test_ok, last_test_message FROM model_services WHERE id = ?', [id],
  );
}
async function flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); }
function outcome<T>(promise: Promise<T>) { return promise.then(value => ({ value, error: undefined }), error => ({ value: undefined, error })); }

/** Network can deliberately ignore abort to exercise stale-result guards. */
function deferredNetwork<T>(ignoreAbort = false) {
  let signal: AbortSignal | undefined;
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  let settled = false;
  let started = false;
  const finish = (value: T) => { if (!settled) { settled = true; release(); resolve(value); } };
  const fail = (error: unknown) => { if (!settled) { settled = true; release(); reject(error); } };
  const cancel = () => { if (!ignoreAbort) fail(new AppError('AI_CANCELLED', '取消')); };
  const cleanup = () => { if (started) fail(new AppError('AI_CANCELLED', '取消')); };
  const release = () => { signal?.removeEventListener('abort', cancel); pendingCleanups.delete(cleanup); };
  return {
    get signal() { return signal; },
    finish, fail,
    run(nextSignal: AbortSignal): Promise<T> {
      started = true; signal = nextSignal;
      pendingCleanups.add(cleanup);
      return new Promise<T>((yes, no) => {
        resolve = yes; reject = no;
        nextSignal.addEventListener('abort', cancel);
        if (nextSignal.aborted) cancel();
      });
    },
  };
}
function holdTest(ignoreAbort = false) {
  const pending = deferredNetwork<TestResult>(ignoreAbort);
  testConnectionMock.mockImplementationOnce((_draft, _key, settings) => pending.run(settings.signal));
  return pending;
}
function holdList(ignoreAbort = false) {
  const pending = deferredNetwork<string[]>(ignoreAbort);
  modelListMock.mockImplementationOnce(settings => pending.run(settings.signal));
  return pending;
}

beforeEach(async () => {
  tickingClock(); database = await freshDb(); slots = new Map();
  secure = {
    setKey: jest.fn(async (ref, key) => { slots.set(ref, key); }),
    getKey: jest.fn(async ref => slots.get(ref) ?? null),
    removeKey: jest.fn(async ref => { slots.delete(ref); }),
  };
  setSecureDriver(secure);
  testConnectionMock.mockReset(); testConnectionMock.mockImplementation(async () => result());
  modelListMock.mockReset(); modelListMock.mockResolvedValue(['test-model']);
  createProviderMock.mockReset(); createProviderMock.mockImplementation(() => ({
    listModels: modelListMock,
    generate: jest.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
  }));
});
afterEach(async () => {
  for (const cleanup of [...pendingCleanups]) cleanup();
  await flush();
  setSecureDriver(undefined); setDb(null); await database.close();
});

it.each(['test', 'fetchModels'] as const)('rejects stale revisions before %s reads any saved Key or starts network', async operation => {
  const first = (await services.save(draft(), temporaryKey())).service;
  const stale = await editing(first.id);
  await services.save({ ...stale, name: '新名称' });
  secure.getKey.mockClear();
  await expect(services[operation](stale, undefined, options())).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  expect(secure.getKey).not.toHaveBeenCalled();
  expect(testConnectionMock).not.toHaveBeenCalled(); expect(createProviderMock).not.toHaveBeenCalled();
});

it('tests a saved draft without writing lastTest/caps, preferences or events, and forwards retry notifications', async () => {
  const key = temporaryKey(); const saved = (await services.save(draft(), key)).service;
  const edit = await editing(saved.id); const before = await stored(saved.id);
  const recent = await database.all('SELECT * FROM preferences'); const changed = jest.fn(); on('services.changed', changed);
  const onRetry = jest.fn();
  testConnectionMock.mockImplementationOnce(async (_source, _key, settings) => { settings.onRetry?.(1, 50); return result(); });
  const tested = await services.test(edit, undefined, { ...options(), onRetry });
  expect(tested).toMatchObject({ ok: true, capsPatch: { streaming: true } });
  expect(testConnectionMock.mock.calls[0][1]).toBe(key); expect(onRetry).toHaveBeenCalledWith(1, 50);
  expect(await stored(saved.id)).toEqual(before); expect(await database.all('SELECT * FROM preferences')).toEqual(recent);
  expect(changed).not.toHaveBeenCalled();
});

it('tests a new draft and fetches models without requiring a model or storing credentials', async () => {
  const key = temporaryKey(); const input = draft();
  expect(await services.test(input, key, options())).toMatchObject({ ok: true });
  expect(await services.fetchModels({ ...input, model: '' }, key, options())).toEqual(['test-model']);
  expect(await services.list()).toEqual([]); expect(slots.size).toBe(0);
  expect(secure.setKey).not.toHaveBeenCalled(); expect(secure.getKey).not.toHaveBeenCalled();
  expect(createProviderMock.mock.calls[0][1]).toBe(key);
});

it('saves matching test output and capability evidence in the same configuration write', async () => {
  const input = draft(); const key = temporaryKey();
  const tested = await services.test(input, key, options());
  const saved = (await services.save(input, key, tested)).service;
  expect(saved.lastTest).toMatchObject({ at: tested.at, ok: true });
  expect(saved.options.caps).toEqual({ streaming: true });
  const row = await stored(saved.id); expect(row?.revision).toBe(1);
  expect(row?.last_test_at).toBe(tested.at); expect(row?.last_test_ok).toBe(1);
});

it('ignores cloned or invented test results instead of accepting caller-supplied capability claims', async () => {
  const input = draft(); const key = temporaryKey(); const tested = await services.test(input, key, options());
  const cloned = { ...tested, capsPatch: { jsonSchema: true } };
  const saved = (await services.save(input, key, cloned)).service;
  expect(saved.lastTest).toBeNull(); expect(saved.options.caps).toEqual({});
  const next = await editing(saved.id, { name: '手工拼装' });
  const invented = result({ ok: false, capsPatch: { effort: false } });
  const updated = (await services.save(next, undefined, invented)).service;
  expect(updated.lastTest).toBeNull(); expect(updated.options.caps).toEqual({});
});

it('does not trust mutations of a returned TestResult object or its nested capability patch', async () => {
  const input = draft(); const key = temporaryKey(); const tested = await services.test(input, key, options());
  tested.ok = false; tested.at = '2099-01-01T00:00:00.000Z'; tested.capsPatch.streaming = false; tested.capsPatch.jsonSchema = true;
  const saved = (await services.save(input, key, tested)).service;
  expect(saved.lastTest).toMatchObject({ ok: true, at: '2026-10-18T01:00:00.000Z' });
  expect(saved.options.caps).toEqual({ streaming: true });
});

it('discards the page-scoped result association after its owning signal is aborted', async () => {
  const external = new AbortController(); const input = draft(); const key = temporaryKey();
  const tested = await services.test(input, key, options(external.signal));
  external.abort();
  const saved = (await services.save(input, key, tested)).service;
  expect(saved.lastTest).toBeNull(); expect(saved.options.caps).toEqual({});
});

it.each(['baseUrl', 'model', 'protocol', 'authHeader', 'key'] as const)('ignores a test result when its captured connection %s changes', async field => {
  const key = temporaryKey(); const input = draft(); const tested = await services.test(input, key, options());
  const changed = { ...input, options: { ...input.options } };
  if (field === 'baseUrl') changed.baseUrl = 'https://other.invalid/v1';
  if (field === 'model') changed.model = 'new-model';
  if (field === 'protocol') changed.protocol = 'anthropic_messages';
  if (field === 'authHeader') changed.options.authHeader = 'bearer';
  const saved = (await services.save(changed, field === 'key' ? temporaryKey() : key, tested)).service;
  expect(saved.lastTest).toBeNull(); expect(saved.options.caps).toEqual({});
});

it('retains the result across name and non-connection option edits, with normalized URL and Key identity', async () => {
  const key = temporaryKey(); const input = draft({ baseUrl: 'https://example.invalid/v1/' });
  const tested = await services.test(input, `Bearer ${key}`, options());
  const changed = { ...input, name: '修改名称', baseUrl: 'https://example.invalid/v1', options: { ...input.options, maxOutputTokens: 128, effort: 'high' as const, store: true, contextBudget: 30000 } };
  const saved = (await services.save(changed, key, tested)).service;
  expect(saved.lastTest).toMatchObject({ ok: true, at: tested.at }); expect(saved.options.caps).toEqual({ streaming: true });
});

it('clears prior status and old capability evidence on a saved connection change without a new matching result', async () => {
  const input = draft(); const key = temporaryKey(); const tested = await services.test(input, key, options());
  const original = (await services.save(input, key, tested)).service;
  const edit = await editing(original.id, { model: 'new-model' });
  const changed = (await services.save(edit, undefined, tested)).service;
  expect(changed.lastTest).toBeNull(); expect(changed.options.caps).toEqual({});
});

it('persist updates only lastTest and emits after its write, without changing revision or capabilities', async () => {
  const key = temporaryKey(); const saved = (await services.save(draft({ options: { ...services.DEFAULT_OPTIONS, caps: { effort: false, streaming: false } } }), key)).service;
  const edit = await editing(saved.id); const before = await stored(saved.id);
  const observed: Promise<unknown>[] = [];
  on('services.changed', () => { observed.push(stored(saved.id)); });
  const tested = await services.test(edit, undefined, { ...options(), persist: true });
  const after = await stored(saved.id);
  expect(after).toMatchObject({ revision: before!.revision, options: before!.options, last_test_at: tested.at, last_test_ok: 1 });
  expect((await Promise.all(observed))).toHaveLength(1);
  expect((await Promise.all(observed))[0]).toMatchObject({ last_test_at: tested.at });
});

it('persists a normal network failure result as lastTest without changing capabilities', async () => {
  const saved = (await services.save(draft(), temporaryKey())).service; const edit = await editing(saved.id);
  const failure = aiFailure('AI_AUTH', { ...edit, serviceName: edit.name }).info;
  testConnectionMock.mockResolvedValueOnce(result({ ok: false, capsPatch: {}, streaming: null, error: failure }));
  const tested = await services.test(edit, undefined, { ...options(), persist: true });
  expect(tested.ok).toBe(false);
  expect(await stored(saved.id)).toMatchObject({ revision: edit.revision, last_test_at: tested.at, last_test_ok: 0, last_test_message: failure.message });
  expect((await services.get(saved.id)).options.caps).toEqual({});
});

it('fetchModels exposes a safe AiCallError and does not store network failure metadata', async () => {
  const saved = (await services.save(draft(), temporaryKey())).service; const edit = await editing(saved.id);
  const before = await stored(saved.id); const failure = aiFailure('AI_AUTH', { ...edit, serviceName: edit.name });
  modelListMock.mockRejectedValueOnce(failure);
  await expect(services.fetchModels(edit, undefined, options())).rejects.toMatchObject({ code: 'AI_AUTH', info: { code: 'AI_AUTH' } });
  expect(await stored(saved.id)).toEqual(before);
});

it('does not persist failure metadata for cancellation or an unavailable Key', async () => {
  const saved = (await services.save(draft(), temporaryKey())).service; const edit = await editing(saved.id);
  const before = await stored(saved.id); const changed = jest.fn(); on('services.changed', changed);
  const network = holdTest(); const external = new AbortController();
  const testing = outcome(services.test(edit, undefined, { signal: external.signal, persist: true })); await flush(); external.abort();
  expect(network.signal?.aborted).toBe(true); expect(await testing).toMatchObject({ error: { code: 'AI_CANCELLED' } });
  expect(await stored(saved.id)).toEqual(before);
  secure.getKey.mockRejectedValueOnce(new Error('device locked'));
  await expect(services.test(edit, undefined, { ...options(), persist: true })).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
  expect(await stored(saved.id)).toEqual(before); expect(changed).not.toHaveBeenCalled();
});

it.each(['replacement', 'changedDraft', 'newDraft'] as const)('rejects persist for %s before sending a request', async mode => {
  const saved = (await services.save(draft(), temporaryKey())).service;
  const edit = await editing(saved.id);
  const candidate = mode === 'newDraft' ? draft({ name: '未保存' }) : mode === 'changedDraft' ? { ...edit, model: 'different' } : edit;
  await expect(services.test(candidate, mode === 'replacement' || mode === 'newDraft' ? temporaryKey() : undefined, { ...options(), persist: true })).rejects.toBeInstanceOf(AppError);
  expect(testConnectionMock).not.toHaveBeenCalled();
});

it('lets only the newest per-service persisted test write, even when old network ignores cancellation', async () => {
  const saved = (await services.save(draft(), temporaryKey())).service; const edit = await editing(saved.id);
  const old = holdTest(true); const current = holdTest(true);
  const older = outcome(services.test(edit, undefined, { ...options(), persist: true })); await flush();
  const newer = outcome(services.test(edit, undefined, { ...options(), persist: true })); await flush();
  const latest = result({ at: '2026-10-18T02:00:00.000Z' }); current.finish(latest);
  expect(await newer).toMatchObject({ value: { at: latest.at } });
  const changed = jest.fn(); on('services.changed', changed);
  old.finish(result({ at: '2026-10-18T01:00:00.000Z' }));
  expect(await older).toMatchObject({ error: { code: 'CONFLICT_STATE' } });
  expect((await stored(saved.id))?.last_test_at).toBe(latest.at); expect(changed).not.toHaveBeenCalled();
});

it('does not revive a deleted service when a persisted test returns late', async () => {
  const saved = (await services.save(draft(), temporaryKey())).service; const edit = await editing(saved.id);
  const network = holdTest(true); const testing = outcome(services.test(edit, undefined, { ...options(), persist: true })); await flush();
  await services.remove(saved.id); expect(network.signal?.aborted).toBe(true);
  const changed = jest.fn(); on('services.changed', changed); network.finish(result());
  expect(await testing).toMatchObject({ error: { code: 'NOT_FOUND' } });
  expect(await services.list()).toEqual([]); expect(changed).not.toHaveBeenCalled();
});

it('admits three tests and rejects a fourth without queuing network work, then releases capacity on cancellation', async () => {
  const edits: ServiceDraft[] = [];
  for (let i = 0; i < 4; i++) edits.push(await editing((await services.save(draft({ name: `服务-${i}` }), temporaryKey())).service.id));
  const held = [holdTest(), holdTest(), holdTest()]; const controllers = held.map(() => new AbortController());
  const running = edits.slice(0, 3).map((edit, index) => outcome(services.test(edit, undefined, options(controllers[index].signal))));
  await flush(); expect(testConnectionMock).toHaveBeenCalledTimes(3);
  await expect(services.test(edits[3], undefined, options())).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  expect(testConnectionMock).toHaveBeenCalledTimes(3);
  controllers[0].abort(); expect(await running[0]).toMatchObject({ error: { code: 'AI_CANCELLED' } });
  expect(await services.test(edits[3], undefined, options())).toMatchObject({ ok: true }); expect(testConnectionMock).toHaveBeenCalledTimes(4);
  controllers[1].abort(); controllers[2].abort(); await Promise.all(running);
});

it.each(['save', 'remove'] as const)('%s aborts both test and model-list requests for that service', async action => {
  const saved = (await services.save(draft(), temporaryKey())).service; const edit = await editing(saved.id);
  const test = holdTest(); const list = holdList();
  const testing = outcome(services.test(edit, undefined, options()));
  const listing = outcome(services.fetchModels(edit, undefined, options())); await flush();
  expect(test.signal?.aborted).toBe(false); expect(list.signal?.aborted).toBe(false);
  if (action === 'save') await services.save({ ...edit, name: '保存更新' });
  else await services.remove(saved.id);
  expect(test.signal?.aborted).toBe(true); expect(list.signal?.aborted).toBe(true);
  expect(await testing).toMatchObject({ error: { code: 'AI_CANCELLED' } });
  expect(await listing).toMatchObject({ error: { code: 'AI_CANCELLED' } });
});

it('does not abort captured test or list requests when the default service changes', async () => {
  const saved = (await services.save(draft(), temporaryKey())).service; const edit = await editing(saved.id);
  const second = (await services.save(draft({ name: '第二个' }), temporaryKey())).service;
  const test = holdTest(); const list = holdList();
  const testing = outcome(services.test(edit, undefined, options())); const listing = outcome(services.fetchModels(edit, undefined, options())); await flush();
  await services.setDefault(second.id);
  expect(test.signal?.aborted).toBe(false); expect(list.signal?.aborted).toBe(false);
  test.finish(result()); list.finish(['test-model']);
  expect(await testing).toMatchObject({ value: { ok: true } }); expect(await listing).toEqual({ value: ['test-model'], error: undefined });
});

it('keeps active requests while locked, but cancels them when the stored slot is confirmed missing', async () => {
  const saved = (await services.save(draft(), temporaryKey())).service; const edit = await editing(saved.id);
  const test = holdTest(); const list = holdList();
  const testing = outcome(services.test(edit, undefined, options())); const listing = outcome(services.fetchModels(edit, undefined, options())); await flush();
  secure.getKey.mockRejectedValueOnce(new Error('device locked'));
  expect(await services.get(saved.id)).toMatchObject({ hasKey: true, revision: edit.revision, keyMask: null });
  expect(test.signal?.aborted).toBe(false); expect(list.signal?.aborted).toBe(false);
  slots.clear();
  expect(await services.get(saved.id)).toMatchObject({ hasKey: false, revision: edit.revision! + 1 });
  expect(test.signal?.aborted).toBe(true); expect(list.signal?.aborted).toBe(true);
  expect(await testing).toMatchObject({ error: { code: 'AI_CANCELLED' } });
  expect(await listing).toMatchObject({ error: { code: 'AI_CANCELLED' } });
});

it.each(['test', 'fetchModels'] as const)('%s distinguishes a locked Key from a confirmed missing slot', async operation => {
  const saved = (await services.save(draft(), temporaryKey())).service; const edit = await editing(saved.id); const before = await stored(saved.id);
  secure.getKey.mockRejectedValueOnce(new Error('device locked'));
  await expect(services[operation](edit, undefined, options())).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
  expect(await stored(saved.id)).toEqual(before);
  slots.clear();
  await expect(services[operation](edit, undefined, options())).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
  expect(await stored(saved.id)).toMatchObject({ revision: before!.revision + 1, has_key: 0, key_ref: null, last_test_at: null });
  expect(testConnectionMock).not.toHaveBeenCalled(); expect(createProviderMock).not.toHaveBeenCalled();
});
