import { DEFAULT_OPTIONS, normalizeKey, normalizeUrl, resolveUrl, validateDraft } from '../../src/features/modelServiceConfig';

it.each([
  ['openai_responses', 'https://api.openai.com', 'https://api.openai.com/v1/responses', 'https://api.openai.com/v1/models'],
  ['openai_responses', ' https://relay.example/gateway/v3/ ', 'https://relay.example/gateway/v3/responses', 'https://relay.example/gateway/v3/models'],
  ['openai_responses', 'https://relay.example/prefix/responses', 'https://relay.example/prefix/responses', 'https://relay.example/prefix/models'],
  ['anthropic_messages', 'https://api.anthropic.com', 'https://api.anthropic.com/v1/messages', 'https://api.anthropic.com/v1/models'],
  ['anthropic_messages', 'https://relay.example/claude', 'https://relay.example/claude/v1/messages', 'https://relay.example/claude/v1/models'],
  ['anthropic_messages', 'https://relay.example/v3', 'https://relay.example/v3/messages', 'https://relay.example/v3/models'],
  ['anthropic_messages', 'http://192.168.1.5:8080/route/v1/messages', 'http://192.168.1.5:8080/route/v1/messages', 'http://192.168.1.5:8080/route/v1/models'],
] as const)('resolves %s addresses without losing gateway prefixes', (protocol, base, generate, models) => {
  expect(resolveUrl(protocol, base, 'generate')).toBe(generate);
  expect(resolveUrl(protocol, base, 'models')).toBe(models);
});

it.each(['http://example.com', 'http://10.evil.com', 'http://192.168.evil.test', 'http://172.32.0.1', 'http://172.16.0.256', 'http://10.1', 'http://0x7f000001', 'http://2130706433', 'http://012.0.0.1', 'http://127.0.0.2', 'https://example.com?x=1', 'https://example.com#key', 'https://example.com?', 'https://user:pass@example.com', 'https://@example.com', 'https://example.com/\\evil', 'https://example.com/\npath', 'file:///v1', 'https://example.com/messages'])('rejects unsafe or contradictory address %s', address => {
  expect(() => normalizeUrl('openai_responses', address)).toThrow();
});

it.each(['localhost', '127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.20.1', 'studio.local'])('permits the designed local host %s with explicit http', host => {
  expect(normalizeUrl('openai_responses', `http://${host}:8080`)).toBe(`http://${host}:8080`);
});

it('normalizes pasted bearer prefix but refuses embedded whitespace and never truncates keys', () => {
  const key = `invalid-${globalThis.crypto.randomUUID()}`;
  expect(normalizeKey(` Bearer ${key} `)).toBe(key);
  expect(normalizeKey('')).toBeUndefined();
  expect(() => normalizeKey(`${key} next`)).toThrow();
  expect(() => normalizeKey('x'.repeat(513))).toThrow();
});

it('copies options, counts visible characters and rounds only a valid input budget', () => {
  const draft = { name: '海'.repeat(30), protocol: 'openai_responses' as const, baseUrl: 'https://example.com', model: 'custom-model', options: { ...DEFAULT_OPTIONS, caps: { streaming: true }, contextBudget: 25400 } };
  const normalized = validateDraft(draft);
  expect(normalized.options.contextBudget).toBe(25000);
  normalized.options.caps.streaming = false;
  expect(draft.options.caps.streaming).toBe(true);
  expect(() => validateDraft({ ...draft, name: '海'.repeat(31) })).toThrow();
  expect(() => validateDraft({ ...draft, options: { ...draft.options, contextBudget: 7999 } })).toThrow();
  expect(() => validateDraft({ ...draft, options: { ...draft.options, maxOutputTokens: 0 } })).toThrow();
  expect(() => validateDraft({ ...draft, model: '' })).toThrow();
  expect(validateDraft({ ...draft, model: '' }, false).model).toBe('');
});
