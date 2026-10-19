import { createContextPlan, type ContextPlan } from '../../src/ai/context';
import { createRequestBudget, executeWritingPlan, type AttemptLedger, type AttemptOutcome, type AttemptReservation, type ExecuteWritingOptions } from '../../src/ai/runtime';
import { aiFailure, ProviderFailure, type ErrorContext } from '../../src/ai/providers/errors';
import type { AttemptEvidence } from '../../src/ai/providers/httpProvider';
import type { GenerateRequest, Provider, StreamEvent } from '../../src/ai/providers/types';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
const context: ErrorContext = { protocol: 'openai_responses', serviceName: 'fixture', model: 'fixture', baseUrl: 'https://example.invalid' };
function plan(count: 1 | 2 | 3 = 1): Readonly<ContextPlan> {
  return createContextPlan({ planId: 'preview', workId: 'work', sourceVersion: 'body-v1', dependencies: { revision: 1 },
    serviceSnapshot: { id: 'service', revision: 1, name: 'fixture', protocol: context.protocol, baseUrl: context.baseUrl, model: context.model, options: { ...DEFAULT_OPTIONS, caps: {} }, pricingVersion: null },
    task: 'describe', input: { selection: '', before: '前文', after: '', referenceIds: [] }, blocks: [], count });
}
function ledger() {
  const attempts: AttemptReservation[] = [], outcomes: AttemptOutcome[] = [];
  const port: AttemptLedger = { reserve: jest.fn(async attempt => { attempts.push(attempt); }), settle: jest.fn(async outcome => { outcomes.push(outcome); }) };
  return { port, attempts, outcomes };
}
function providerFactory(run: (request: GenerateRequest, evidence: AttemptEvidence) => AsyncIterable<StreamEvent>) {
  return jest.fn((evidence: AttemptEvidence): Provider => ({ generate(request) { return run(request, evidence); }, listModels: async () => [] }));
}
const done = (text = '“候选正文”'): StreamEvent => ({ type: 'done', text, model: 'actual-model', usage: { input: 70, output: 30 }, stop: 'end' });
function options(p = plan(), patch: Partial<ExecuteWritingOptions> = {}) {
  const records = ledger();
  const provider = providerFactory(async function* () { yield done(); });
  return { ...records, provider, value: { logicalRequestId: `operation-${globalThis.crypto.randomUUID()}`, plan: p,
    signal: new AbortController().signal, providerFactory: provider, ledger: records.port, ...patch } satisfies ExecuteWritingOptions };
}
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

test('single POST sends immutable preview and accounts exact known usage', async () => {
  const setup = options();
  let sent: GenerateRequest | undefined;
  setup.value.providerFactory = providerFactory(async function* (request) { sent = request; yield { type: 'text', delta: '候选' }; yield done(); });
  const onText = jest.fn();
  setup.value.onText = onText;
  const result = await executeWritingPlan(setup.value);
  expect(sent?.system).toBe(setup.value.plan.requests[0].system);
  expect(sent?.messages).toEqual(setup.value.plan.requests[0].messages);
  expect(onText).toHaveBeenCalledWith(0, '候选');
  expect(result.candidates[0]).toEqual({ index: 0, text: '候选正文', stop: 'end', error: null });
  expect(setup.attempts).toHaveLength(1);
  expect(setup.outcomes[0]).toMatchObject({ attemptId: setup.attempts[0].id, status: 'succeeded', usage: { input: 70, output: 30 }, responseModel: 'actual-model' });
});

