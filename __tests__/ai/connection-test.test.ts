import { AppState, type AppStateStatus } from 'react-native';
import { testConnection } from '../../src/ai/providers/connectionTest';
import { TransportFailure, type HttpEvent, type HttpRequest, type HttpTransport } from '../../src/ai/transport/native';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import type { ModelService, Protocol } from '../../src/features/types';

const instant = Date.parse('2026-10-18T00:00:00Z');
const source = (protocol: Protocol = 'openai_responses'): Pick<ModelService, 'name' | 'protocol' | 'baseUrl' | 'model' | 'options'> => ({
  name: '测试服务', protocol, baseUrl: 'https://example.invalid/v1', model: 'configured-model',
  options: { ...DEFAULT_OPTIONS, maxOutputTokens: 8192, effort: 'high', store: true, caps: { jsonSchema: true } },
});
const temporaryKey = () => `invalid-${globalThis.crypto.randomUUID()}`;
const data = (text: string): HttpEvent => ({ type: 'data', text, bytes: Buffer.byteLength(text) });
const frame = (body: Record<string, unknown>) => `data: ${JSON.stringify(body)}\n\n`;
const delta = (text: string) => frame({ type: 'response.output_text.delta', delta: text });
const done = () => frame({ type: 'response.completed', response: { status: 'completed', model: 'returned-model', output: [] } });
const jsonDone = (protocol: Protocol = 'openai_responses') => protocol === 'openai_responses'
  ? { object: 'response', status: 'completed', model: 'returned-model', output: [] }
  : { type: 'message', stop_reason: 'end_turn', model: 'returned-model', content: [] };

interface Call {
  request: HttpRequest;
  send(event: HttpEvent): void;
  end(): void;
  released: number;
}
function controlledTransport() {
  const calls: Call[] = [];
  const transport: HttpTransport = request => {
    const queue: (HttpEvent | null)[] = [];
    let wake: (() => void) | undefined;
    const notify = () => { wake?.(); wake = undefined; };
    const call: Call = { request, released: 0, send(event) { queue.push(event); notify(); }, end() { queue.push(null); notify(); } };
    calls.push(call);
    return {
      async *[Symbol.asyncIterator]() {
        request.signal.addEventListener('abort', notify);
        try {
          for (;;) {
            if (request.signal.aborted) { throw new TransportFailure('cancelled'); }
            if (queue.length === 0) { await new Promise<void>(resolve => { wake = resolve; }); continue; }
            const event = queue.shift();
            if (!event) { return; }
            yield event;
          }
        } finally {
          request.signal.removeEventListener('abort', notify);
          call.released++;
        }
      },
    };
  };
  return { calls, transport };
}
async function flush() { for (let index = 0; index < 40; index++) { await Promise.resolve(); } }
function respond(call: Call, status: number, body: unknown, headers: Record<string, string> = {}) {
  call.send({ type: 'headers', status, headers: { 'content-type': 'application/json', ...headers } });
  call.send(data(JSON.stringify(body))); call.end();
}
function list(call: Call, ids: string[] = ['configured-model']) { respond(call, 200, { data: ids.map(id => ({ id })) }); }
function stream(call: Call, chunks: string[]) {
  call.send({ type: 'headers', status: 200, headers: { 'content-type': 'text/event-stream' } });
  for (const chunk of chunks) { call.send(data(chunk)); }
  call.end();
}
let listeners: Set<(state: AppStateStatus) => void>;
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(instant);
  listeners = new Set();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.add(listener);
    return { remove: () => { listeners.delete(listener); } };
  });
});
afterEach(() => {
  expect(jest.getTimerCount()).toBe(0);
  expect(listeners.size).toBe(0);
  jest.restoreAllMocks(); jest.useRealTimers();
});
function expectReleased(calls: Call[]) {
  for (const call of calls) {
    expect(call.released).toBe(1);
    expect(call.request.signal.aborted).toBe(true);
  }
}

