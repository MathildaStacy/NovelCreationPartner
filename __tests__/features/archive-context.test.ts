import { db, setDb, type Db } from '../../src/data/db';
import { freshDb, tickingClock } from '../helpers/db';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as relations from '../../src/features/relations';
import * as conflicts from '../../src/features/conflicts';
import * as conversations from '../../src/features/conversations';
import * as partner from '../../src/features/partner';
import * as ai from '../../src/features/ai';
import * as models from '../../src/features/modelServices';
import * as runtime from '../../src/ai/runtime';
import { on } from '../../src/features/events';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { PARTNER_SEPARATOR } from '../../src/ai/tasks/partner';

jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'test-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));
beforeEach(async () => { tickingClock(); await freshDb(); });
afterEach(async () => { jest.restoreAllMocks(); await db().close(); setDb(null); });

async function fixture() {
  const work = await works.create({ premise: '海上的谜团' });
  const volume = (await chapters.list(work.id))[0].volume;
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, title: '当前章' });
  await chapters.saveBody(chapter.id, '林宇站在船头。', 0);
  const service = (await models.save({ name: 'Fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'test', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'test-key')).service;
  return { workId: work.id, chapter, volume, service: await models.get(service.id) };
}
async function conflict(workId: string, entryId: string, chapterId: string, id = 'conflict') {
  await db().run(`INSERT INTO conflicts (id,work_id,chapter_id,entry_id,type,severity,a_label,a_ref,a_quote,b_label,b_ref,b_quote,explanation,suggestions,status,fingerprint,created_at)
    VALUES (?,?,?,?,'setting','high','正式档案',?,'只能操控潮汐','正文',?,'火焰从他手心升起','能力互相矛盾','[]','open',?,'2026-10-18')`, [id, workId, chapterId, entryId, entryId, chapterId, id]);
}
async function proposed(entryId: string, field: string, value: string, chapterId: string, id: string) {
  await db().run(`INSERT INTO entry_facts (id,entry_id,field,value,state,from_chapter_id,source_kind,created_at)
    VALUES (?,?,?,?,'PROPOSED',?,'partner','2026-10-18')`, [id, entryId, field, value, chapterId]);
}
async function namedEntries(workId: string, count: number) {
  const result = [];
  for (const suffix of [...'甲乙丙丁戊己庚辛壬癸子丑寅'].slice(0, count)) {
    result.push(await entries.create({ workId, type: 'character', name: `人物${suffix}`, aliases: suffix === '甲' ? ['船长'] : [],
      facts: [{ field: 'identity', value: '守护海域的航海者'.repeat(37) }, { field: 'ability', value: '只能操纵海水和潮汐'.repeat(33) }] }));
  }
  return result;
}

test('partner keeps all thirteen direct name/alias matches above its soft target and refuses a smaller hard limit without a request', async () => {
  const { workId, service } = await fixture();
  const items = await namedEntries(workId, 13);
  const query = ['船长', ...items.slice(1).map(item => item.name)].join('、') + '应该怎样合作？';
  const plan = await partner.prepareSend(null, query, { workId });
  expect(plan.estimatedInputTokens).toBeGreaterThan(10000);
  expect(plan.policyVersion).toBe('partner-2');
  for (const item of items) expect(plan.blocks.find(block => block.sourceId === item.id)?.required).toBe(true);
  expect(plan.omittedReasons.filter(item => items.some(entry => entry.id === item.sourceId))).toEqual([]);
  await models.save({ id: service.id, revision: service.revision, name: service.name, protocol: service.protocol, baseUrl: service.baseUrl, model: service.model,
    options: { ...service.options, contextBudget: 8000 } });
  await expect(partner.prepareSend(null, query, { workId })).rejects.toMatchObject({ code: 'AI_CONTEXT_TOO_LONG' });
  expect(await db().get('SELECT id FROM ai_attempts')).toBeUndefined();
  expect(await conversations.list(workId)).toEqual([]);
});

test('quick edit protects nine directly mentioned entities while describe retains its explicit eight-reference limit', async () => {
  const { workId, chapter } = await fixture();
  const items = await namedEntries(workId, 9);
  const body = ['船长', ...items.slice(1).map(item => item.name)].join('、') + '一起登船。';
  await chapters.saveBody(chapter.id, body, 0);
  const plan = await ai.prepareWriting({ chapterId: chapter.id, range: { start: 0, end: body.length }, task: 'quickEdit', op: 'polish' });
  expect(plan.estimatedInputTokens).toBeGreaterThan(6000);
  expect(plan.policyVersion).toBe('writing-3');
  for (const item of items) expect(plan.blocks.find(block => block.sourceId === item.id)?.required).toBe(true);
  await expect(ai.prepareWriting({ chapterId: chapter.id, range: { start: 0, end: 0 }, task: 'describe', referenceIds: items.map(item => item.id) })).rejects.toMatchObject({ code: 'VALIDATION' });
});

test('chapter scope preserves effective facts, directed relations and both conflict quotes without promoting proposals or future facts', async () => {
  const { workId, chapter: first, volume } = await fixture();
  const current = await chapters.create({ workId, volumeId: volume.id, title: '中章' });
  const future = await chapters.create({ workId, volumeId: volume.id, title: '后章' });
  const a = await entries.create({ workId, type: 'character', name: '林宇', facts: [{ field: 'ability', value: '只能操控潮汐', fromChapterId: first.id }] });
  const b = await entries.create({ workId, type: 'character', name: '沈汐' });
  const retired = await entries.create({ workId, type: 'character', name: '旧船长' });
  await entries.update(a.id, { facts: [{ field: 'ability', value: '未来才学会控火', fromChapterId: future.id }] });
  const active = await relations.upsert({ fromEntryId: a.id, toEntryId: b.id, kind: '保护', note: '不能伤害沈汐', fromChapterId: first.id });
  const futureRelation = await relations.upsert({ fromEntryId: b.id, toEntryId: a.id, kind: '追捕', fromChapterId: future.id });
  const ended = await relations.upsert({ fromEntryId: a.id, toEntryId: b.id, kind: '敌对', toChapterId: first.id });
  const withRetired = await relations.upsert({ fromEntryId: a.id, toEntryId: retired.id, kind: '追随' });
  await entries.retire(retired.id);
  await conflict(workId, a.id, current.id);
  await conflict(workId, a.id, future.id, 'future-conflict');
  await proposed(a.id, 'goal', '可能前往远海', current.id, 'proposal-current');
  await proposed(a.id, 'secret', '未来才提出的秘密', future.id, 'proposal-future');
  await chapters.saveBody(current.id, '林宇看着远海。', 0);
  const blocks = await partner.previewContext(workId, { kind: 'chapter', chapterId: current.id, includeProposed: true });
  expect(blocks.find(block => block.sourceId === a.id)).toMatchObject({ required: true, text: expect.stringContaining('只能操控潮汐') });
  expect(blocks.find(block => block.sourceId === `relation:${active.id}`)).toMatchObject({ required: true, text: '有向关系：林宇 —保护→ 沈汐：不能伤害沈汐' });
  expect(blocks.find(block => block.sourceId === 'conflict:conflict')).toMatchObject({ required: true, state: 'CONFLICTED', text: expect.stringContaining('能力互相矛盾') });
  expect(blocks.find(block => block.sourceId === 'conflict:conflict')?.text).toContain('只能操控潮汐');
  expect(blocks.find(block => block.sourceId === 'conflict:conflict')?.text).toContain('火焰从他手心升起');
  expect(blocks.find(block => block.sourceId === `proposed:${a.id}`)).toMatchObject({ required: false, state: 'PROPOSED', text: expect.stringContaining('可能前往远海') });
  const text = blocks.map(block => block.text).join('\n');
  expect(text).not.toContain('未来才');
  for (const id of [futureRelation.id, ended.id, withRetired.id]) expect(blocks.find(block => block.sourceId === `relation:${id}`)).toBeUndefined();
  expect(blocks.find(block => block.sourceId === 'conflict:future-conflict')).toBeUndefined();
  const writing = await ai.prepareWriting({ chapterId: current.id, range: { start: 0, end: 0 }, task: 'describe', referenceIds: [a.id] });
  expect(writing.blocks.find(block => block.sourceId === `relation:${active.id}`)?.required).toBe(true);
  expect(writing.blocks.find(block => block.sourceId === 'conflict:conflict')?.required).toBe(true);
  expect(writing.serializedRequest).not.toContain('可能前往远海');
  const confirmed = await partner.previewContext(workId, { kind: 'confirmed', chapterId: null, includeProposed: false }, '林宇');
  expect(confirmed.find(block => block.sourceId === `relation:${ended.id}`)).toBeUndefined();
  expect(confirmed.map(block => block.text).join('\n')).toContain('未来才学会控火');
});

test('conflict-only changes stop partner before sending and stop a late structured reply while retaining its prose', async () => {
  const { workId, chapter } = await fixture();
  const entry = await entries.create({ workId, type: 'character', name: '林宇', facts: [{ field: 'ability', value: '只能操控潮汐' }] });
  await conflict(workId, entry.id, chapter.id);
  const conversation = await conversations.create(workId);
  const stale = await partner.prepareSend(conversation.id, '林宇应该怎样行动？');
  await conflicts.resolve('conflict', { status: 'fixed_text' });
  const run = jest.spyOn(runtime, 'executeTaskPlan');
  await expect(partner.send(stale, { signal: new AbortController().signal, confirmedHost: 'example.test' })).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
  expect(run).not.toHaveBeenCalled();
  expect(await db().get('SELECT id FROM ai_attempts')).toBeUndefined();
  const plan = await partner.prepareSend(conversation.id, '林宇应该怎样行动？');
  const raw = `可以保留的建议${PARTNER_SEPARATOR}${JSON.stringify({ known: [], questions: [], options: [] })}`;
  run.mockImplementationOnce(async options => {
    options.onText?.(0, raw);
    await conflicts.reopen('conflict');
    return { logicalRequestId: options.logicalRequestId, planId: options.plan.planId, candidates: [{ index: 0, text: raw, stop: 'end', error: null }], capsPatch: {} };
  });
  await expect(partner.send(plan, { signal: new AbortController().signal, confirmedHost: 'example.test' })).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
  expect((await conversations.messages(conversation.id)).at(-1)).toMatchObject({ content: '可以保留的建议', status: 'stopped', structured: null });
});

test('conflict-only changes stop writing before and during generation', async () => {
  const { workId, chapter } = await fixture();
  const entry = await entries.create({ workId, type: 'character', name: '林宇' });
  await conflict(workId, entry.id, chapter.id);
  const action = { chapterId: chapter.id, range: { start: 0, end: 2 }, task: 'quickEdit' as const, op: 'polish' as const };
  const stale = await ai.prepareWriting(action);
  await conflicts.resolve('conflict', { status: 'fixed_text' });
  const run = jest.spyOn(runtime, 'executeWritingPlan');
  await expect(ai.generateWriting(stale, { signal: new AbortController().signal, confirmedHost: 'example.test' })).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
  expect(run).not.toHaveBeenCalled();
  expect(await db().get('SELECT id FROM ai_attempts')).toBeUndefined();
  const plan = await ai.prepareWriting(action);
  run.mockImplementationOnce(async options => {
    await conflicts.reopen('conflict');
    return { logicalRequestId: options.logicalRequestId, planId: options.plan.planId, candidates: [{ index: 0, text: '旧设定候选', stop: 'end', error: null }], capsPatch: {} };
  });
  await expect(ai.generateWriting(plan, { signal: new AbortController().signal, confirmedHost: 'example.test' })).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
  expect((await chapters.get(chapter.id)).body).toBe('林宇站在船头。');
});

test.each(['conflict', 'setting'])('a %s change blocks old candidate insertion without touching unchanged body or creating before_ai', async change => {
  const { workId, chapter } = await fixture();
  const entry = await entries.create({ workId, type: 'character', name: '林宇', facts: [{ field: 'ability', value: '只能操控潮汐' }] });
  await conflict(workId, entry.id, chapter.id);
  const plan = await ai.prepareWriting({ chapterId: chapter.id, range: { start: 0, end: 2 }, task: 'quickEdit', op: 'polish' });
  if (change === 'conflict') await conflicts.resolve('conflict', { status: 'fixed_text' });
  else await entries.update(entry.id, { facts: [{ field: 'ability', value: '现在只能操纵风' }] });
  await expect(ai.applyWriting(plan, '旧候选仍可复制')).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
  expect((await chapters.get(chapter.id)).body).toBe('林宇站在船头。');
  expect(await db().get("SELECT id FROM chapter_versions WHERE chapter_id = ? AND reason = 'before_ai'", [chapter.id])).toBeUndefined();
});

test.each(['conflict', 'setting'])('a writing candidate queued behind an in-flight %s edit is rejected after that edit commits', async change => {
  const { workId, chapter } = await fixture();
  const entry = await entries.create({ workId, type: 'character', name: '林宇', facts: [{ field: 'ability', value: '只能操控潮汐' }] });
  await conflict(workId, entry.id, chapter.id);
  const plan = await ai.prepareWriting({ chapterId: chapter.id, range: { start: 0, end: 2 }, task: 'quickEdit', op: 'polish' });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const changed = db().transaction(async tx => {
    if (change === 'conflict') await tx.run("UPDATE conflicts SET status = 'fixed_text' WHERE id = 'conflict'");
    else await tx.run('UPDATE entry_facts SET value = ? WHERE id = ?', ['现在只能操纵风', entry.facts[0].id]);
    entered(); await gate;
  });
  await started;
  const events: string[] = [];
  on('chapter.saved', () => { events.push('saved'); });
  on('versions.changed', () => { events.push('version'); });
  const applying = ai.applyWriting(plan, '旧设定候选');
  release(); await changed;
  await expect(applying).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
  expect(events).toEqual([]);
  expect((await chapters.get(chapter.id)).body).toBe('林宇站在船头。');
  expect(await db().get("SELECT id FROM chapter_versions WHERE chapter_id = ? AND reason = 'before_ai'", [chapter.id])).toBeUndefined();
});

test('a competing archive edit cannot commit between writing dependency reads and the body write', async () => {
  const { workId, chapter } = await fixture();
  const entry = await entries.create({ workId, type: 'character', name: '林宇', facts: [{ field: 'ability', value: '只能操控潮汐' }] });
  const plan = await ai.prepareWriting({ chapterId: chapter.id, range: { start: 0, end: 2 }, task: 'quickEdit', op: 'polish' });
  const d = db(), transaction = d.transaction.bind(d);
  let injected = false, inside = false, change: Promise<void> | undefined;
  const order: string[] = [], eventStates: boolean[] = [];
  on('chapter.saved', () => { eventStates.push(inside); });
  const intercept = jest.spyOn(d, 'transaction').mockImplementation(fn => transaction(async tx => {
    const writingTransaction = !injected;
    if (writingTransaction) inside = true;
    const scoped: Db = { ...tx,
      async all<T>(sql: string, params = []) {
        const result = await tx.all<T>(sql, params);
        if (!injected && sql.startsWith('SELECT * FROM conflicts')) {
          injected = true;
          change = entries.update(entry.id, { facts: [{ field: 'ability', value: '现在只能操纵风' }] }).then(() => { order.push('author committed'); });
        }
        return result;
      },
      async run(sql: string, params = []) {
        if (sql.startsWith('UPDATE chapters SET body')) {
          const fact = await tx.get<{ value: string }>('SELECT value FROM entry_facts WHERE id = ?', [entry.facts[0].id]);
          order.push(`writing:${fact?.value}`);
        }
        return tx.run(sql, params);
      },
    };
    try { return await fn(scoped); } finally { if (writingTransaction) inside = false; }
  }));
  try {
    await ai.applyWriting(plan, '潮汐使者');
    expect(injected).toBe(true);
    await change;
    expect(order).toEqual(['writing:只能操控潮汐', 'author committed']);
    expect(eventStates).toEqual([false]);
    expect((await chapters.get(chapter.id)).body).toBe('潮汐使者站在船头。');
    expect(await d.get("SELECT id FROM chapter_versions WHERE chapter_id = ? AND reason = 'before_ai'", [chapter.id])).toBeDefined();
  } finally { intercept.mockRestore(); }
});

test('an archive edit queued by the final partner text callback prevents stale structured publication', async () => {
  const { workId } = await fixture();
  const entry = await entries.create({ workId, type: 'character', name: '林宇', facts: [{ field: 'ability', value: '只能操控潮汐' }] });
  const conversation = await conversations.create(workId);
  const plan = await partner.prepareSend(conversation.id, '林宇怎么办？');
  const structured = { known: [], questions: [], options: ['冒险', '等待'].map(title => ({ title, summary: title, direction: title, risks: '风险', impact: '后果', state: 'open', entryIds: [], factIds: [] })) };
  const prefix = '保留文字', raw = `${prefix}和最终补充${PARTNER_SEPARATOR}${JSON.stringify(structured)}`;
  jest.spyOn(runtime, 'executeTaskPlan').mockImplementationOnce(async options => {
    options.onText?.(0, prefix);
    return { logicalRequestId: options.logicalRequestId, planId: options.plan.planId, candidates: [{ index: 0, text: raw, stop: 'end', error: null }], capsPatch: {} };
  });
  let change: Promise<void> | undefined;
  await expect(partner.send(plan, { signal: new AbortController().signal, confirmedHost: 'example.test', onText: () => {
    change ??= entries.update(entry.id, { facts: [{ field: 'ability', value: '现在只能操纵风' }] });
  } })).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
  expect(change).toBeDefined(); await change;
  expect((await conversations.messages(conversation.id)).at(-1)).toMatchObject({ content: prefix, status: 'stopped', structured: null });
});
