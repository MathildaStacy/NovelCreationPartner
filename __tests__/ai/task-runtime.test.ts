import { createTaskContextPlan, stableSerialize, type TaskContextPlanInput } from '../../src/ai/context';
import { executeTaskPlan, type AttemptOutcome, type AttemptReservation } from '../../src/ai/runtime';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { aiFailure, ProviderFailure } from '../../src/ai/providers/errors';
import type { GenerateRequest } from '../../src/ai/providers/types';
const source = (patch: Partial<TaskContextPlanInput> = {}): TaskContextPlanInput => ({
  planId: 'preview', workId: 'work', sourceVersion: 'v1', dependencies: { history: 'turn1,turn2', contextRevision: 1 },
  serviceSnapshot: { id: 'service', revision: 1, name: 'fixture', protocol: 'openai_responses', baseUrl: 'https://example.invalid', model: 'fixture-model', options: { ...DEFAULT_OPTIONS, caps: {} }, pricingVersion: null },
  policy: { task: 'ideate', promptVersion: 'ideate-2', schemaVersion: 'options-1', contextPolicyVersion: 'partner-1', route: 'writing', targetInputTokens: 10000, defaultMaxOutputTokens: 4000, defaultEffort: 'medium' },
  system: '回答作者问题，提议不能成为事实', messages: [{ role: 'user', content: '上一个问题' }, { role: 'assistant', content: '上一个回复' }, { role: 'user', content: '这次的问题' }],
  blocks: [{ sourceId: 'fact', sourceVersion: 'v1', state: 'CONFIRMED', atChapterId: null, text: '必要事实', required: true }], ...patch,
});

test('generic plans protect direct history, raw response, schema and full dependency fingerprints', async () => {
  const plan = createTaskContextPlan(source());
  expect(plan.requests[0].messages[2].content).toContain('必要事实');
  expect(plan.requests[0].messages[0].content).toBe('上一个问题');
  expect(plan.requests[0].maxOutputTokens).toBe(4000);
  expect(plan.requests[0].effort).toBe('medium');
  expect(stableSerialize(plan.requests)).toBe(plan.serializedRequest);
  const raw = '  正文\n<<<NCP_JSON>>>\n {"options":[]}  ';
  const outcomes: AttemptOutcome[] = [];
  const result = await executeTaskPlan({ logicalRequestId: 'generic-raw', plan, signal: new AbortController().signal,
    providerFactory: () => ({ async *generate() { yield { type: 'done', text: raw, usage: null, stop: 'end', model: 'fixture' }; }, listModels: async () => [] }),
    ledger: { reserve: async () => {}, settle: async outcome => { outcomes.push(outcome); } } });
  expect(result.candidates[0].text).toBe(raw);
  expect(outcomes[0].usage).toBeNull();
  expect(createTaskContextPlan(source({ dependencies: { history: 'turn1,turn3', contextRevision: 1 } })).dependencyFingerprint).not.toBe(plan.dependencyFingerprint);
  expect(() => createTaskContextPlan(source({ blocks: [{ sourceId: 'fact', sourceVersion: 'v1', state: 'CONFIRMED', atChapterId: null, text: '字'.repeat(19000), required: true }] }))).toThrow('必要上下文');
});

test('explicit schema and effort downgrades share the exact three attempts, no format-repair replay', async () => {
  const plan = createTaskContextPlan(source({ schema: { name: 'fixture', schema: { type: 'object', properties: { options: { type: 'array' } } } } }));
  const sent: GenerateRequest[] = [], reservations: AttemptReservation[] = [], outcomes: AttemptOutcome[] = [];
  const result = await executeTaskPlan({ logicalRequestId: 'shared-downgrades', plan, signal: new AbortController().signal,
    providerFactory: evidence => ({ async *generate(request) {
      sent.push(request);
      if (sent.length <= 2) {
        const base = aiFailure('AI_BAD_REQUEST', { protocol: 'openai_responses', serviceName: 'fixture', model: 'fixture-model', baseUrl: 'https://example.invalid' });
        evidence.failure = new ProviderFailure(base.info, null, false, sent.length === 1 ? 'jsonSchema' : 'effort');
        yield { type: 'error', error: base.info };
      } else yield { type: 'done', text: '{bad json', usage: null, stop: 'end', model: 'fixture' };
    }, listModels: async () => [] }), ledger: { reserve: async attempt => { reservations.push(attempt); }, settle: async outcome => { outcomes.push(outcome); } } });
  expect(sent).toHaveLength(3);
  expect(sent[0].jsonSchema).toEqual(plan.requests[0].jsonSchema);
  expect(sent[1].jsonSchema).toBeUndefined();
  expect(sent[1].system).toContain('Schema：');
  expect(sent[2].effort).toBeUndefined();
  expect(result.candidates[0].text).toBe('{bad json');
  expect(reservations.map(item => item.reason)).toEqual(['initial', 'schema_downgrade', 'effort_downgrade']);
  expect(outcomes).toHaveLength(3);
});

test('known unsupported structured capability builds the prompt fallback before preview', () => {
  const input = source({ schema: { name: 'fixture', schema: { type: 'object', properties: { value: { type: 'string' } } } } });
  input.serviceSnapshot.options.caps.jsonSchema = false;
  const plan = createTaskContextPlan(input);
  expect(plan.requests[0].jsonSchema).toBeUndefined();
  expect(plan.requests[0].system).toContain('只输出一个 JSON 对象');
  expect(plan.requests[0].system).toContain('"value"');
  expect(plan.serializedRequest).toBe(stableSerialize(plan.requests));
});