it.each<Protocol>(['openai_responses', 'anthropic_messages'])('sends a fixed minimal %s ping after GET, ignoring expensive service defaults', async protocol => {
  const f = controlledTransport(); const secret = temporaryKey();
  const configured = source(protocol);
  const result = testConnection(configured, secret, { signal: new AbortController().signal, transport: f.transport });
  await flush();
  configured.model = 'later-edit'; configured.options.store = true; configured.options.caps.effort = false;
  expect(f.calls[0].request.method).toBe('GET');
  respond(f.calls[0], 200, { data: [{ id: 'unlisted-model' }], ...(protocol === 'anthropic_messages' ? { has_more: false } : {}) });
  await flush();
  const body = JSON.parse(f.calls[1].request.body!);
  if (protocol === 'openai_responses') {
    expect(body).toEqual({ model: 'configured-model', instructions: '', input: [{ role: 'user', content: 'ping' }], max_output_tokens: 64, stream: true, store: false, reasoning: { effort: 'low' } });
  } else {
    expect(body).toEqual({ model: 'configured-model', system: '', messages: [{ role: 'user', content: 'ping' }], max_tokens: 64, stream: true, output_config: { effort: 'low' } });
  }
  respond(f.calls[1], 200, jsonDone(protocol));
  expect(await result).toMatchObject({ ok: true, models: ['unlisted-model'], modelCount: 1, modelListed: false, responseModel: 'returned-model', streaming: false, capsPatch: { streaming: false }, error: null });
  expect(JSON.stringify(await result)).not.toContain(secret);
  expectReleased(f.calls);
});

it.each([404, 405])('skips only unavailable model-list HTTP %i and still tests generation', async status => {
  const f = controlledTransport();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport });
  await flush(); respond(f.calls[0], status, {}); await flush();
  respond(f.calls[1], 200, jsonDone());
  expect(await result).toMatchObject({ ok: true, models: null, modelCount: null, modelListed: null });
  expectReleased(f.calls);
});

it.each([[401, 'AI_AUTH'], [403, 'AI_PERMISSION'], [429, 'AI_RATE_LIMIT'], [503, 'AI_SERVER']])('fails model-list HTTP %i without retrying or sending POST', async (status, code) => {
  const f = controlledTransport();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport });
  await flush(); respond(f.calls[0], status as number, {}, { 'retry-after-ms': '0' });
  expect(await result).toMatchObject({ ok: false, latencyMs: 0, error: { code } });
  expect(f.calls).toHaveLength(1); expectReleased(f.calls);
});

it.each(['length', 'refusal'])('accepts a legal %s terminal without visible text or extra output requests', async stop => {
  const f = controlledTransport();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport });
  await flush(); list(f.calls[0]); await flush();
  const response = stop === 'length'
    ? { object: 'response', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }
    : { object: 'response', status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'declined' }] }] };
  respond(f.calls[1], 200, response);
  expect(await result).toMatchObject({ ok: true, error: null });
  expect(f.calls).toHaveLength(2); expectReleased(f.calls);
});

it.each([
  [[delta('a') + delta('b') + done()], null],
  [[delta('a'), delta('b') + done()], true],
] as const)('records only evidenced streaming from %j', async (chunks, streaming) => {
  const f = controlledTransport();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport });
  await flush(); list(f.calls[0]); await flush(); stream(f.calls[1], [...chunks]);
  expect(await result).toMatchObject({ ok: true, streaming, capsPatch: streaming === null ? {} : { streaming } });
  expect((await result).capsPatch).not.toHaveProperty('jsonSchema'); expectReleased(f.calls);
});

