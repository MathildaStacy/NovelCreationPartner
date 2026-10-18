import { AppState, type AppStateStatus } from 'react-native';
import { createProvider, type AttemptEvidence } from '../../src/ai/providers/httpProvider';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import type { ModelService, Protocol } from '../../src/features/types';
import { TransportFailure, type HttpEvent, type HttpRequest, type HttpTransport } from '../../src/ai/transport/native';
import type { GenerateRequest, StreamEvent } from '../../src/ai/providers/types';

const instant = Date.parse('2026-10-18T00:00:00Z');
const service = (protocol: Protocol = 'openai_responses'): Pick<ModelService, 'name' | 'protocol' | 'baseUrl' | 'model' | 'options'> => ({
  name: '受控服务', protocol, baseUrl: 'https://models.example.com/gateway', model: 'configured-model',
  options: { ...DEFAULT_OPTIONS, caps: {} },
});
const request = (signal: AbortSignal, extra: Partial<GenerateRequest> = {}): GenerateRequest => ({
  system: '系统提示', messages: [{ role: 'user', content: '测试输入' }], maxOutputTokens: 64, effort: 'low', stream: true, signal, ...extra,
});
const headers = (status = 200, contentType = 'text/event-stream', extra: Record<string, string> = {}): HttpEvent => ({
  type: 'headers', status, headers: { 'content-type': contentType, ...extra },
});
const data = (text: string): HttpEvent => ({ type: 'data', text, bytes: Buffer.byteLength(text) });
const frame = (value: Record<string, unknown>) => `event: ${String(value.type)}\ndata: ${JSON.stringify(value)}\n\n`;
const delta = (text: string) => frame({ type: 'response.output_text.delta', delta: text });
const done = () => frame({ type: 'response.completed', response: { status: 'completed', model: 'returned-model', output: [], usage: { input_tokens: 3, output_tokens: 2 } } });
const openaiJson = () => JSON.stringify({ object: 'response', status: 'completed', model: 'returned-model', output: [{ type: 'message', content: [{ type: 'output_text', text: '回复' }] }], usage: { input_tokens: 3, output_tokens: 2 } });
const anthropicJson = () => JSON.stringify({ type: 'message', model: 'returned-model', stop_reason: 'end_turn', content: [{ type: 'text', text: '回复' }], usage: { input_tokens: 3, output_tokens: 2 } });

