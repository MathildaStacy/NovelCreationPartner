import { ProtocolParser, parseJsonResponse, parseJsonResponseWithEvidence } from '../../src/ai/providers/parse';
import { randomBytes } from 'crypto';
import type { ErrorContext } from '../../src/ai/providers/errors';
import type { Protocol } from '../../src/features/types';
import type { StreamEvent } from '../../src/ai/providers/types';
import { SseDecoder } from '../../src/ai/providers/sse';

const context: ErrorContext = { protocol: 'openai_responses', serviceName: '测试服务', model: 'configured-model', baseUrl: 'https://example.com/v1' };
const parser = (protocol: Protocol = 'openai_responses') => new ProtocolParser(protocol, { ...context, protocol });
const event = (value: Record<string, unknown>) => ({ event: value.type as string, data: JSON.stringify(value) });
const openaiDone = (extra = {}) => event({ type: 'response.completed', response: { status: 'completed', model: 'returned-model', output: [], ...extra } });
const anthropicStart = () => event({ type: 'message_start', message: { type: 'message', model: 'claude-test', content: [], usage: { input_tokens: 12, output_tokens: 1 } } });

it('appends only OpenAI deltas and keeps the latest cumulative usage instead of summing snapshots', () => {
  const p = parser();
  expect(p.push(event({ type: 'response.created', response: { status: 'in_progress', model: 'returned-model', usage: { input_tokens: 8 } } }))).toEqual([]);
  expect(p.push(event({ type: 'response.output_text.delta', delta: '海' }))).toEqual([{ type: 'text', delta: '海' }]);
  p.push(event({ type: 'response.usage', usage: { input_tokens: 9, output_tokens: 2, output_tokens_details: { reasoning_tokens: 1 } } }));
  expect(p.push(event({ type: 'response.output_text.done', text: '海风' }))).toEqual([]);
  expect(p.push(event({ type: 'response.output_text.delta', delta: '风' }))).toEqual([{ type: 'text', delta: '风' }]);
  expect(p.push(openaiDone({ output: [{ type: 'message', content: [{ type: 'output_text', text: '海风' }] }], usage: { input_tokens: 9, output_tokens: 4 } }))).toEqual([
    { type: 'done', text: '海风', model: 'returned-model', usage: { input: 9, output: 4 }, stop: 'end' },
  ]);
  expect(p.push(event({ type: 'response.output_text.delta', delta: '迟到' }))).toEqual([]);
  expect(p.finish()).toEqual([]);
  expect(p.cancel()).toEqual([]);
});

it('accepts complete SSE at every string boundary and never treats a residual terminal as complete', () => {
  const wire = 'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"甲🌊"}\r\n\r\n' +
    'data: {"type":"response.completed","response":{"status":"completed","output":[],"model":"m"}}\n\n';
  for (let split = 0; split <= wire.length; split++) {
    const p = parser();
    const sse = new SseDecoder();
    const events = [...sse.push(wire.slice(0, split)), ...sse.push(wire.slice(split)), ...sse.finish()].flatMap(frame => p.push(frame));
    expect(events).toEqual([{ type: 'text', delta: '甲🌊' }, { type: 'done', text: '甲🌊', model: 'm', usage: null, stop: 'end' }]);
  }
  const p = parser();
  const sse = new SseDecoder();
  sse.push(wire.trimEnd()).forEach(frame => p.push(frame));
  sse.finish().forEach(frame => p.push(frame));
  expect(p.finish()).toMatchObject([{ type: 'error', error: { code: 'AI_STREAM_INTERRUPTED' } }]);
});

it('records Anthropic initial text, suppresses thinking, and waits for message_stop', () => {
  const p = parser('anthropic_messages');
  expect(p.push(anthropicStart())).toEqual([]);
  expect(p.push(event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '隐含思考' } }))).toEqual([]);
  expect(p.push(event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '更多思考' } }))).toEqual([]);
  p.push(event({ type: 'content_block_stop', index: 0 }));
  expect(p.push(event({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '初始' } }))).toEqual([{ type: 'text', delta: '初始' }]);
  expect(p.push(event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '追加' } }))).toEqual([{ type: 'text', delta: '追加' }]);
  p.push(event({ type: 'content_block_stop', index: 1 }));
  expect(p.push(event({ type: 'message_delta', delta: { stop_reason: 'max_tokens', stop_sequence: null }, usage: { output_tokens: 5 } }))).toEqual([]);
  expect(p.isTerminal).toBe(false);
  expect(p.push(event({ type: 'message_stop' }))).toEqual([{ type: 'done', text: '初始追加', model: 'claude-test', usage: { input: 12, output: 5 }, stop: 'length' }]);
});