it('bounds effort fallback plus transient retries to four POSTs and reports the final POST latency', async () => {
  const f = controlledTransport(); const onRetry = jest.fn();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport, onRetry });
  await flush(); await jest.advanceTimersByTimeAsync(200); list(f.calls[0]); await flush();
  respond(f.calls[1], 400, { error: { code: 'unsupported_parameter', param: 'reasoning.effort', message: 'unsupported parameter' } });
  await flush();
  expect(JSON.parse(f.calls[2].request.body!)).not.toHaveProperty('reasoning');
  await jest.advanceTimersByTimeAsync(100);
  respond(f.calls[2], 503, {}); await flush();
  expect(onRetry).toHaveBeenNthCalledWith(1, 1, 1000);
  await jest.advanceTimersByTimeAsync(1000); await flush();
  respond(f.calls[3], 429, {}); await flush();
  expect(onRetry).toHaveBeenNthCalledWith(2, 2, 3000);
  await jest.advanceTimersByTimeAsync(3000); await flush();
  await jest.advanceTimersByTimeAsync(70); respond(f.calls[4], 200, jsonDone());
  expect(await result).toMatchObject({ ok: true, latencyMs: 70, capsPatch: { effort: false, streaming: false } });
  expect(f.calls.filter(call => call.request.method === 'POST')).toHaveLength(4);
  for (const call of f.calls.slice(1)) { expect(JSON.parse(call.request.body!).max_output_tokens).toBe(64); }
  expectReleased(f.calls);
});

it('limits transient failures to two retries even if the server keeps rejecting', async () => {
  const f = controlledTransport();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport });
  await flush(); list(f.calls[0]); await flush();
  for (let index = 1; index <= 3; index++) {
    respond(f.calls[index], 503, {}); await flush();
    if (index < 3) { await jest.advanceTimersByTimeAsync(index === 1 ? 1000 : 3000); await flush(); }
  }
  expect(await result).toMatchObject({ ok: false, error: { code: 'AI_SERVER' } });
  expect(f.calls).toHaveLength(4); expectReleased(f.calls);
});

it.each([
  [{ error: { code: 'invalid_request_error', param: 'output_config', message: 'unsupported parameter' } }, 1],
  [{ error: { code: 'unsupported_parameter', param: 'reasoning.effort', message: 'unsupported parameter' } }, 2],
])('does not repeatedly downgrade or infer unsupported effort from unrelated evidence %j', async (error, attempts) => {
  const f = controlledTransport();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport });
  await flush(); list(f.calls[0]); await flush();
  for (let index = 1; index <= attempts; index++) { respond(f.calls[index], 400, error); await flush(); }
  expect(await result).toMatchObject({ ok: false, error: { code: 'AI_BAD_REQUEST' } });
  expect(f.calls).toHaveLength(attempts + 1); expectReleased(f.calls);
});

it('omits effort for known unsupported services without inventing new capability evidence', async () => {
  const f = controlledTransport(); const configured = source(); configured.options.caps.effort = false;
  const result = testConnection(configured, temporaryKey(), { signal: new AbortController().signal, transport: f.transport });
  await flush(); list(f.calls[0]); await flush();
  expect(JSON.parse(f.calls[1].request.body!)).not.toHaveProperty('reasoning');
  respond(f.calls[1], 200, jsonDone());
  expect((await result).capsPatch).toEqual({ streaming: false }); expectReleased(f.calls);
});

it.each([
  [{ 'x-should-retry': 'false' }, 'AI_SERVER'],
  [{ 'retry-after-ms': '20000' }, 'AI_SERVER'],
  [{ 'retry-after': '21' }, 'AI_SERVER'],
])('does not issue a retry when hints disallow it or the wait consumes the deadline %j', async (headers, code) => {
  const f = controlledTransport(); const onRetry = jest.fn();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport, onRetry });
  await flush(); list(f.calls[0]); await flush(); respond(f.calls[1], 503, {}, headers);
  expect(await result).toMatchObject({ ok: false, error: { code } });
  expect(onRetry).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(2); expectReleased(f.calls);
});