interface ControlledCall {
  request: HttpRequest;
  send(event: HttpEvent): void;
  end(): void;
  fail(error: unknown): void;
  released: number;
  aborts: number;
}
/** A transport which wakes blocked readers on abort, like the native adapter. */
function controlledTransport() {
  const calls: ControlledCall[] = [];
  const transport: HttpTransport = physical => {
    const queue: ({ event: HttpEvent } | { error: unknown } | { end: true })[] = [];
    let wake: (() => void) | undefined;
    const notify = () => { wake?.(); wake = undefined; };
    const call: ControlledCall = {
      request: physical, released: 0, aborts: 0,
      send(event) { queue.push({ event }); notify(); },
      end() { queue.push({ end: true }); notify(); },
      fail(error) { queue.push({ error }); notify(); },
    };
    calls.push(call);
    return {
      async *[Symbol.asyncIterator]() {
        const abort = () => { call.aborts++; notify(); };
        physical.signal.addEventListener('abort', abort);
        try {
          for (;;) {
            if (physical.signal.aborted) throw new TransportFailure('cancelled');
            const item = queue.shift();
            if (!item) { await new Promise<void>(resolve => { wake = resolve; }); continue; }
            if ('end' in item) return;
            if ('error' in item) throw item.error;
            yield item.event;
          }
        } finally {
          physical.signal.removeEventListener('abort', abort);
          call.released++;
        }
      },
    };
  };
  return { transport, calls };
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
async function collect(events: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const result: StreamEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}
let secret: string;
let stateListeners: Set<(state: AppStateStatus) => void>;
let stateRemovals: jest.Mock[];
beforeEach(() => {
  secret = `invalid-${globalThis.crypto.randomUUID()}`;
  jest.useFakeTimers();
  jest.setSystemTime(instant);
  stateListeners = new Set(); stateRemovals = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    stateListeners.add(listener);
    const remove = jest.fn(() => stateListeners.delete(listener));
    stateRemovals.push(remove);
    return { remove };
  });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
function expectReleased(calls: ControlledCall[]) {
  expect(jest.getTimerCount()).toBe(0);
  expect(stateListeners.size).toBe(0);
  for (const remove of stateRemovals) expect(remove).toHaveBeenCalledTimes(1);
  for (const call of calls) {
    expect(call.released).toBe(1);
    expect(call.request.signal.aborted).toBe(true);
  }
}

it.each<Protocol>(['openai_responses', 'anthropic_messages'])('maps %s into one authenticated POST and a shared text/done contract', async protocol => {
  const f = controlledTransport();
  const source = service(protocol);
  source.options.store = true;
  const schema = { type: 'object', properties: { title: { type: 'string' } } };
  const result = collect(createProvider(source, secret, { transport: f.transport }).generate(request(new AbortController().signal, { jsonSchema: { name: 'answer', schema } })));
  await flush();
  expect(f.calls).toHaveLength(1);
  const call = f.calls[0];
  expect(call.request.method).toBe('POST');
  expect(call.request.headers).toMatchObject({ 'Content-Type': 'application/json', Accept: 'text/event-stream' });
  const body = JSON.parse(call.request.body!);
  if (protocol === 'openai_responses') {
    expect(call.request.url).toBe('https://models.example.com/gateway/responses');
    expect(call.request.headers.Authorization).toBe(`Bearer ${secret}`);
    expect(call.request.headers['x-api-key']).toBeUndefined();
    expect(body).toEqual({ model: 'configured-model', instructions: '系统提示', input: [{ role: 'user', content: '测试输入' }], max_output_tokens: 64, stream: true, store: true, reasoning: { effort: 'low' }, text: { format: { type: 'json_schema', name: 'answer', schema, strict: true } } });
  } else {
    expect(call.request.url).toBe('https://models.example.com/gateway/v1/messages');
    expect(call.request.headers).toMatchObject({ 'x-api-key': secret, 'anthropic-version': '2023-06-01' });
    expect(call.request.headers.Authorization).toBeUndefined();
    expect(body).toEqual({ model: 'configured-model', system: '系统提示', messages: [{ role: 'user', content: '测试输入' }], max_tokens: 64, stream: true, output_config: { effort: 'low', format: { type: 'json_schema', schema } } });
  }
  call.send(headers(200, 'application/json; charset=utf-8'));
  call.send(data(protocol === 'openai_responses' ? openaiJson() : anthropicJson())); call.end();
  expect(await result).toEqual([{ type: 'text', delta: '回复' }, { type: 'done', text: '回复', model: 'returned-model', usage: { input: 3, output: 2 }, stop: 'end' }]);
  expectReleased(f.calls);
});

it('captures service options and messages, supports Anthropic bearer, and omits unsupported optional parameters', async () => {
  const f = controlledTransport();
  const source = service('anthropic_messages');
  source.options.authHeader = 'bearer'; source.options.caps = { effort: false, jsonSchema: false };
  const provider = createProvider(source, secret, { transport: f.transport });
  const input = request(new AbortController().signal, { stream: false, jsonSchema: { name: 'unused', schema: { type: 'object' } } });
  const events = provider.generate(input);
  source.model = 'edited-model'; source.options.caps.effort = true; input.messages[0].content = '编辑后输入';
  const result = collect(events); await flush();
  const call = f.calls[0];
  expect(call.request.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, 'anthropic-version': '2023-06-01' });
  expect(JSON.parse(call.request.body!)).toEqual({ model: 'configured-model', system: '系统提示', messages: [{ role: 'user', content: '测试输入' }], max_tokens: 64, stream: false });
  call.send(headers(200, 'application/json')); call.send(data(anthropicJson())); call.end();
  expect((await result).filter(event => event.type === 'done')).toHaveLength(1);
  expectReleased(f.calls);
});

