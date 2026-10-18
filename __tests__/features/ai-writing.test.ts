import { freshDb, tickingClock } from '../helpers/db';
import type { Db } from '../../src/data/db';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as services from '../../src/features/modelServices';
import * as ai from '../../src/features/ai';
import * as usage from '../../src/features/aiUsage';
import * as prefs from '../../src/features/prefs';
import { createRequestBudget } from '../../src/ai/runtime';
import { createContextPlan } from '../../src/ai/context';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';

jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'test-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));
let d: Db;
beforeEach(async () => { tickingClock(); d = await freshDb(); });
afterEach(async () => { await d.close(); });
async function fixture() {
  const w = await works.create({ premise: '海上寻镜', title: '潮汐' });
  const volume = (await chapters.list(w.id))[0].volume;
  const ch = await chapters.create({ workId: w.id, volumeId: volume.id, title: '起点', kind: 'main' });
  await chapters.saveBody(ch.id, '林宇握紧古镜。海风吹来。', 0);
  const svc = await services.save({ name: 'Fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'test-model', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'test-key');
  return { w, ch, svc: await services.get(svc.service.id) };
}

test('new count is one, persisted explicit preferences remain unchanged', async () => {
  expect(await prefs.get('candidateCount')).toBe(1);
  await prefs.set('candidateCount', 3);
  expect(await prefs.get('candidateCount')).toBe(3);
});
test('preview scopes explicit references and rejects cross-work IDs', async () => {
  const { w, ch } = await fixture();
  const e = await entries.create({ workId: w.id, type: 'character', name: '林宇', facts: [{ field: 'identity', value: '船医' }] });
  const plan = await ai.prepareWriting({ chapterId: ch.id, range: { start: 0, end: 0 }, task: 'describe', referenceIds: [e.id] });
  expect(plan.serializedRequest).toContain('船医');
  expect(plan.blocks.find(b => b.sourceId === e.id)?.required).toBe(true);
  const empty = await ai.prepareWriting({ chapterId: ch.id, range: { start: 0, end: 0 }, task: 'describe', referenceIds: [] });
  expect(empty.serializedRequest).not.toContain('船医');
  const other = await works.create({ premise: '另一本' });
  const wrong = await entries.create({ workId: other.id, type: 'character', name: '林宇', facts: [] });
  await expect(ai.prepareWriting({ chapterId: ch.id, range: { start: 0, end: 0 }, task: 'describe', referenceIds: [wrong.id] })).rejects.toMatchObject({ code: 'VALIDATION' });
});
test('missing D01 and stale dependency stop before any attempt', async () => {
  const { w, ch } = await fixture();
  const plan = await ai.prepareWriting({ chapterId: ch.id, range: { start: 0, end: 0 }, task: 'describe' });
  await expect(ai.generateWriting(plan, { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  await ai.acknowledgeHost('example.test');
  await works.update(w.id, { title: '新标题' });
  await expect(ai.generateWriting(plan, { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
  expect((await usage.summary()).attempts).toBe(0);
});
test('adoption snapshots atomically, rejects old body and retains undo recovery', async () => {
  const { ch } = await fixture();
  const plan = await ai.prepareWriting({ chapterId: ch.id, range: { start: 0, end: 2 }, task: 'quickEdit', op: 'polish' });
  const before = (await chapters.get(ch.id)).body;
  const result = await ai.applyWriting(plan, '林宇');
  expect(result.body).toBe(before);
  expect(await d.get("SELECT id FROM chapter_versions WHERE chapter_id = ? AND reason = 'before_ai'", [ch.id])).toBeDefined();
  await chapters.saveBody(ch.id, '作者已经另改正文。', 0);
  await expect(ai.applyWriting(plan, '旧候选')).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
  expect((await chapters.get(ch.id)).body).toBe('作者已经另改正文。');
});
test('durable reservation is atomic, settlement idempotent and unknown stays unknown after crash', async () => {
  const { w, ch, svc } = await fixture();
  const plan = createContextPlan({ planId: 'p', workId: w.id, sourceVersion: 'v', dependencies: {}, serviceSnapshot: { ...svc, pricingVersion: null }, task: 'describe', input: { selection: '', before: '', after: '' }, blocks: [] });
  const budget = createRequestBudget('req', plan, { maxPhysicalPosts: 1 });
  await usage.begin(plan, budget, ch.id);
  const reserve = (id: string) => usage.ledger.reserve({ id, logicalRequestId: 'req', workId: w.id, task: 'describe', serviceId: svc.id, serviceRevision: svc.revision, model: svc.model, candidateIndex: 0, attemptNumber: 1, reason: 'initial', startedAt: new Date().toISOString(), estimatedInputTokens: 100, reservedOutputTokens: 2000 }, budget);
  const results = await Promise.allSettled([reserve('a'), reserve('b')]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect((await usage.summary()).unknown).toBe(1);
  await usage.recoverInterrupted();
  const item = await d.get<{ status: string; actual_output: null; cost: null }>('SELECT * FROM ai_attempts');
  expect(item).toMatchObject({ status: 'interrupted', actual_output: null, cost: null });
  expect((await usage.summary()).cost).toBeNull();
});