it('uses retry-after-ms ahead of retry-after and excludes wait/list time from latency', async () => {
  const f = controlledTransport(); const onRetry = jest.fn();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport, onRetry });
  await flush(); list(f.calls[0]); await flush();
  respond(f.calls[1], 429, {}, { 'retry-after-ms': '250', 'retry-after': '19' }); await flush();
  expect(onRetry).toHaveBeenCalledWith(1, 250);
  await jest.advanceTimersByTimeAsync(249); expect(f.calls).toHaveLength(2);
  await jest.advanceTimersByTimeAsync(1); await flush();
  await jest.advanceTimersByTimeAsync(15); respond(f.calls[2], 200, jsonDone());
  expect(await result).toMatchObject({ ok: true, latencyMs: 15 }); expectReleased(f.calls);
});

it('never retries after visible streamed text', async () => {
  const f = controlledTransport();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport });
  await flush(); list(f.calls[0]); await flush();
  stream(f.calls[1], [delta('text') + frame({ type: 'error', error: { type: 'server_error', message: 'unavailable' } })]);
  expect(await result).toMatchObject({ ok: false, error: { code: 'AI_SERVER' } });
  expect(f.calls).toHaveLength(2); expectReleased(f.calls);
});

it.each(['json', 'sse'])('retains retry evidence for an HTTP 200 %s provider error without exposing server text', async format => {
  const f = controlledTransport(); const secret = temporaryKey(); const onRetry = jest.fn();
  const result = testConnection(source(), secret, { signal: new AbortController().signal, transport: f.transport, onRetry });
  await flush(); list(f.calls[0]); await flush();
  const body = { type: 'error', error: { type: 'server_error', message: secret } };
  if (format === 'json') { respond(f.calls[1], 200, body, { 'retry-after-ms': '500' }); }
  else {
    f.calls[1].send({ type: 'headers', status: 200, headers: { 'content-type': 'text/event-stream', 'retry-after-ms': '500' } });
    f.calls[1].send(data(frame(body))); f.calls[1].end();
  }
  await flush();
  expect(onRetry).toHaveBeenCalledWith(1, 500);
  await jest.advanceTimersByTimeAsync(500); await flush(); respond(f.calls[2], 200, jsonDone());
  expect(await result).toMatchObject({ ok: true });
  expect(JSON.stringify(await result)).not.toContain(secret); expectReleased(f.calls);
});

it.each(['json', 'sse'])('does not retry an HTTP 200 %s provider error with x-should-retry=false', async format => {
  const f = controlledTransport();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport });
  await flush(); list(f.calls[0]); await flush();
  const body = { type: 'error', error: { type: 'server_error' } };
  if (format === 'json') { respond(f.calls[1], 200, body, { 'x-should-retry': 'false' }); }
  else {
    f.calls[1].send({ type: 'headers', status: 200, headers: { 'content-type': 'text/event-stream', 'x-should-retry': 'false' } });
    f.calls[1].send(data(frame(body))); f.calls[1].end();
  }
  expect(await result).toMatchObject({ ok: false, error: { code: 'AI_SERVER' } });
  expect(f.calls).toHaveLength(2); expectReleased(f.calls);
});

it('requires a legal protocol terminal and does not treat a clean HTTP EOF as success', async () => {
  const f = controlledTransport();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport });
  await flush(); list(f.calls[0]); await flush(); stream(f.calls[1], [': heartbeat\n\n']);
  expect(await result).toMatchObject({ ok: false, error: { code: 'AI_NETWORK' } });
  expect(f.calls).toHaveLength(2); expectReleased(f.calls);
});

it('shares one twenty-second deadline between GET and POST and aborts a blocked POST', async () => {
  const f = controlledTransport();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport });
  await flush(); await jest.advanceTimersByTimeAsync(15000); list(f.calls[0]); await flush();
  await jest.advanceTimersByTimeAsync(4999); expect(f.calls[1].request.signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toMatchObject({ ok: false, latencyMs: 5000, error: { code: 'AI_TIMEOUT' } });
  expectReleased(f.calls);
});

