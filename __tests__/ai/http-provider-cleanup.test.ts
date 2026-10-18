import { AppState, type AppStateStatus } from 'react-native';
import { randomBytes } from 'crypto';
import { createProvider } from '../../src/ai/providers/httpProvider';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { TransportFailure, type HttpEvent, type HttpRequest, type HttpTransport } from '../../src/ai/transport/native';
import type { GenerateRequest } from '../../src/ai/providers/types';

const instant = Date.parse('2026-10-18T00:00:00Z');
const temporaryKey = () => `invalid-test-${randomBytes(24).toString('hex')}`;
const source = { name: '受控服务', protocol: 'openai_responses' as const, baseUrl: 'https://models.example.com/v1', model: 'test-model', options: { ...DEFAULT_OPTIONS, caps: {} } };
const request = (signal: AbortSignal): GenerateRequest => ({ system: '', messages: [{ role: 'user', content: 'ping' }], maxOutputTokens: 64, stream: true, signal });
const headers = (contentType = 'text/event-stream'): HttpEvent => ({ type: 'headers', status: 200, headers: { 'content-type': contentType } });
const data = (text: string): HttpEvent => ({ type: 'data', text, bytes: Buffer.byteLength(text) });
const done = () => data('data: {"type":"response.completed","response":{"status":"completed","model":"test-model","output":[]}}\n\n');
const text = () => data('data: {"type":"response.output_text.delta","delta":"正文"}\n\n');
const json = () => data('{"status":"completed","model":"test-model","output":[{"type":"message","content":[{"type":"output_text","text":"正文"}]}]}');
async function flush() { for (let i = 0; i < 30; i++) { await Promise.resolve(); } }

interface ControlledCall {
  request: HttpRequest;
  send(event: HttpEvent): void;
  end(): void;
  released: number;
  subscribed: boolean;
}

/** An async generator paused at yield retains its subscription until return is called. */
function controlledTransport() {
  const calls: ControlledCall[] = [];
  const transport: HttpTransport = physical => {
    const queue: (HttpEvent | null)[] = [];
    let wake: (() => void) | undefined;
    const notify = () => { wake?.(); wake = undefined; };
    const call: ControlledCall = {
      request: physical, released: 0, subscribed: false,
      send(event) { queue.push(event); notify(); },
      end() { queue.push(null); notify(); },
    };
    calls.push(call);
    return {
      async *[Symbol.asyncIterator]() {
        physical.signal.addEventListener('abort', notify);
        call.subscribed = true;
        try {
          for (;;) {
            if (physical.signal.aborted) { throw new TransportFailure('cancelled'); }
            if (queue.length === 0) { await new Promise<void>(resolve => { wake = resolve; }); continue; }
            const event = queue.shift();
            if (event === null) { return; }
            yield event!;
          }
        } finally {
          physical.signal.removeEventListener('abort', notify);
          call.subscribed = false;
          call.released++;
        }
      },
    };
  };
  return { transport, calls };
}

let activeListeners: Set<(state: AppStateStatus) => void>;
let removals: jest.Mock[];
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(instant);
  activeListeners = new Set(); removals = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    activeListeners.add(listener);
    const remove = jest.fn(() => activeListeners.delete(listener));
    removals.push(remove);
    return { remove };
  });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
function expectOwnerReleased() {
  expect(jest.getTimerCount()).toBe(0);
  expect(activeListeners.size).toBe(0);
  for (const remove of removals) { expect(remove).toHaveBeenCalledTimes(1); }
}

it.each(['throws', 'rejects', 'never resolves'] as const)('delivers a winning done without awaiting transport return which %s', async cleanup => {
  const returned = jest.fn((): Promise<IteratorResult<HttpEvent>> => {
    if (cleanup === 'throws') { throw new Error('synthetic cleanup failure'); }
    if (cleanup === 'rejects') { return Promise.reject(new Error('synthetic cleanup failure')); }
    return new Promise(() => {});
  });
  const queue = [headers(), done()];
  let physical: HttpRequest | undefined;
  const transport: HttpTransport = input => {
    physical = input;
    return { [Symbol.asyncIterator]: () => ({
      next: async () => queue.length ? { value: queue.shift()!, done: false } : { value: undefined, done: true },
      return: returned,
    }) };
  };
  const external = new AbortController();
  const removed = jest.spyOn(external.signal, 'removeEventListener');
  const iterator = createProvider(source, temporaryKey(), { transport }).generate(request(external.signal))[Symbol.asyncIterator]();
  try {
    const reading = iterator.next();
    let result: Awaited<typeof reading> | undefined;
    reading.then(value => { result = value; });
    await flush();
    // This assertion fails promptly if cleanup gates delivery; it never waits on that cleanup.
    expect(result).toEqual({ done: false, value: { type: 'done', text: '', model: 'test-model', usage: null, stop: 'end' } });
    expect(returned).toHaveBeenCalled();
    expect(physical?.signal.aborted).toBe(true);
    expect(removed).toHaveBeenCalled();
    expectOwnerReleased();
  } finally {
    // A deliberately broken transport may never finish return(), so do not await it here.
    iterator.return?.().catch(() => {});
  }
});