test('three candidates share N+2 POST limit and per-child three limit even on retry storms', async () => {
  const setup = options(plan(3));
  setup.value.providerFactory = providerFactory(async function* (_request, evidence) {
    const base = aiFailure('AI_RATE_LIMIT', context);
    evidence.failure = new ProviderFailure(base.info, 0, true);
    yield { type: 'error', error: base.info };
  });
  const result = await executeWritingPlan(setup.value);
  expect(setup.attempts).toHaveLength(5);
  expect(setup.outcomes).toHaveLength(5);
  for (let i = 0; i < 3; i++) expect(setup.attempts.filter(attempt => attempt.candidateIndex === i).length).toBeLessThanOrEqual(3);
  expect(result.candidates.every(candidate => candidate.error?.code === 'AI_BUDGET_EXCEEDED' || candidate.error?.code === 'AI_RATE_LIMIT')).toBe(true);
  expect(setup.outcomes.every(outcome => outcome.usage === null)).toBe(true);
});

test('effort downgrade and rate retry use the same child total and same output ceiling', async () => {
  const setup = options();
  const sent: GenerateRequest[] = [];
  setup.value.providerFactory = providerFactory(async function* (request, evidence) {
    sent.push(request);
    if (sent.length === 1) {
      const base = aiFailure('AI_BAD_REQUEST', context);
      evidence.failure = new ProviderFailure(base.info, null, false, 'effort'); yield { type: 'error', error: base.info };
    } else if (sent.length === 2) {
      const base = aiFailure('AI_SERVER', context);
      evidence.failure = new ProviderFailure(base.info, 0, true); yield { type: 'error', error: base.info };
    } else yield done();
  });
  const onRetry = jest.fn();
  const result = await executeWritingPlan({ ...setup.value, onRetry });
  expect(sent).toHaveLength(3);
  // Only the real wait-and-retry is reported (S09 "服务繁忙，正在重试（1/2）"), not the parameter downgrade.
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(onRetry).toHaveBeenCalledWith(0, 1, 2);
  expect(sent.map(request => request.effort)).toEqual(['low', undefined, undefined]);
  expect(new Set(sent.map(request => request.maxOutputTokens))).toEqual(new Set([2000]));
  expect(setup.attempts.map(attempt => attempt.reason)).toEqual(['initial', 'effort_downgrade', 'retry']);
  expect(result.capsPatch).toEqual({ effort: false });
});

test('unknown failures keep conservative reservation and stop at shared output budget', async () => {
  const p = plan();
  const setup = options(p, { budget: createRequestBudget('limited', p, { maxReservedOutputTokens: 4000 }), logicalRequestId: 'limited' });
  setup.value.providerFactory = providerFactory(async function* (_request, evidence) {
    const base = aiFailure('AI_SERVER', context); evidence.failure = new ProviderFailure(base.info, 0, true); yield { type: 'error', error: base.info };
  });
  const result = await executeWritingPlan(setup.value);
  expect(setup.attempts).toHaveLength(2);
  expect(result.candidates[0].error?.code).toBe('AI_BUDGET_EXCEEDED');
});

test('streamed prose, truncation, quota and auth never automatically replay', async () => {
  for (const code of ['AI_SERVER', 'AI_AUTH', 'AI_QUOTA'] as const) {
    const setup = options();
    setup.value.providerFactory = providerFactory(async function* (_request, evidence) {
      const base = aiFailure(code, context); evidence.failure = new ProviderFailure(base.info, 0, true);
      yield { type: 'text', delta: '已经生成' }; yield { type: 'error', error: base.info };
    });
    const result = await executeWritingPlan(setup.value);
    expect(setup.attempts).toHaveLength(1);
    expect(result.candidates[0].text).toBe('已经生成');
  }
  const setup = options();
  setup.value.providerFactory = providerFactory(async function* () { yield { ...done('保留的半截正文'), type: 'done', stop: 'length' } as StreamEvent; });
  const result = await executeWritingPlan(setup.value);
  expect(result.candidates[0]).toMatchObject({ text: '保留的半截正文', stop: 'length', error: { code: 'AI_TRUNCATED' } });
  expect(setup.attempts).toHaveLength(1);
});