it('honors an earlier deadline and never extends the twenty-second limit with a later one', async () => {
  for (const [requested, elapsed] of [[3000, 3000], [30000, 20000]]) {
    const f = controlledTransport(); const start = Date.now();
    const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport, deadline: start + requested });
    await flush(); await jest.advanceTimersByTimeAsync(elapsed);
    expect(await result).toMatchObject({ ok: false, latencyMs: 0, error: { code: 'AI_TIMEOUT' } });
    expect(f.calls).toHaveLength(1); expectReleased(f.calls);
  }
});

it.each(['GET', 'POST', 'wait'] as const)('cancels %s without recording a failed test or sending another request', async stage => {
  const f = controlledTransport(); const controller = new AbortController();
  const result = testConnection(source(), temporaryKey(), { signal: controller.signal, transport: f.transport });
  const outcome = result.then(value => ({ value }), error => ({ error }));
  await flush();
  if (stage !== 'GET') { list(f.calls[0]); await flush(); }
  if (stage === 'wait') { respond(f.calls[1], 503, {}); await flush(); }
  controller.abort(); controller.abort();
  expect(await outcome).toMatchObject({ error: { code: 'AI_CANCELLED' } });
  expect(f.calls).toHaveLength(stage === 'GET' ? 1 : 2); expectReleased(f.calls);
});

it('checks expiry on active during retry waiting before accepting a buffered timer', async () => {
  const f = controlledTransport();
  const result = testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport });
  await flush(); list(f.calls[0]); await flush(); respond(f.calls[1], 503, {}); await flush();
  jest.setSystemTime(instant + 20001);
  for (const listener of [...listeners]) { listener('active'); }
  expect(await result).toMatchObject({ ok: false, error: { code: 'AI_TIMEOUT' } });
  expect(f.calls).toHaveLength(2); expectReleased(f.calls);
});

it('does not start an already cancelled or expired test', async () => {
  const f = controlledTransport(); const controller = new AbortController(); controller.abort();
  await expect(testConnection(source(), temporaryKey(), { signal: controller.signal, transport: f.transport })).rejects.toMatchObject({ code: 'AI_CANCELLED' });
  expect(await testConnection(source(), temporaryKey(), { signal: new AbortController().signal, transport: f.transport, deadline: instant }))
    .toMatchObject({ ok: false, error: { code: 'AI_TIMEOUT' } });
  expect(f.calls).toHaveLength(0);
});

it('keeps an accepted success after a later cancellation and releases every resource', async () => {
  const f = controlledTransport(); const controller = new AbortController();
  const result = testConnection(source(), temporaryKey(), { signal: controller.signal, transport: f.transport });
  await flush(); list(f.calls[0]); await flush(); stream(f.calls[1], [done()]);
  expect(await result).toMatchObject({ ok: true });
  controller.abort(); await jest.advanceTimersByTimeAsync(21000);
  expect(await result).toMatchObject({ ok: true }); expectReleased(f.calls);
});

it('keeps the provider terminal that wins before cancellation during physical stream cleanup', async () => {
  const controller = new AbortController();
  const transport: HttpTransport = request => ({
    async *[Symbol.asyncIterator]() {
      try {
        yield { type: 'headers', status: 200, headers: { 'content-type': request.method === 'GET' ? 'application/json' : 'text/event-stream' } } as HttpEvent;
        yield data(request.method === 'GET' ? JSON.stringify({ data: [] }) : done());
      } finally {
        // The provider settled its terminal before returning the physical POST.
        if (request.method === 'POST') { controller.abort(); }
      }
    },
  });
  expect(await testConnection(source(), temporaryKey(), { signal: controller.signal, transport }))
    .toMatchObject({ ok: true, error: null });
});