it.each([
  [401, 'text/html', '<html>authentication required</html>', 'AI_AUTH'],
  [503, 'text/html', '<html>gateway unavailable</html>', 'AI_SERVER'],
  [429, 'application/json', '{"error":{"code":"insufficient_quota"}}', 'AI_QUOTA'],
  [200, 'text/html', '<html>wrong route</html>', 'AI_PROTOCOL_MISMATCH'],
])('normalizes HTTP %i/%s safely and never retries within a provider', async (status, contentType, body, code) => {
  const f = controlledTransport();
  const result = collect(createProvider(service(), secret, { transport: f.transport }).generate(request(new AbortController().signal)));
  await flush();
  f.calls[0].send(headers(status as number, contentType as string)); f.calls[0].send(data(body as string)); f.calls[0].end();
  expect(await result).toMatchObject([{ type: 'error', error: { code } }]);
  expect(f.calls).toHaveLength(1); expectReleased(f.calls);
});

it.each([
  ['one SSE delivery', [delta('甲') + delta('乙') + done()], null],
  ['multiple SSE deliveries', [delta('甲'), delta('乙') + done()], true],
  ['JSON fallback', [openaiJson()], false],
] as const)('records streaming evidence from physical text deliveries: %s', async (_label, chunks, streaming) => {
  const f = controlledTransport();
  const evidence: AttemptEvidence = { streaming: null, failure: null };
  const result = collect(createProvider(service(), secret, { transport: f.transport, evidence }).generate(request(new AbortController().signal)));
  await flush();
  f.calls[0].send(headers(200, streaming === false ? 'application/json' : 'text/event-stream'));
  for (const chunk of chunks) { f.calls[0].send(data(chunk)); await flush(); }
  f.calls[0].end();
  const events = await result;
  expect(events.filter(event => event.type === 'done')).toHaveLength(1);
  expect(evidence.streaming).toBe(streaming); expect(evidence.failure).toBeNull(); expectReleased(f.calls);
});

it('accepts only the first terminal, closes the physical stream, and ignores queued late frames', async () => {
  const f = controlledTransport(); const external = new AbortController();
  const result = collect(createProvider(service(), secret, { transport: f.transport }).generate(request(external.signal)));
  await flush();
  f.calls[0].send(headers()); f.calls[0].send(data(delta('保留') + done() + delta('迟到') + done()));
  expect(await result).toEqual([{ type: 'text', delta: '保留' }, { type: 'done', text: '保留', model: 'returned-model', usage: { input: 3, output: 2 }, stop: 'end' }]);
  external.abort(); expectReleased(f.calls);
});

it.each(['SSE done', 'JSON done', 'HTTP error'] as const)('releases resources before yielding %s even when the consumer stops calling next', async mode => {
  const f = controlledTransport(); const external = new AbortController();
  const removeExternal = jest.spyOn(external.signal, 'removeEventListener');
  const iterator = createProvider(service(), secret, { transport: f.transport }).generate(request(external.signal))[Symbol.asyncIterator]();
  const first = iterator.next(); await flush();
  if (mode === 'SSE done') {
    f.calls[0].send(headers()); f.calls[0].send(data(done()));
  } else {
    f.calls[0].send(headers(mode === 'HTTP error' ? 503 : 200, 'application/json'));
    f.calls[0].send(data(mode === 'HTTP error' ? '{"error":{"type":"server_error"}}' : openaiJson())); f.calls[0].end();
  }
  try {
    const initial = await first;
    const terminal = initial.value?.type === 'text' ? await iterator.next() : initial;
    expect(terminal.value).toMatchObject({ type: mode === 'HTTP error' ? 'error' : 'done' });
    expect(removeExternal).toHaveBeenCalledTimes(1);
    expectReleased(f.calls);
    await jest.advanceTimersByTimeAsync(300001);
    expect(stateListeners.size).toBe(0);
  } finally { await iterator.return?.(); }
});

it('cancels a blocked read once, discards late success, and does not start already cancelled work', async () => {
  const f = controlledTransport(); const external = new AbortController();
  const result = collect(createProvider(service(), secret, { transport: f.transport }).generate(request(external.signal)));
  await flush(); external.abort(); external.abort();
  f.calls[0].send(headers()); f.calls[0].send(data(done()));
  expect(await result).toEqual([{ type: 'cancelled' }]); expectReleased(f.calls);
  const cancelled = new AbortController(); cancelled.abort();
  expect(await collect(createProvider(service(), secret, { transport: f.transport }).generate(request(cancelled.signal)))).toEqual([{ type: 'cancelled' }]);
  expect(f.calls).toHaveLength(1); expectReleased(f.calls);
});

