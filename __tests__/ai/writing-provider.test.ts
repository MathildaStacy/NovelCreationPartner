import { createContextPlan } from '../../src/ai/context';
import { executeWritingPlan, type AttemptOutcome } from '../../src/ai/runtime';
import { createProvider } from '../../src/ai/providers/httpProvider';
import type { HttpRequest, HttpTransport } from '../../src/ai/transport/native';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';

/** Synthetic transport only: verifies real provider serialization/retry integration without paid calls. */
test.each(['openai_responses', 'anthropic_messages'] as const)('writing runtime shares ledger and downgrade budget through %s provider', async protocol => {
  const plan = createContextPlan({ planId: 'preview', workId: 'work', sourceVersion: 'v1', dependencies: { chapterOrder: 'a,b' }, task: 'describe',
    input: { selection: '', before: '晚风拂面。', after: '', referenceIds: [] }, blocks: [],
    serviceSnapshot: { id: 'fixture', revision: 1, name: 'fixture', model: 'fixture-model', baseUrl: 'https://example.invalid/v1', protocol,
      options: { ...DEFAULT_OPTIONS, caps: {} }, pricingVersion: null } });
  const requests: HttpRequest[] = [], outcomes: AttemptOutcome[] = [];
  const transport: HttpTransport = async function* (request) {
    requests.push(request);
    const first = requests.length === 1;
    const body = first ? { error: { type: 'invalid_request_error', param: protocol === 'openai_responses' ? 'reasoning.effort' : 'output_config.effort', message: 'unsupported parameter' } } : protocol === 'openai_responses'
      ? { object: 'response', status: 'completed', model: 'fixture-model', usage: { input_tokens: 120, output_tokens: 32 }, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '晚风吹过树梢。' }] }] }
      : { type: 'message', model: 'fixture-model', stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 32 }, content: [{ type: 'text', text: '晚风吹过树梢。' }] };
    yield { type: 'headers', status: first ? 400 : 200, headers: { 'content-type': 'application/json', 'x-request-id': `fixture-${requests.length}` } };
    const text = JSON.stringify(body);
    yield { type: 'data', text, bytes: Buffer.byteLength(text) };
  };
  const result = await executeWritingPlan({ logicalRequestId: `fixture-${protocol}`, plan, signal: new AbortController().signal,
    providerFactory: (evidence, deadline) => createProvider(plan.serviceSnapshot, 'invalid-fixture-key', { transport, evidence, deadline }),
    ledger: { reserve: async () => {}, settle: async outcome => { outcomes.push(outcome); } } });
  expect(requests).toHaveLength(2);
  expect(requests.every(request => request.method === 'POST')).toBe(true);
  const firstBody = JSON.parse(requests[0].body!);
  const finalBody = JSON.parse(requests[1].body!);
  expect(finalBody[protocol === 'openai_responses' ? 'input' : 'messages']).toEqual(plan.requests[0].messages);
  expect(finalBody[protocol === 'openai_responses' ? 'instructions' : 'system']).toBe(plan.requests[0].system);
  expect(firstBody[protocol === 'openai_responses' ? 'reasoning' : 'output_config']).toEqual({ effort: 'low' });
  expect(finalBody[protocol === 'openai_responses' ? 'reasoning' : 'output_config']).toBeUndefined();
  expect(outcomes[0]).toMatchObject({ status: 'failed', usage: null, requestId: 'fixture-1' });
  expect(outcomes[1]).toMatchObject({ status: 'succeeded', usage: { input: 120, output: 32 } });
  expect(result.candidates[0].text).toBe('晚风吹过树梢。');
});