test('duplicate clicks share a physical request, first subscriber closing keeps second alive', async () => {
  const a = new AbortController(), b = new AbortController();
  let finish!: () => void;
  const setup = options(plan(), { signal: a.signal });
  setup.value.providerFactory = providerFactory(async function* () { await new Promise<void>(resolve => { finish = resolve; }); yield done(); });
  const first = executeWritingPlan(setup.value);
  const firstRejected = first.catch(error => error);
  const second = executeWritingPlan({ ...setup.value, signal: b.signal });
  await flush();
  a.abort();
  expect(await firstRejected).toMatchObject({ code: 'AI_CANCELLED' });
  expect(setup.attempts).toHaveLength(1);
  finish();
  expect((await second).candidates[0].text).toBe('候选正文');
  expect(setup.value.providerFactory).toHaveBeenCalledTimes(1);
});

test('cancel during retry waiting settles failed attempt and never makes another POST', async () => {
  const controller = new AbortController();
  const setup = options(plan(), { signal: controller.signal });
  setup.value.providerFactory = providerFactory(async function* (_request, evidence) {
    const base = aiFailure('AI_SERVER', context); evidence.failure = new ProviderFailure(base.info, 1000, true); yield { type: 'error', error: base.info };
  });
  const running = executeWritingPlan(setup.value);
  const rejected = running.catch(error => error);
  await flush();
  controller.abort();
  expect(await rejected).toMatchObject({ code: 'AI_CANCELLED' });
  await jest.runAllTimersAsync();
  expect(setup.attempts).toHaveLength(1);
  expect(setup.outcomes).toHaveLength(1);
  expect(setup.outcomes[0].usage).toBeNull();
});

test('close before start performs no reservation and no physical POST', async () => {
  const controller = new AbortController();
  const setup = options(plan(), { signal: controller.signal });
  const running = executeWritingPlan(setup.value);
  controller.abort();
  await expect(running).rejects.toMatchObject({ code: 'AI_CANCELLED' });
  await flush();
  expect(setup.attempts).toHaveLength(0);
  expect(setup.provider).not.toHaveBeenCalled();
});

test('deadline is shared across retries and expired preview cannot send', async () => {
  const p = plan();
  const setup = options(p, { logicalRequestId: 'expired', budget: createRequestBudget('expired', p, { deadlineAt: Date.now() - 1 }) });
  await expect(executeWritingPlan(setup.value)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  expect(setup.attempts).toHaveLength(0);
});

test('stopping one candidate during retry waiting preserves independent candidate result', async () => {
  const a = new AbortController(), b = new AbortController();
  const setup = options(plan(2), { candidateSignals: [a.signal, b.signal] });
  let calls = 0;
  setup.value.providerFactory = providerFactory(async function* (_request, evidence) {
    calls++;
    if (calls === 1) {
      const base = aiFailure('AI_SERVER', context); evidence.failure = new ProviderFailure(base.info, 1000, true); yield { type: 'error', error: base.info };
    } else yield done('第二个候选');
  });
  const running = executeWritingPlan(setup.value);
  await flush();
  a.abort();
  const result = await running;
  expect(result.candidates[0].error?.code).toBe('AI_CANCELLED');
  expect(result.candidates[1].text).toBe('第二个候选');
  await jest.runAllTimersAsync();
  expect(setup.attempts).toHaveLength(2);
});

test('reservation failure prevents that physical POST and settle failure does not replay paid request', async () => {
  const reserve = options();
  reserve.port.reserve = jest.fn(async () => { throw new Error('SQLITE_FULL'); });
  await expect(executeWritingPlan(reserve.value)).rejects.toThrow('SQLITE_FULL');
  expect(reserve.provider).not.toHaveBeenCalled();
  const settle = options();
  settle.port.settle = jest.fn(async () => { throw new Error('SQLITE_FULL'); });
  await expect(executeWritingPlan(settle.value)).rejects.toThrow('SQLITE_FULL');
  expect(settle.provider).toHaveBeenCalledTimes(1);
});
