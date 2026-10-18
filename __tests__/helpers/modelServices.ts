/** Model service screen test helpers: in-memory secure store, held network calls and form access. */
import { act, type ReactTestRenderer } from 'react-test-renderer';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { setDb, type Db } from '../../src/data/db';
import { DEFAULT_OPTIONS, type ServiceDraft, type TestResult } from '../../src/features/modelServices';
import { setSecureDriver, type SecureDriver } from '../../src/secure';
import { allText } from './render';

export const temporaryKey = () => `invalid-${globalThis.crypto.randomUUID()}`;

export async function setupDb(): Promise<Db> {
  const d = openMemoryDb();
  await migrate(d);
  setDb(d);
  return d;
}

export function installSecure(): { slots: Map<string, string>; driver: jest.Mocked<SecureDriver> } {
  const slots = new Map<string, string>();
  const driver: jest.Mocked<SecureDriver> = {
    setKey: jest.fn(async (ref, key) => { slots.set(ref, key); }),
    getKey: jest.fn(async ref => slots.get(ref) ?? null),
    removeKey: jest.fn(async ref => { slots.delete(ref); }),
  };
  setSecureDriver(driver);
  return { slots, driver };
}

export const draft = (patch: Partial<ServiceDraft> = {}): ServiceDraft => ({
  name: '', protocol: 'openai_responses', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna',
  options: { ...DEFAULT_OPTIONS, caps: {} }, ...patch,
});

export const result = (patch: Partial<TestResult> = {}): TestResult => ({
  ok: true, at: '2026-10-18T01:00:00.000Z', latencyMs: 1234, models: ['gpt-6-luna'],
  modelCount: 1, modelListed: true, responseModel: 'gpt-6-luna', streaming: true,
  capsPatch: { streaming: true }, error: null, ...patch,
});

/** A network call the test settles by hand; records the abort signal it ran with. */
export function held<T>() {
  let signal: AbortSignal | undefined;
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  return {
    get signal() { return signal; },
    run(next: AbortSignal): Promise<T> {
      signal = next;
      // Ignores abort on purpose: the page must discard late results itself.
      return new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    },
    finish: (value: T) => act(async () => { resolve(value); }),
    fail: (error: unknown) => act(async () => { reject(error); }),
  };
}

export function input(r: ReactTestRenderer, label: string) {
  const found = r.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
  if (!found.length) { throw new Error(`no input "${label}"; screen text:\n${allText(r)}`); }
  return found[found.length - 1];
}

export async function fill(r: ReactTestRenderer, label: string, text: string) {
  const node = input(r, label);
  await act(async () => { node.props.onChangeText(text); });
}

export async function blur(r: ReactTestRenderer, label: string) {
  const node = input(r, label);
  await act(async () => { node.props.onBlur?.({}); });
}
