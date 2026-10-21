/** Tool protocol: request serialization and JSON / SSE parsing of tool calls for both protocols. */
import { ProtocolParser, parseJsonResponse } from '../../src/ai/providers/parse';
import { anthropicMessages, openaiInput } from '../../src/ai/providers/httpProvider';
import { normalizeHttpError, type ErrorContext } from '../../src/ai/providers/errors';
import { parseToolCall, formatPassages } from '../../src/ai/retrieval/tools';
import type { ChatMessage } from '../../src/ai/providers/types';

const context = (protocol: ErrorContext['protocol']): ErrorContext => ({ protocol, serviceName: 's', model: 'm', baseUrl: 'https://example.test' });
const frame = (data: object) => ({ event: (data as { type: string }).type, data: JSON.stringify(data) });

const turns: ChatMessage[] = [
  { role: 'user', content: '正文' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'search_passages', arguments: '{"keywords":["受伤"]}' }],
    replay: [{ type: 'thinking', thinking: 't', signature: 's' }, { type: 'tool_use', id: 'c1', name: 'search_passages', input: { keywords: ['受伤'] } }] },
  { role: 'user', content: '', toolResults: [{ callId: 'c1', name: 'search_passages', output: '找到 1 段' }] },
];

test('plain turns serialize exactly as before; tool turns map to each protocol', () => {
  expect(openaiInput([{ role: 'user', content: 'x' }])).toEqual([{ role: 'user', content: 'x' }]);
  expect(openaiInput(turns)).toEqual([{ role: 'user', content: '正文' },
    { type: 'function_call', call_id: 'c1', name: 'search_passages', arguments: '{"keywords":["受伤"]}' },
    { type: 'function_call_output', call_id: 'c1', output: '找到 1 段' }]);
  expect(anthropicMessages(turns)).toEqual([{ role: 'user', content: '正文' },
    { role: 'assistant', content: turns[1].replay },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '找到 1 段' }] }]);
});

test('JSON responses: function_call items and tool_use blocks become tool calls', () => {
  const openai = parseJsonResponse('openai_responses', { object: 'response', status: 'completed', model: 'm', usage: { input_tokens: 1, output_tokens: 1 },
    output: [{ type: 'reasoning', id: 'r1', summary: [] }, { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_passage', arguments: '{"ref":"p1"}' }] }, context('openai_responses'));
  expect(openai.at(-1)).toMatchObject({ type: 'done', stop: 'tool', toolCalls: [{ id: 'call_1', name: 'read_passage', arguments: '{"ref":"p1"}' }] });
  const anthropic = parseJsonResponse('anthropic_messages', { type: 'message', model: 'm', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: 'thinking', thinking: '想', signature: 'sig' }, { type: 'tool_use', id: 'tu_1', name: 'search_passages', input: { keywords: ['痊愈'] } }] }, context('anthropic_messages'));
  expect(anthropic.at(-1)).toMatchObject({ type: 'done', stop: 'tool', toolCalls: [{ id: 'tu_1', name: 'search_passages', arguments: '{"keywords":["痊愈"]}' }],
    replay: [{ type: 'thinking', thinking: '想', signature: 'sig' }, { type: 'tool_use', id: 'tu_1', name: 'search_passages', input: { keywords: ['痊愈'] } }] });
  // A tool stop without any call is a protocol violation.
  expect(parseJsonResponse('anthropic_messages', { type: 'message', stop_reason: 'tool_use', content: [], usage: { input_tokens: 1, output_tokens: 1 } }, context('anthropic_messages'))[0])
    .toMatchObject({ type: 'error', error: { code: 'AI_PROTOCOL_MISMATCH' } });
});

test('Anthropic SSE: streamed input_json fragments and thinking signatures are reassembled', () => {
  const parser = new ProtocolParser('anthropic_messages', context('anthropic_messages'));
  const events = [
    { type: 'message_start', message: { type: 'message', role: 'assistant', model: 'm', content: [], usage: { input_tokens: 5, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '核实' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'abc' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_9', name: 'search_passages', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"keywords":' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '["左手"]}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
    { type: 'message_stop' },
  ].flatMap(event => parser.push(frame(event)));
  expect(events.at(-1)).toMatchObject({ type: 'done', stop: 'tool', toolCalls: [{ id: 'tu_9', name: 'search_passages', arguments: '{"keywords":["左手"]}' }],
    replay: [{ type: 'thinking', thinking: '核实', signature: 'abc' }, { type: 'tool_use', id: 'tu_9', name: 'search_passages', input: { keywords: ['左手'] } }] });
});

test('OpenAI SSE: the completed response carries the authoritative function calls', () => {
  const parser = new ProtocolParser('openai_responses', context('openai_responses'));
  const call = { type: 'function_call', id: 'fc_1', call_id: 'call_7', name: 'search_passages', arguments: '{"keywords":["握剑"]}', status: 'completed' };
  const events = [
    { type: 'response.created', response: { object: 'response', status: 'in_progress', model: 'm' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...call, arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"keywords":["握剑"]}' },
    { type: 'response.output_item.done', output_index: 0, item: call },
    { type: 'response.completed', response: { object: 'response', status: 'completed', model: 'm', usage: { input_tokens: 3, output_tokens: 4 }, output: [call] } },
  ].flatMap(event => parser.push(frame(event)));
  expect(events.at(-1)).toMatchObject({ type: 'done', stop: 'tool', toolCalls: [{ id: 'call_7', name: 'search_passages', arguments: '{"keywords":["握剑"]}' }] });
});

test('a 400 naming the tools parameter is recognised as unsupported tools', () => {
  const failure = normalizeHttpError(context('openai_responses'), { status: 400, body: { error: { type: 'invalid_request_error', code: 'unsupported_parameter', param: 'tools', message: "Unsupported parameter: 'tools'." } } });
  expect(failure.unsupported).toBe('tools');
  const other = normalizeHttpError(context('anthropic_messages'), { status: 400, body: { error: { type: 'invalid_request_error', message: 'tools: this model does not support tools' } } });
  expect(other.unsupported).toBe('tools');
});

test('tool arguments are validated strictly and results are bounded without cutting a passage', () => {
  expect(parseToolCall('search_passages', '{"keywords":["痊愈"],"limit":2}')).toEqual({ name: 'search_passages', args: { entryIds: [], keywords: ['痊愈'], limit: 2 } });
  expect(parseToolCall('search_passages', '{"workId":"other"}')).toHaveProperty('error');
  expect(parseToolCall('search_passages', '{}')).toHaveProperty('error');
  expect(parseToolCall('read_passage', '{"ref":"p1; DROP"}')).toHaveProperty('error');
  expect(parseToolCall('read_passage', 'not json')).toHaveProperty('error');
  const formatted = formatPassages([{ ref: 'p1', label: '第1章', text: '甲'.repeat(100) }, { ref: 'p2', label: '第2章', text: '乙'.repeat(100) }], 160);
  expect(formatted.included.map(passage => passage.ref)).toEqual(['p1']);
  expect(formatted.text).toContain('超出长度上限');
  expect(formatPassages([], 500).text).toContain('没找到不等于不存在');
});
