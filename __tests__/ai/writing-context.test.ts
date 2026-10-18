import { createHash } from 'crypto';
import { createContextPlan, estimateTokens, fingerprint, stableSerialize, type ContextBlock, type ContextPlanInput } from '../../src/ai/context';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { normalizeWritingOutput } from '../../src/ai/tasks/writing';

const block = (patch: Partial<ContextBlock> = {}): ContextBlock => ({ sourceId: 'person', sourceVersion: 'v1', state: 'CONFIRMED', atChapterId: 'chapter', text: '小明的剑是蓝色的。', required: true, priority: 4, ...patch });
const input = (patch: Partial<ContextPlanInput> = {}): ContextPlanInput => ({
  planId: 'preview', workId: 'work', sourceVersion: 'body-v1', dependencies: { contextRevision: 1, order: 'chapter' },
  serviceSnapshot: { id: 'service', revision: 2, name: 'fixture', protocol: 'openai_responses', baseUrl: 'https://example.invalid', model: 'fixture', options: { ...DEFAULT_OPTIONS, caps: {} }, pricingVersion: null },
  task: 'describe', input: { selection: '', before: '小明拔出剑。', after: '', referenceIds: ['person'], extra: '保留蓝色的剑' }, blocks: [block()], ...patch,
});

test('offline SHA-256 covers Unicode and canonical object key order', () => {
  for (const value of [null, '', '甲😀𠮷', { z: '设定', a: 1 }, { a: 'a'.repeat(1024) }]) {
    expect(fingerprint(value)).toBe(createHash('sha256').update(stableSerialize(value)).digest('hex'));
  }
  expect(fingerprint({ b: 2, a: 1 })).toBe(fingerprint({ a: 1, b: 2 }));
  expect(estimateTokens('中文abcd')).toBe(4);
});

test('preview contains the exact deeply frozen requests, credentials are whitelisted out', () => {
  const source = input();
  Object.assign(source.serviceSnapshot, { secret: 'must-never-enter-plan', key: 'also-secret' });
  const plan = createContextPlan(source);
  expect(stableSerialize(plan.requests)).toBe(plan.serializedRequest);
  expect(plan.requests).toHaveLength(1);
  expect(plan.requests[0].maxOutputTokens).toBe(2000);
  expect(plan.requests[0].effort).toBe('low');
  expect(JSON.stringify(plan)).not.toMatch(/must-never|also-secret/);
  expect(Object.isFrozen(plan.requests[0].messages[0])).toBe(true);
  expect(Object.isFrozen(plan.blocks[0])).toBe(true);
  source.blocks[0].text = 'changed';
  source.serviceSnapshot.options.contextBudget = 9000;
  expect(plan.blocks[0].text).toContain('蓝色');
  expect(plan.serviceSnapshot.options.contextBudget).toBe(DEFAULT_OPTIONS.contextBudget);
});

test('required facts grow past soft target and never silently trim at service limit', () => {
  const plan = createContextPlan(input({ blocks: [block({ text: '蓝'.repeat(5200) })] }));
  expect(plan.estimatedInputTokens).toBeGreaterThan(6000);
  expect(plan.blocks).toHaveLength(1);
  expect(plan.omittedReasons).toHaveLength(0);
  expect(() => createContextPlan(input({ blocks: [block({ text: '蓝'.repeat(20000) })] }))).toThrow('必要上下文');
});

test('optional blocks trim whole facts and describe cannot restore removed references', () => {
  const plan = createContextPlan(input({ blocks: [block(), block({ sourceId: 'removed', text: '不能再带入的人物', required: false }), block({ sourceId: 'summary', priority: 7, text: '后'.repeat(6000), required: false })] }));
  expect(plan.blocks.map(item => item.sourceId)).toEqual(['person']);
  expect(plan.omittedReasons).toEqual([
    { sourceId: 'removed', reason: 'outside_reference_scope' },
    { sourceId: 'summary', reason: 'optional_budget' },
  ]);
  expect(plan.serializedRequest).not.toContain('不能再带入的人物');
  expect(() => createContextPlan(input({ blocks: [block({ sourceId: 'removed' })] }))).toThrow('作者选择');
});

test('fingerprints include all dependency, policy, selection, order, fact and service changes', () => {
  const original = createContextPlan(input());
  const modifications: Partial<ContextPlanInput>[] = [
    { sourceVersion: 'body-v2' }, { dependencies: { contextRevision: 2, order: 'chapter' } },
    { dependencies: { contextRevision: 1, order: 'different-order' } },
    { input: { ...input().input, extra: '保持红色' } }, { blocks: [block({ sourceVersion: 'v2' })] },
    { serviceSnapshot: { ...input().serviceSnapshot, revision: 3 } },
    { serviceSnapshot: { ...input().serviceSnapshot, pricingVersion: 'pricing-2' } },
    { variantOffset: 1 }, { count: 2 },
  ];
  for (const change of modifications) expect(createContextPlan(input(change)).dependencyFingerprint).not.toBe(original.dependencyFingerprint);
  expect(createContextPlan(input({ planId: 'another-preview-id' })).dependencyFingerprint).toBe(original.dependencyFingerprint);
});

test('candidate directions and explicit service settings survive plan generation', () => {
  const source = input({ count: 3 });
  source.serviceSnapshot.options.effort = 'high';
  source.serviceSnapshot.options.maxOutputTokens = 3500;
  const plan = createContextPlan(source);
  expect(plan.requests.map(request => request.messages[0].content)).toEqual([
    expect.stringContaining('动作和节奏'), expect.stringContaining('感官和环境'), expect.stringContaining('心理和情绪'),
  ]);
  expect(plan.requests.every(request => request.maxOutputTokens === 3500 && request.effort === 'high')).toBe(true);
  expect(() => createContextPlan(input({ contextWindowTokens: 100 }))).toThrow('额度不足');
});

test('long expansion uses previewed 4k output or asks to narrow the selection', () => {
  const quick = (selection: string) => input({ task: 'quickEdit', input: { selection, before: '', after: '', op: 'expand' }, blocks: [] });
  expect(createContextPlan(quick('字'.repeat(900))).maxOutputTokens).toBe(4000);
  expect(() => createContextPlan(quick('字'.repeat(1600)))).toThrow('缩小范围');
  expect(normalizeWritingOutput(' “　第一行\r\n  第二行” ')).toBe('第一行\n第二行');
});