it('does not invent missing usage as zero and emits a refusal terminal without refusal text', () => {
  const p = parser();
  expect(p.push(event({ type: 'response.refusal.delta', delta: '不能回答的原因' }))).toEqual([]);
  expect(p.push(openaiDone({ usage: { output_tokens: 6 } }))).toEqual([
    { type: 'done', text: '', model: 'returned-model', usage: null, stop: 'refusal' },
  ]);
  const finalRefusal = parser();
  expect(finalRefusal.push(openaiDone({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: '受限' }] }] }))).toMatchObject([{ type: 'done', stop: 'refusal', text: '' }]);
});

it.each([
  [{ type: 'response.output_text.delta', delta: 4 }],
  [{ type: 'response.usage', usage: { input_tokens: -1 } }],
  [{ type: 'response.completed', response: { status: 'completed', content: [] } }],
  [{ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'unknown' } } }],
  [{ type: 'response.completed', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }],
])('rejects a malformed known OpenAI event %j', value => {
  expect(parser().push(event(value))).toMatchObject([{ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } }]);
});

it('skips unknown extensions, rejects known malformed JSON and protocol mixing', () => {
  const p = parser();
  expect(p.push({ event: 'future.event', data: 'not-json' })).toEqual([]);
  expect(p.push({ event: null, data: '{"type":"response.future","extra":true}' })).toEqual([]);
  expect(p.push({ event: null, data: '[DONE]' })).toEqual([]);
  expect(p.push({ event: 'response.output_text.delta', data: '{broken' })).toMatchObject([{ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } }]);
  expect(parser().push({ event: 'response.completed', data: null })).toMatchObject([{ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } }]);
  expect(parser().push({ event: 'response.completed', data: '[DONE]' })).toMatchObject([{ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } }]);
  expect(parser().push(anthropicStart())).toMatchObject([{ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } }]);
  expect(parser('anthropic_messages').push(openaiDone())).toMatchObject([{ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } }]);
  expect(parser().push({ event: 'response.completed', data: '{"type":"response.output_text.delta","delta":"x"}' })).toMatchObject([{ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } }]);
});

it('rejects impossible Anthropic block sequencing and a missing or unknown stop reason', () => {
  const noStart = parser('anthropic_messages');
  expect(noStart.push(event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } }))).toMatchObject([{ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } }]);
  const noStop = parser('anthropic_messages');
  noStop.push(anthropicStart());
  expect(noStop.push(event({ type: 'message_stop' }))).toMatchObject([{ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } }]);
  const unknownStop = parser('anthropic_messages');
  unknownStop.push(anthropicStart());
  expect(unknownStop.push(event({ type: 'message_delta', delta: { stop_reason: 'future' } }))).toMatchObject([{ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } }]);
  const unknownBlock = parser('anthropic_messages');
  unknownBlock.push(anthropicStart());
  expect(unknownBlock.push(event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'x' } }))).toMatchObject([{ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } }]);
  const populatedStart = parser('anthropic_messages');
  expect(populatedStart.push(event({ type: 'message_start', message: { type: 'message', content: [{ type: 'text', text: 'not a block event' }] } }))).toMatchObject([{ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } }]);
});

it('normalizes in-stream failures, and settles EOF/cancel exactly once', () => {
  const p = parser('anthropic_messages');
  expect(p.push(event({ type: 'error', error: { type: 'overloaded_error', message: 'unsafe secret' } }))).toMatchObject([{ type: 'error', error: { code: 'AI_SERVER', providerMessage: '服务发生内部错误或过载。' } }]);
  expect(p.finish()).toEqual([]);
  expect(p.cancel()).toEqual([]);
  const cancelled = parser();
  expect(cancelled.cancel()).toEqual([{ type: 'cancelled' }]);
  expect(cancelled.push(openaiDone())).toEqual([]);
  expect(cancelled.finish()).toEqual([]);
  expect(parser().finish()).toMatchObject([{ type: 'error', error: { code: 'AI_NETWORK' } }]);
  const partial = parser();
  partial.push(event({ type: 'response.output_text.delta', delta: '已保留' }));
  expect(partial.finish()).toMatchObject([{ type: 'error', error: { code: 'AI_STREAM_INTERRUPTED' } }]);
});