it('releases the external abort listener before yielding the first JSON text, without another next', async () => {
  const f = controlledTransport();
  const external = new AbortController();
  const add = jest.spyOn(external.signal, 'addEventListener');
  const remove = jest.spyOn(external.signal, 'removeEventListener');
  const iterator = createProvider(source, temporaryKey(), { transport: f.transport }).generate(request(external.signal))[Symbol.asyncIterator]();
  const first = iterator.next(); await flush();
  f.calls[0].send(headers('application/json')); f.calls[0].send(json()); f.calls[0].end();
  expect(await first).toEqual({ done: false, value: { type: 'text', delta: '正文' } });
  await flush();
  const abortCallback = add.mock.calls.find(call => call[0] === 'abort')?.[1];
  expect(remove).toHaveBeenCalledWith('abort', abortCallback);
  expect(f.calls[0]).toMatchObject({ released: 1, subscribed: false });
  expect(f.calls[0].request.signal.aborted).toBe(true);
  expectOwnerReleased();
  await iterator.return?.();
});

it.each(['abort', 'idle timeout', 'hard deadline'] as const)('releases a physical subscription paused after text on %s without another next', async mode => {
  const f = controlledTransport();
  const external = new AbortController();
  const remove = jest.spyOn(external.signal, 'removeEventListener');
  const iterator = createProvider(source, temporaryKey(), { transport: f.transport, ...(mode === 'hard deadline' ? { deadline: instant + 1000 } : {}) }).generate(request(external.signal))[Symbol.asyncIterator]();
  const first = iterator.next(); await flush();
  f.calls[0].send(headers()); f.calls[0].send(text());
  expect(await first).toEqual({ done: false, value: { type: 'text', delta: '正文' } });
  expect(f.calls[0].subscribed).toBe(true);
  if (mode === 'abort') { external.abort(); }
  else { await jest.advanceTimersByTimeAsync(mode === 'idle timeout' ? 90000 : 1000); }
  await flush();
  expect(f.calls[0]).toMatchObject({ released: 1, subscribed: false });
  expect(f.calls[0].request.signal.aborted).toBe(true);
  expect(remove).toHaveBeenCalled();
  expectOwnerReleased();
  await iterator.return?.();
});

it('classifies EOF before any model-list headers as network failure', async () => {
  const f = controlledTransport();
  const result = createProvider(source, temporaryKey(), { transport: f.transport }).listModels({ signal: new AbortController().signal });
  const outcome = result.catch(error => error);
  await flush(); f.calls[0].end();
  expect(await outcome).toMatchObject({ info: { code: 'AI_NETWORK', status: null } });
  expect(f.calls[0]).toMatchObject({ released: 1, subscribed: false });
  expect(f.calls[0].request.signal.aborted).toBe(true);
  expectOwnerReleased();
});

it('preserves prior text and classifies a physical network failure as interrupted only after visible output', async () => {
  for (const hasText of [true, false]) {
    let released = false;
    const transport: HttpTransport = () => ({
      async *[Symbol.asyncIterator]() {
        try {
          yield headers();
          if (hasText) { yield text(); }
          throw new TransportFailure('network');
        } finally { released = true; }
      },
    });
    const events = [];
    for await (const event of createProvider(source, temporaryKey(), { transport }).generate(request(new AbortController().signal))) {
      events.push(event);
    }
    if (hasText) {
      expect(events).toMatchObject([{ type: 'text', delta: '正文' }, { type: 'error', error: { code: 'AI_STREAM_INTERRUPTED' } }]);
    } else {
      expect(events).toMatchObject([{ type: 'error', error: { code: 'AI_NETWORK' } }]);
    }
    expect(released).toBe(true);
    expectOwnerReleased();
  }
});