it('iterator.return aborts a pending next without waiting for the remote server', async () => {
  const f = controlledTransport();
  const iterator = createProvider(service(), secret, { transport: f.transport }).generate(request(new AbortController().signal))[Symbol.asyncIterator]();
  const next = iterator.next(); await flush();
  const returned = iterator.return!();
  expect(await next).toEqual({ done: false, value: { type: 'cancelled' } });
  expect(await returned).toEqual({ done: true, value: undefined });
  expect(await iterator.next()).toEqual({ done: true, value: undefined }); expectReleased(f.calls);
});

it('uses response body bytes for the 60-second first-byte timeout, not headers', async () => {
  const f = controlledTransport();
  const result = collect(createProvider(service(), secret, { transport: f.transport }).generate(request(new AbortController().signal)));
  await flush(); f.calls[0].send(headers()); await flush();
  await jest.advanceTimersByTimeAsync(59999); expect(f.calls[0].request.signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toMatchObject([{ type: 'error', error: { code: 'AI_TIMEOUT' } }]); expectReleased(f.calls);
});

it('does not let partial SSE bytes extend the 90-second complete-event idle deadline', async () => {
  const f = controlledTransport();
  const result = collect(createProvider(service(), secret, { transport: f.transport }).generate(request(new AbortController().signal)));
  await flush(); f.calls[0].send(headers()); f.calls[0].send(data(delta('已有文字'))); await flush();
  await jest.advanceTimersByTimeAsync(45000); f.calls[0].send(data('data: {"type":')); await flush();
  await jest.advanceTimersByTimeAsync(44999); expect(f.calls[0].request.signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toMatchObject([{ type: 'text', delta: '已有文字' }, { type: 'error', error: { code: 'AI_STREAM_INTERRUPTED' } }]); expectReleased(f.calls);
});

it('lets complete heartbeats reset idle time but cannot extend the five-minute hard deadline', async () => {
  const f = controlledTransport();
  const result = collect(createProvider(service(), secret, { transport: f.transport }).generate(request(new AbortController().signal)));
  await flush(); f.calls[0].send(headers()); f.calls[0].send(data(': heartbeat\n\n')); await flush();
  for (let i = 0; i < 3; i++) {
    await jest.advanceTimersByTimeAsync(80000); f.calls[0].send(data(': heartbeat\n\n')); await flush();
    expect(f.calls[0].request.signal.aborted).toBe(false);
  }
  await jest.advanceTimersByTimeAsync(59999); expect(f.calls[0].request.signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toMatchObject([{ type: 'error', error: { code: 'AI_TIMEOUT' } }]); expectReleased(f.calls);
});

it('extends JSON idle time for new bytes and completes through the fallback', async () => {
  const f = controlledTransport();
  const result = collect(createProvider(service(), secret, { transport: f.transport }).generate(request(new AbortController().signal)));
  await flush(); f.calls[0].send(headers(200, 'application/json')); const body = openaiJson();
  f.calls[0].send(data(body.slice(0, 30))); await flush();
  await jest.advanceTimersByTimeAsync(80000); f.calls[0].send(data(body.slice(30, 60))); await flush();
  await jest.advanceTimersByTimeAsync(80000); expect(f.calls[0].request.signal.aborted).toBe(false);
  f.calls[0].send(data(body.slice(60))); f.calls[0].end();
  expect((await result).filter(event => event.type === 'done')).toHaveLength(1); expectReleased(f.calls);
});

it('checks wall-clock expiry on active before accepting a buffered success', async () => {
  const f = controlledTransport();
  const result = collect(createProvider(service(), secret, { transport: f.transport }).generate(request(new AbortController().signal)));
  await flush(); f.calls[0].send(headers()); f.calls[0].send(data(': heartbeat\n\n')); await flush();
  jest.setSystemTime(instant + 300001);
  for (const listener of [...stateListeners]) listener('active');
  f.calls[0].send(data(done()));
  expect(await result).toMatchObject([{ type: 'error', error: { code: 'AI_TIMEOUT' } }]); expectReleased(f.calls);
});

it('paginates Anthropic with encoded cursors and one 20-second deadline across all GETs', async () => {
  const f = controlledTransport();
  const result = createProvider(service('anthropic_messages'), secret, { transport: f.transport }).listModels({ signal: new AbortController().signal });
  const outcome = result.then(value => ({ value }), error => ({ error }));
  await flush(); expect(f.calls[0].request.url).toBe('https://models.example.com/gateway/v1/models?limit=1000');
  await jest.advanceTimersByTimeAsync(15000);
  f.calls[0].send(headers(200, 'application/json')); f.calls[0].send(data(JSON.stringify({ data: [{ id: 'model-1' }], has_more: true, last_id: 'cursor/one' }))); f.calls[0].end(); await flush();
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1].request.url).toBe('https://models.example.com/gateway/v1/models?limit=1000&after_id=cursor%2Fone');
  expect(f.calls[1].request.method).toBe('GET'); expect(f.calls[1].request.body).toBeUndefined();
  expect(f.calls[1].request.signal).toBe(f.calls[0].request.signal);
  await jest.advanceTimersByTimeAsync(4999); expect(f.calls[1].request.signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  expect(await outcome).toMatchObject({ error: { info: { code: 'AI_TIMEOUT' } } });
  expect(f.calls).toHaveLength(2); expectReleased(f.calls);
});

it('deduplicates model pages and does not retry an invalid repeated pagination cursor', async () => {
  const f = controlledTransport();
  const result = createProvider(service('anthropic_messages'), secret, { transport: f.transport }).listModels({ signal: new AbortController().signal });
  const outcome = result.then(value => ({ value }), error => ({ error }));
  await flush();
  f.calls[0].send(headers(200, 'application/json')); f.calls[0].send(data('{"data":[{"id":"one"},{"id":"one"}],"has_more":true,"last_id":"one"}')); f.calls[0].end(); await flush();
  f.calls[1].send(headers(200, 'application/json')); f.calls[1].send(data('{"data":[{"id":"two"}],"has_more":true,"last_id":"one"}')); f.calls[1].end();
  expect(await outcome).toMatchObject({ error: { info: { code: 'AI_PROTOCOL_MISMATCH' } } });
  expect(f.calls).toHaveLength(2); expectReleased(f.calls);
});

it('returns deduplicated models from successful Anthropic pages without generating', async () => {
  const f = controlledTransport();
  const result = createProvider(service('anthropic_messages'), secret, { transport: f.transport }).listModels({ signal: new AbortController().signal });
  await flush();
  f.calls[0].send(headers(200, 'application/json')); f.calls[0].send(data('{"data":[{"id":"one"}],"has_more":true,"last_id":"one"}')); f.calls[0].end(); await flush();
  f.calls[1].send(headers(200, 'application/json')); f.calls[1].send(data('{"data":[{"id":"one"},{"id":"two"}],"has_more":false}')); f.calls[1].end();
  expect(await result).toEqual(['one', 'two']);
  expect(f.calls.every(call => call.request.method === 'GET')).toBe(true); expectReleased(f.calls);
});

it('honors a supplied earlier deadline and cancellation during pagination without creating another GET', async () => {
  const f = controlledTransport(); const external = new AbortController();
  const result = createProvider(service('anthropic_messages'), secret, { transport: f.transport, deadline: instant + 3000 }).listModels({ signal: external.signal });
  const outcome = result.then(value => ({ value }), error => ({ error }));
  await flush(); await jest.advanceTimersByTimeAsync(2999); external.abort();
  f.calls[0].send(headers(200, 'application/json')); f.calls[0].send(data('{"data":[],"has_more":true,"last_id":"next"}')); f.calls[0].end();
  await jest.advanceTimersByTimeAsync(1);
  expect(await outcome).toMatchObject({ error: { info: { code: 'AI_CANCELLED' } } });
  expect(f.calls).toHaveLength(1); expectReleased(f.calls);
});
