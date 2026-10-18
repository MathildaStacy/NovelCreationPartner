import { randomBytes } from 'crypto';
import { aiFailure, normalizeHttpError, parseRetryAfter, safeResponseScalar, type ErrorContext } from '../../src/ai/providers/errors';

const context: ErrorContext = { protocol: 'openai_responses', serviceName: '测试服务', model: 'test-model', baseUrl: 'https://example.com/v1', now: () => new Date('2026-10-18T00:00:00Z') };

it.each([
  [401, '<html>unauthorized</html>', 'AI_AUTH'],
  [403, {}, 'AI_PERMISSION'], [404, {}, 'AI_NOT_FOUND'], [405, {}, 'AI_BAD_REQUEST'],
  [402, {}, 'AI_QUOTA'], [429, { error: { code: 'insufficient_quota', type: 'rate_limit_error' } }, 'AI_QUOTA'],
  [429, { error: { type: 'rate_limit_error' } }, 'AI_RATE_LIMIT'], [529, {}, 'AI_SERVER'],
  [200, { error: { type: 'overloaded_error' } }, 'AI_SERVER'],
  [400, { error: { code: 'context_length_exceeded' } }, 'AI_CONTEXT_TOO_LONG'],
  [400, { error: { message: 'maximum context length exceeded' } }, 'AI_CONTEXT_TOO_LONG'],
  [400, { error: { message: 'unknown error' } }, 'AI_BAD_REQUEST'], [307, {}, 'AI_NETWORK'],
])('normalizes status %i without retaining provider text', (status, body, code) => {
  expect(normalizeHttpError(context, { status, body }).info.code).toBe(code);
});

it('distinguishes Anthropic spend limits from rate limits without overwriting an explicit retry hint', () => {
  const anthropic = { ...context, protocol: 'anthropic_messages' as const };
  const body = { error: { type: 'rate_limit_error', message: 'Your monthly spending limit was reached.' } };
  expect(normalizeHttpError(anthropic, { status: 429, body }).info.code).toBe('AI_QUOTA');
  expect(normalizeHttpError(anthropic, { status: 429, body, headers: { 'Retry-After': '2' } }).info.code).toBe('AI_RATE_LIMIT');
});

it.each([
  [{ 'retry-after-ms': '1200', 'retry-after': '9' }, 1200],
  [{ 'retry-after-ms': 'bad', 'retry-after': '2.5' }, 2500],
  [{ 'retry-after': '-1' }, 0],
  [{ 'retry-after': 'Sun, 18 Oct 2026 00:00:03 GMT' }, 3000],
  [{ 'retry-after': 'Sun, 18 Oct 2026 00:00:00 GMT' }, 0],
  [{ 'retry-after': 'tomorrow' }, null], [{ 'retry-after-ms': 'Infinity' }, null],
])('parses a bounded finite retry hint %j', (headers, expected) => {
  expect(parseRetryAfter(headers, Date.parse('2026-10-18T00:00:00Z'))).toBe(expected);
});

it('only detects an explicit parameter failure, and preserves the no-retry header', () => {
  const failure = normalizeHttpError(context, { status: 400, body: { error: { type: 'invalid_request_error', param: 'reasoning.effort', message: 'Unsupported parameter' } } });
  expect(failure.unsupported).toBe('effort');
  expect(failure.info.providerMessage).toBe('服务明确不支持推理强度参数。');
  expect(normalizeHttpError(context, { status: 400, body: { error: { message: 'Unsupported output_config' } } }).unsupported).toBeNull();
  expect(normalizeHttpError(context, { status: 400, body: { error: { message: 'Unsupported output_config.effort discussion in prompt' } } }).unsupported).toBeNull();
  expect(normalizeHttpError(context, { status: 400, body: JSON.stringify({ error: { message: "Unsupported parameter: 'output_config.effort'" } }) }).unsupported).toBe('effort');
  expect(normalizeHttpError(context, { status: 400, body: { error: { param: 'output_config.effort', message: 'Invalid value' } } }).unsupported).toBeNull();
  expect(normalizeHttpError(context, { status: 400, body: { error: { param: 'text.format', message: 'Unknown parameter' } } }).unsupported).toBe('jsonSchema');
  expect(normalizeHttpError(context, { status: 503, headers: { 'X-Should-Retry': 'false' } }).shouldRetry).toBe(false);
});

it('never returns an unknown error message or a reflected Key/prompt in diagnostic scalars', () => {
  const secret = randomBytes(24).toString('hex');
  const prompt = `私人正文-${randomBytes(12).toString('hex')}`;
  const sensitive = { ...context, sensitiveValues: [secret, prompt] };
  const error = normalizeHttpError(sensitive, { status: 400, headers: { 'x-request-id': `req_${secret}` }, body: { error: { message: `${secret} ${prompt}`, code: secret } } });
  expect(error.info.providerMessage).toBeNull();
  expect(error.info.requestId).toBeNull();
  expect(JSON.stringify(error.info)).not.toContain(secret);
  expect(JSON.stringify(error.info)).not.toContain(prompt);
  expect(safeResponseScalar(`model-${secret}`, sensitive, 'model')).toBeNull();
  expect(safeResponseScalar({ text: secret }, sensitive, 'model')).toBeNull();
  expect(safeResponseScalar('request\nheader', sensitive, 'requestId')).toBeNull();
  expect(safeResponseScalar('req_01.valid-id', sensitive, 'requestId')).toBe('req_01.valid-id');
  expect(aiFailure('AI_NETWORK', { ...sensitive, serviceName: secret, model: prompt }).info).toMatchObject({ serviceName: '模型服务', model: '所填模型' });
});
