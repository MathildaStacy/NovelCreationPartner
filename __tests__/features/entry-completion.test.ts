import { db, setDb } from '../../src/data/db';
import { freshDb, tickingClock } from '../helpers/db';
import * as entries from '../../src/features/entries';
import * as works from '../../src/features/works';
import * as models from '../../src/features/modelServices';
import * as completion from '../../src/features/entryCompletion';
import * as routes from '../../src/features/taskServices';
import * as runtime from '../../src/ai/runtime';
import * as conflicts from '../../src/features/conflicts';
import * as chapters from '../../src/features/chapters';
import * as relations from '../../src/features/relations';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'test-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));
beforeEach(async () => { tickingClock(); await freshDb(); });
afterEach(async () => { await db().close(); setDb(null); });
async function fixture() {
  const work = await works.create({ premise: '海上寻找钥匙' });
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇', facts: [{ field: 'goal', value: '回家' }] });
  const service = await models.save({ name: 'Fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'test', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'test-key');
  return { work, entry, service: service.service };
}
function output(raw: string, mutate?: () => Promise<void>) {
  return jest.spyOn(runtime, 'executeTaskPlan').mockImplementation(async options => {
    await mutate?.();
    return { logicalRequestId: options.logicalRequestId, planId: options.plan.planId, candidates: [{ index: 0, text: raw, stop: 'end', error: null }], capsPatch: {} };
  });
}

test('one selected-field operation writes proposals only, filters unselected output and author confirms later', async () => {
  const { entry } = await fixture();
  const plan = await completion.prepare(entry.id, ['goal'], '保留现有设定');
  expect(Object.isFrozen(plan)).toBe(true); expect(plan.requests).toHaveLength(1);
  await expect(completion.complete(plan, { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  const run = output(JSON.stringify({ facts: [{ field: 'goal', value: '找到钥匙后回家', reason: '遵循目标' }, { field: 'secret', value: '不能擅自加', reason: '不选' }] }));
  try {
    const result = await completion.complete(plan, { signal: new AbortController().signal, confirmedHost: 'example.test' });
    expect(result).toHaveLength(1); expect(run).toHaveBeenCalledTimes(1);
    const current = await entries.get(entry.id); expect(current.facts.find(f => f.field === 'goal')?.value).toBe('回家');
    expect(current.proposedFacts[0].value).toBe('找到钥匙后回家');
    await entries.confirmFact(result[0].factId);
    expect((await entries.get(entry.id)).facts.find(f => f.field === 'goal')?.value).toBe('找到钥匙后回家');
  } finally { run.mockRestore(); }
});

test('stale late output, cancellation, invalid formats and retired entries never write proposals', async () => {
  const { entry } = await fixture();
  const plan = await completion.prepare(entry.id, ['goal']);
  const run = output(JSON.stringify({ facts: [{ field: 'goal', value: '新目标', reason: '' }] }), () => entries.update(entry.id, { summary: '作者已更改' }));
  try {
    await expect(completion.complete(plan, { signal: new AbortController().signal, confirmedHost: 'example.test' })).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
    expect((await entries.get(entry.id)).proposedFacts).toEqual([]);
    const second = await completion.prepare(entry.id, ['goal']);
    run.mockImplementationOnce(async options => ({ logicalRequestId: options.logicalRequestId, planId: options.plan.planId, candidates: [{ index: 0, text: '{broken', stop: 'end', error: null }], capsPatch: {} }));
    await expect(completion.complete(second, { signal: new AbortController().signal, confirmedHost: 'example.test' })).rejects.toMatchObject({ code: 'AI_FORMAT' });
    const stopped = new AbortController(); stopped.abort();
    await expect(completion.complete(await completion.prepare(entry.id, ['goal']), { signal: stopped.signal })).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect((await entries.get(entry.id)).proposedFacts).toEqual([]);
    await entries.retire(entry.id); await expect(completion.prepare(entry.id, ['goal'])).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  } finally { run.mockRestore(); }
});

test('service bindings use explicit saved service and refuse broken binding instead of switching hosts', async () => {
  const { service } = await fixture();
  const second = await models.save({ name: 'Bound', protocol: 'openai_responses', baseUrl: 'https://bound.test/v1', model: 'bound', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'test-key');
  expect((await routes.getTaskService('writing'))?.id).toBe(service.id);
  await routes.setTaskService('writing', second.service.id);
  expect((await routes.getTaskService('writing'))?.id).toBe(second.service.id);
  await models.remove(second.service.id);
  await expect(routes.getTaskService('writing')).rejects.toMatchObject({ code: 'NO_SERVICE' });
  await routes.setTaskService('writing', null); expect((await routes.getTaskService('writing'))?.id).toBe(service.id);
});

test('a change between the first entry read and service lookup cannot stamp stale context as current', async () => {
  const { entry } = await fixture();
  const get = entries.get;
  const read = jest.spyOn(entries, 'get').mockImplementationOnce(async (...args) => {
    const old = await get(...args);
    await entries.update(entry.id, { facts: [{ field: 'goal', value: '留在海上' }] });
    return old;
  });
  try {
    await expect(completion.prepare(entry.id, ['goal'])).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
    expect((await entries.get(entry.id)).facts.find(f => f.field === 'goal')?.value).toBe('留在海上');
  } finally { read.mockRestore(); }
});

test.each(['before-send', 'during-send'])('resolved conflicts invalidate completion %s without writing suggestions', async moment => {
  const { entry, work } = await fixture();
  await db().run(`INSERT INTO conflicts (id,work_id,entry_id,type,severity,a_label,a_ref,a_quote,b_label,b_ref,b_quote,
    explanation,suggestions,status,fingerprint,created_at) VALUES ('old-conflict',?,?,'setting','medium','档案',?,'回家','正文','chapter:unavailable','留在海上','目标不同','[]','open','fixture','2026-10-18')`, [work.id, entry.id, entry.id]);
  const plan = await completion.prepare(entry.id, ['goal']);
  const resolve = () => conflicts.resolve('old-conflict', { status: 'fixed_text' });
  const run = output(JSON.stringify({ facts: [{ field: 'goal', value: '基于旧冲突的建议', reason: '' }] }), moment === 'during-send' ? resolve : undefined);
  try {
    if (moment === 'before-send') { await resolve(); }
    await expect(completion.complete(plan, { signal: new AbortController().signal, confirmedHost: 'example.test' })).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
    expect(run).toHaveBeenCalledTimes(moment === 'before-send' ? 0 : 1);
    expect((await entries.get(entry.id)).proposedFacts).toEqual([]);
  } finally { run.mockRestore(); }
});

test('changing a summarized chapter kind invalidates the preview before sending', async () => {
  const { entry, work } = await fixture();
  const volume = (await chapters.list(work.id))[0].volume;
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, title: '原正文章节' });
  await db().run('UPDATE chapters SET summary=? WHERE id=?', ['原正文章节的摘要', chapter.id]);
  const plan = await completion.prepare(entry.id, ['goal']);
  expect(plan.blocks.some(block => block.sourceId === `summary:${chapter.id}`)).toBe(true);
  const run = output(JSON.stringify({ facts: [{ field: 'goal', value: '旧摘要产生的建议', reason: '' }] }));
  try {
    await chapters.update(chapter.id, { kind: 'extra' });
    await expect(completion.complete(plan, { signal: new AbortController().signal, confirmedHost: 'example.test' })).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
    expect(run).not.toHaveBeenCalled(); expect((await entries.get(entry.id)).proposedFacts).toEqual([]);
  } finally { run.mockRestore(); }
});

test('completion protects the direction, kind and note of formal relationships as required context', async () => {
  const { entry, work } = await fixture();
  const peer = await entries.create({ workId: work.id, type: 'character', name: '沈青', facts: [{ field: 'goal', value: '守护港口' }] });
  const relation = await relations.upsert({ fromEntryId: peer.id, toEntryId: entry.id, kind: '信任', note: '仅向林宇交付钥匙' });
  const plan = await completion.prepare(entry.id, ['goal']);
  expect(plan.blocks.find(block => block.sourceId === `relation:${relation.id}`)).toMatchObject({
    required: true, state: 'CONFIRMED', text: '有向关系：沈青 —信任→ 林宇：仅向林宇交付钥匙',
  });
  expect(plan.omittedReasons.some(block => block.sourceId === `relation:${relation.id}`)).toBe(false);
});