it('preserves only safe normalized error evidence across a stream terminal and late events', () => {
  const p = new ProtocolParser('openai_responses', context, { status: 200, headers: { 'retry-after-ms': '1200', 'x-should-retry': 'false' } });
  expect(p.failure).toBeNull();
  const [terminal] = p.push(event({ type: 'error', code: 'rate_limit_exceeded', message: 'provider raw text must not survive' }));
  expect(p.failure).toMatchObject({ info: { code: 'AI_RATE_LIMIT' }, retryAfterMs: 1200, shouldRetry: false });
  expect(terminal).toEqual({ type: 'error', error: p.failure?.info });
  const failure = p.failure;
  p.cancel();
  p.finish();
  p.push(openaiDone());
  expect(p.failure).toBe(failure);
  expect(JSON.stringify(failure)).not.toContain('provider raw text must not survive');
});

it('exposes JSON 200 error evidence without reconstructing a lossy ProviderFailure from the event', () => {
  const result = parseJsonResponseWithEvidence('openai_responses', { error: { code: 'rate_limit_exceeded', message: 'private raw text' } }, context,
    { status: 200, headers: { 'retry-after': '3', 'x-request-id': 'req_safe' } });
  expect(result.failure).toMatchObject({ info: { code: 'AI_RATE_LIMIT', status: 200, requestId: 'req_safe' }, retryAfterMs: 3000, shouldRetry: true, unsupported: null });
  expect(result.events).toEqual([{ type: 'error', error: result.failure?.info }]);
  const malformed = parseJsonResponseWithEvidence('openai_responses', '<html/>', context);
  expect(malformed.failure?.info.code).toBe('AI_PROTOCOL_MISMATCH');
  expect(malformed.failure?.shouldRetry).toBe(false);
  const bodyId = parseJsonResponseWithEvidence('anthropic_messages', { type: 'error', request_id: 'req_body', error: { type: 'overloaded_error' } }, context);
  expect(bodyId.failure?.info.requestId).toBe('req_body');
});

it('parses both JSON fallbacks, including output arrays, thinking and refusal precedence', () => {
  const openai = parseJsonResponse('openai_responses', { object: 'response', status: 'completed', model: 'gpt-test', error: null,
    output_text: '不能依赖此字段', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '甲' }, { type: 'refusal', refusal: '受限' }, { type: 'output_text', text: '乙' }] }], usage: { input_tokens: 4, output_tokens: 5 } }, context);
  expect(openai).toEqual([{ type: 'text', delta: '甲乙' }, { type: 'done', text: '甲乙', model: 'gpt-test', usage: { input: 4, output: 5 }, stop: 'refusal' }]);
  const anthropic = parseJsonResponse('anthropic_messages', { type: 'message', model: 'claude-test', stop_reason: 'model_context_window_exceeded', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: '正文' }], usage: { input_tokens: 10 } }, { ...context, protocol: 'anthropic_messages' });
  expect(anthropic).toEqual([{ type: 'text', delta: '正文' }, { type: 'done', text: '正文', model: 'claude-test', usage: null, stop: 'length' }]);
});

it.each([
  ['openai_responses', '<html>ok</html>'],
  ['openai_responses', { status: 'completed', output_text: 'SDK only' }],
  ['openai_responses', { status: 'completed', output: [{ type: 'message', content: [{ type: 'text', text: 'wrong' }] }] }],
  ['anthropic_messages', { type: 'message', stop_reason: 'end_turn', content: [{ type: 'output_text', text: 'wrong' }] }],
  ['anthropic_messages', { status: 'completed', output: [] }],
])('rejects malformed or mixed JSON fallback %s %j', (protocol, value) => {
  const result = parseJsonResponse(protocol as Protocol, value, context);
  expect(result).toMatchObject([{ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } }]);
});

it('rejects unsafe response scalars while keeping valid generated body text', () => {
  const secret = `invalid-test-${randomBytes(24).toString('hex')}`;
  const events = parseJsonResponse('openai_responses', { status: 'completed', model: `model-${secret}`, output: [{ type: 'message', content: [{ type: 'output_text', text: '正常正文' }] }] }, { ...context, sensitiveValues: [secret] });
  expect(events).toEqual([{ type: 'text', delta: '正常正文' }, { type: 'done', text: '正常正文', model: null, usage: null, stop: 'end' }]);
  expect(events.filter((item): item is Extract<StreamEvent, { type: 'done' }> => item.type === 'done')[0].model).toBeNull();
});
