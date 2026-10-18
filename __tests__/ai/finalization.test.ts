import { FINALIZATION_POLICIES, parseAnalysisJson, validateDetectedConflicts, validateExtraction, validateSummary } from '../../src/ai/tasks/finalization';
import { ENTRY_FIELDS } from '../../src/features/entries';
const body = '她一直使用蓝色的剑。\n今天她失去了那把剑。';
const context = { body, entries: [{ id: 'person', type: 'character' as const, name: '小雨', aliases: ['雨儿'] }], allowedFields: ENTRY_FIELDS };
const change = (patch: Record<string, unknown> = {}) => ({ kind: 'update', targetType: 'character', targetName: '雨儿', field: 'ability', before: '旧值', after: '失去蓝剑', evidence: '今天她失去了那把剑。', confidence: 'high', ...patch });

test('extraction requires exact evidence and same-type canonical target, deduplicates proposals', () => {
  const result = validateExtraction(JSON.stringify({ changes: [change(), change()] }), context);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ targetEntryId: 'person', targetName: '小雨', evidenceOffset: body.indexOf('今天') });
  expect(validateExtraction(JSON.stringify({ changes: [change({ targetName: '新角色' })] }), context)[0].kind).toBe('add');
  for (const patch of [{ evidence: '并不存在的句子' }, { targetType: 'relation' }, { field: 'location' }, { targetName: '甲'.repeat(31) }, { after: '甲'.repeat(201) }]) {
    expect(() => validateExtraction(JSON.stringify({ changes: [change(patch)] }), context)).toThrow();
  }
  expect(() => validateExtraction(JSON.stringify({ changes: [change()] }), { ...context, entries: [...context.entries, { ...context.entries[0], id: 'duplicate' }] })).toThrow('不唯一');
});

test('conflict quotes must exist in whitelist sources and a must refer to bound chapter', () => {
  const sources = [{ id: 'chapter:chapter', label: '第一章', text: body, entryId: null }, { id: 'fact:fact', label: '小雨的能力', text: '她只能使用红色的剑。', entryId: 'person' }];
  const conflict = { type: 'setting', severity: 'high', a: { source: 'chapter:chapter', quote: '她一直使用蓝色的剑。' }, b: { source: 'fact:fact', quote: '她只能使用红色的剑。' }, explanation: '颜色约束不一致', suggestions: ['确认是有意误导后可保留'] };
  expect(validateDetectedConflicts(JSON.stringify({ conflicts: [conflict] }), sources, 'chapter:chapter')[0]).toMatchObject({ entryId: 'person', a: { label: '第一章' }, b: { label: '小雨的能力' } });
  for (const patch of [ { b: { source: 'fact:foreign', quote: '她只能使用红色的剑。' } }, { b: { source: 'fact:fact', quote: '伪造引用' } }, { a: { source: 'chapter:other', quote: '她一直使用蓝色的剑。' } } ]) {
    expect(() => validateDetectedConflicts(JSON.stringify({ conflicts: [{ ...conflict, ...patch }] }), sources, 'chapter:chapter')).toThrow();
  }
});

test('summary never truncates a sentence and JSON local tolerance never calls model', () => {
  expect(validateSummary('  她失去了自己的蓝剑。\n随后决定寻找。 ')).toBe('她失去了自己的蓝剑。 随后决定寻找。');
  expect(() => validateSummary('字'.repeat(151))).toThrow('摘要格式');
  expect(parseAnalysisJson('```json\n{"changes":[]}\n```')).toEqual({ changes: [] });
  expect(() => parseAnalysisJson('{broken')).toThrow();
  expect(FINALIZATION_POLICIES.detect_conflicts.defaultEffort).toBe('high');
  expect(FINALIZATION_POLICIES.extract_memory.defaultMaxOutputTokens).toBe(8000);
});
