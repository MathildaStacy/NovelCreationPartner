import { db, setDb } from '../../src/data/db';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as conversations from '../../src/features/conversations';
import * as partner from '../../src/features/partner';
import * as models from '../../src/features/modelServices';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { parsePartner, PARTNER_SEPARATOR, parseComparison, parseAdoption } from '../../src/ai/tasks/partner';
import { freshDb, tickingClock } from '../helpers/db';
import * as runtime from '../../src/ai/runtime';
import type { AdoptItem } from '../../src/features/types';
jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'test-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));
beforeEach(async () => { tickingClock(); await freshDb(); });
afterEach(async () => { await db().close(); setDb(null); });
const structured = { known: ['主角在找钥匙'], questions: ['钥匙在哪里？'], options: [
  { title: '冒险', summary: '去找钥匙', direction: '行动', risks: '危险', impact: '推进', state: 'open', entryIds: [], factIds: [] },
  { title: '等待', summary: '等线索', direction: '稳妥', risks: '错过', impact: '放缓', state: 'open', entryIds: [], factIds: [] },
] };
async function setup() {
  const work = await works.create({ premise: '海上的谜团' });
  const conversation = await conversations.create(work.id);
  const id = 'assistant';
  await db().run("INSERT INTO messages (id,conversation_id,role,content,status,structured,created_at) VALUES (?,?,'assistant','方案','done',?,'2026-10-18')", [id, conversation.id, JSON.stringify(structured)]);
  return { workId: work.id, conversation, messageId: id };
}
const item = (patch: Partial<AdoptItem> = {}): AdoptItem => ({ action: 'create', type: 'character', name: '林宇', targetEntryId: null, summary: '寻找钥匙的人', facts: [{ field: 'goal', value: '找到钥匙', before: null }], ...patch });

test('malformed JSON preserves prose, never fabricates options or accepts one-option output', () => {
  expect(parsePartner('保留正文' + PARTNER_SEPARATOR + '{bad')).toEqual({ content: '保留正文', structured: null });
  expect(parsePartner('纯文字')).toEqual({ content: '纯文字', structured: null });
  expect(parsePartner('回应' + PARTNER_SEPARATOR + JSON.stringify(structured)).structured?.options).toHaveLength(2);
  expect(parsePartner('回应' + PARTNER_SEPARATOR + JSON.stringify({ ...structured, options: structured.options.slice(0, 1) })).structured).toBeNull();
  expect(() => parseComparison(JSON.stringify({ columns: [] }), [0, 1])).toThrow();
  expect(parseAdoption(JSON.stringify({ items: [{ type: 'character', name: '主角', summary: '作者已明确', facts: [{ field: 'newUnknown', value: '丢弃' }] }] }), entries.ENTRY_FIELDS)[0].facts).toEqual([]);
});

test('local conversation CRUD and scope require valid same-work chapters, no service needed', async () => {
  const { workId, conversation } = await setup();
  expect(await conversations.list(workId)).toHaveLength(1);
  expect((await conversations.messages(conversation.id))[0].structured?.options[0].state).toBe('open');
  await conversations.rename(conversation.id, '新的讨论'); expect((await conversations.get(conversation.id)).title).toBe('新的讨论');
  const other = await works.create({ premise: '另一个作品' });
  const vol = (await chapters.list(other.id))[0].volume;
  const chapter = await chapters.create({ workId: other.id, volumeId: vol.id });
  await expect(conversations.setScope(conversation.id, { kind: 'chapter', chapterId: chapter.id, includeProposed: false })).rejects.toMatchObject({ code: 'VALIDATION' });
  expect((await partner.previewContext(workId, conversation.scope)).length).toBe(1);
  await conversations.remove(conversation.id); expect(await conversations.list(workId)).toEqual([]);
});

test('author adoption and undo are atomic; adopted settings survive deleting their conversation', async () => {
  const { workId, conversation, messageId } = await setup();
  const adopted = await partner.adopt(messageId, 0, [item()]);
  expect((await entries.get(adopted.entryIds[0])).facts[0].value).toBe('找到钥匙');
  expect((await conversations.message(messageId)).structured?.options[0].state).toBe('adopted');
  await expect(partner.adopt(messageId, 0, [item()])).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  await expect(conversations.setOptionState(messageId, 0, 'open')).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  await partner.undo(messageId, 0); expect(await entries.list(workId)).toEqual([]);
  expect((await conversations.message(messageId)).structured?.options[0].state).toBe('open');
  await partner.adopt(messageId, 0, [item()]); await conversations.remove(conversation.id);
  expect(await entries.list(workId)).toHaveLength(1);
});

test('undo rejects later edits, and stashed proposals never overwrite confirmed settings', async () => {
  const { workId, messageId } = await setup();
  const current = await entries.create({ workId, type: 'character', name: '林宇', facts: [{ field: 'goal', value: '回家' }] });
  const update = item({ action: 'update', targetEntryId: current.id, facts: [{ field: 'goal', value: '找到钥匙', before: '回家' }] });
  await partner.adopt(messageId, 0, [update], { proposed: true });
  const stashed = await entries.get(current.id);
  expect(stashed.facts[0].value).toBe('回家'); expect(stashed.proposedFacts[0].value).toBe('找到钥匙');
  await partner.undo(messageId, 0); expect((await entries.get(current.id)).proposedFacts).toEqual([]);
  await partner.adopt(messageId, 0, [update]);
  await entries.update(current.id, { facts: [{ field: 'goal', value: '作者改为另一个目标' }] });
  await expect(partner.undo(messageId, 0)).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  expect((await entries.get(current.id)).facts[0].value).toBe('作者改为另一个目标');
});

test('cross-work/stale adoption rolls back all archive changes and leaves option open', async () => {
  const { workId, messageId } = await setup(); const other = await works.create({ premise: '另一作品' });
  const target = await entries.create({ workId: other.id, type: 'character', name: '林宇' });
  await expect(partner.adopt(messageId, 0, [item({ action: 'update', targetEntryId: target.id })])).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(await entries.list(workId)).toEqual([]);
  expect((await conversations.message(messageId)).structured?.options[0].state).toBe('open');
});

test('immutable draft preview creates no conversation; external consent and stale scope stop before requests', async () => {
  const { workId, conversation } = await setup();
  await models.save({ name: 'Fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'test', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'test-key');
  const plan = await partner.prepareSend(null, '帮我构思', { workId, scope: conversation.scope });
  expect(await conversations.list(workId)).toHaveLength(1); expect(Object.isFrozen(plan)).toBe(true);
  await expect(partner.send(plan, { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  expect(await conversations.list(workId)).toHaveLength(1);
  const existing = await partner.prepareSend(conversation.id, '继续讨论');
  await conversations.setScope(conversation.id, { kind: 'confirmed', chapterId: null, includeProposed: true });
  await expect(partner.send(existing, { signal: new AbortController().signal, confirmedHost: 'example.test' })).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
  expect(await db().get('SELECT id FROM ai_attempts')).toBeUndefined();
});


test('synthetic lifecycle uses the captured plan, stores structured replies, regenerates in place and never replays malformed JSON', async () => {
  const { workId, conversation } = await setup();
  await models.save({ name: 'Fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'test', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'test-key');
  let executions = 0;
  const run = jest.spyOn(runtime, 'executeTaskPlan').mockImplementation(async options => {
    executions++;
    const raw = `回答正文${PARTNER_SEPARATOR}${JSON.stringify(structured)}`;
    options.onText?.(0, raw);
    return { logicalRequestId: options.logicalRequestId, planId: options.plan.planId, candidates: [{ index: 0, text: raw, stop: 'end', error: null }], capsPatch: {} };
  });
  try {
    const plan = await partner.prepareSend(null, '帮我构思', { workId });
    const started: string[] = []; const pieces: string[] = [];
    const reply = await partner.send(plan, { signal: new AbortController().signal, confirmedHost: 'example.test', onStart: x => started.push(x.conversationId), onText: d => pieces.push(d) });
    expect(started).toEqual([reply.conversationId]); expect(reply.structured?.options).toHaveLength(2);
    expect(pieces.join('')).toBe('回答正文');
    expect((await conversations.messages(reply.conversationId)).map(m => m.role)).toEqual(['user', 'assistant']);
    const regenerated = await partner.prepareRegenerate(reply.messageId);
    await partner.send(regenerated, { signal: new AbortController().signal, confirmedHost: 'example.test' });
    expect((await conversations.messages(reply.conversationId))).toHaveLength(2);
    expect(executions).toBe(2);
    const stale = await partner.prepareSend(conversation.id, '另一个问题');
    run.mockImplementationOnce(async options => ({ logicalRequestId: options.logicalRequestId, planId: options.plan.planId, candidates: [{ index: 0, text: `仍需保留${PARTNER_SEPARATOR}{bad`, stop: 'end', error: null }], capsPatch: {} }));
    const malformed = await partner.send(stale, { signal: new AbortController().signal, confirmedHost: 'example.test' });
    expect(malformed.content).toBe('仍需保留'); expect(malformed.structured).toBeNull();
    expect(run).toHaveBeenCalledTimes(3);
  } finally { run.mockRestore(); }
});

test('chapter scope includes the full chapter and prior summaries, never a silent body substring', async () => {
  const { workId } = await setup(); const vol = (await chapters.list(workId))[0].volume;
  const first = await chapters.create({ workId, volumeId: vol.id, title: '前章' });
  const current = await chapters.create({ workId, volumeId: vol.id, title: '当前章' });
  await db().run('UPDATE chapters SET summary = ? WHERE id = ?', ['前章摘要', first.id]);
  const long = '正文'.repeat(2000) + '结尾事实不能丢'; await chapters.saveBody(current.id, long, 0);
  const blocks = await partner.previewContext(workId, { kind: 'chapter', chapterId: current.id, includeProposed: false });
  expect(blocks.find(b => b.sourceId === `chapter:${current.id}`)).toMatchObject({ required: true, text: expect.stringContaining('结尾事实不能丢') });
  expect(blocks.find(b => b.sourceId === `summary:${first.id}`)?.text).toContain('前章摘要');
});

test('provider failures remain retryable errors, while output limits keep valid structured suggestions', async () => {
  const { workId } = await setup();
  await models.save({ name: 'Fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'test', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'test-key');
  const info = { code: 'AI_NETWORK', message: '网络连接中断', status: null, providerMessage: null, requestId: null, serviceName: 'Fixture', model: 'test', at: new Date().toISOString() };
  const run = jest.spyOn(runtime, 'executeTaskPlan').mockImplementation(async options => ({ logicalRequestId: options.logicalRequestId, planId: options.plan.planId,
    candidates: [{ index: 0, text: '保留已生成部分', stop: 'end', error: info }], capsPatch: {} }));
  try {
    const plan = await partner.prepareSend(null, '继续构思', { workId });
    const reply = await partner.send(plan, { signal: new AbortController().signal, confirmedHost: 'example.test' });
    expect(await conversations.message(reply.messageId)).toMatchObject({ status: 'error', content: '保留已生成部分', error: { code: 'AI_NETWORK' } });
    run.mockImplementationOnce(async options => ({ logicalRequestId: options.logicalRequestId, planId: options.plan.planId,
      candidates: [{ index: 0, text: `正文${PARTNER_SEPARATOR}${JSON.stringify(structured)}`, stop: 'length', error: { ...info, code: 'AI_TRUNCATED' } }], capsPatch: {} }));
    const retry = await partner.prepareRegenerate(reply.messageId);
    await partner.send(retry, { signal: new AbortController().signal, confirmedHost: 'example.test' });
    expect(await conversations.message(reply.messageId)).toMatchObject({ status: 'done', error: { code: 'AI_TRUNCATED' }, structured: { options: [{ state: 'open' }, { state: 'open' }] } });
  } finally { run.mockRestore(); }
});

test('merging a retired alias revives it atomically and undo restores retirement metadata', async () => {
  const { workId, messageId } = await setup();
  const target = await entries.create({ workId, type: 'character', name: '林宇', aliases: ['持镜人'], facts: [{ field: 'goal', value: '回家' }] });
  await entries.retire(target.id);
  expect((await entries.nameMatch(workId, 'character', '持镜人'))?.id).toBe(target.id);
  await partner.adopt(messageId, 0, [item({ action: 'update', name: '持镜人', targetEntryId: target.id, facts: [{ field: 'goal', value: '找到钥匙', before: '回家' }] })]);
  expect(await entries.get(target.id)).toMatchObject({ state: 'CONFIRMED' });
  await partner.undo(messageId, 0);
  expect(await entries.get(target.id)).toMatchObject({ state: 'RETIRED', facts: [{ value: '回家' }] });
  await entries.unretire(target.id);
  expect((await entries.get(target.id)).state).toBe('CONFIRMED');
});

test('partner character limit counts Unicode code points and rejects before a model request', async () => {
  await expect(partner.prepareSend(null, '😀'.repeat(2001), { workId: 'unused' })).rejects.toMatchObject({ code: 'VALIDATION' });
});

test('partial comparison cells and missing columns show empty cells without accepting duplicate indexes', () => {
  const table = parseComparison(JSON.stringify({ columns: [{ optionIndex: 0, cells: { conflict: '共同冲突' }, fit: 'high' }] }), [0, 1]);
  expect(table.columns).toHaveLength(2);
  expect(table.columns[0].cells.risks).toBe('');
  expect(table.columns[1].cells).toEqual({});
  expect(() => parseComparison(JSON.stringify({ columns: [table.columns[0], table.columns[0]] }), [0, 1])).toThrow();
});

test('a second conversation cannot start a paid reply while another conversation is streaming', async () => {
  const { workId } = await setup();
  await models.save({ name: 'Fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'test', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'test-key');
  const one = await partner.prepareSend(null, '第一个问题', { workId });
  const two = await partner.prepareSend(null, '第二个问题', { workId });
  let started!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  let finish!: () => void;
  const run = jest.spyOn(runtime, 'executeTaskPlan').mockImplementation(options => new Promise(resolve => {
    finish = () => resolve({ logicalRequestId: options.logicalRequestId, planId: options.plan.planId, candidates: [{ index: 0, text: '第一条完成', stop: 'end', error: null }], capsPatch: {} });
    started();
  }));
  const pending = partner.send(one, { signal: new AbortController().signal, confirmedHost: 'example.test' });
  try {
    await running;
    expect(await conversations.isGenerating()).toBe(true);
    await expect(partner.send(two, { signal: new AbortController().signal, confirmedHost: 'example.test' })).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
    expect(run).toHaveBeenCalledTimes(1);
  } finally { finish(); await pending; run.mockRestore(); }
  expect(await conversations.isGenerating()).toBe(false);
});

test('S10 断网发送: a connection failure before any output leaves no new messages or conversation; the attempt stays recorded', async () => {
  const { workId, conversation } = await setup();
  await models.save({ name: 'Fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'test', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'test-key');
  const info = { code: 'AI_NETWORK', message: '连不上 example.test，请检查地址或网络。', status: null, providerMessage: null, requestId: null, serviceName: 'Fixture', model: 'test', at: new Date().toISOString() };
  const run = jest.spyOn(runtime, 'executeTaskPlan').mockImplementation(async options => ({ logicalRequestId: options.logicalRequestId, planId: options.plan.planId,
    candidates: [{ index: 0, text: '', stop: 'end', error: info }], capsPatch: {} }));
  try {
    const before = (await conversations.messages(conversation.id)).map(m => m.id);
    const plan = await partner.prepareSend(conversation.id, '继续构思', { workId });
    await expect(partner.send(plan, { signal: new AbortController().signal, confirmedHost: 'example.test' })).rejects.toBeInstanceOf(partner.PartnerUnsentError);
    expect((await conversations.messages(conversation.id)).map(m => m.id)).toEqual(before);
    const fresh = await partner.prepareSend(null, '新的话题', { workId });
    await expect(partner.send(fresh, { signal: new AbortController().signal, confirmedHost: 'example.test' })).rejects.toMatchObject({ code: 'AI_NETWORK', unsent: true });
    expect((await conversations.list(workId)).map(c => c.id)).toEqual([conversation.id]);
    expect(Number((await db().get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_requests'))?.n)).toBe(2);
    // Mid-generation interruption keeps the message as a retryable error.
    run.mockImplementationOnce(async options => { options.onText?.(0, '已经写了一半'); return { logicalRequestId: options.logicalRequestId, planId: options.plan.planId,
      candidates: [{ index: 0, text: '已经写了一半', stop: 'end', error: { ...info, code: 'AI_STREAM_INTERRUPTED' } }], capsPatch: {} }; });
    const third = await partner.prepareSend(conversation.id, '再试一次', { workId });
    const reply = await partner.send(third, { signal: new AbortController().signal, confirmedHost: 'example.test' });
    expect(await conversations.message(reply.messageId)).toMatchObject({ status: 'error', content: '已经写了一半' });
  } finally { run.mockRestore(); }
});

test('S10a over-budget scope lists optional references that were left out, proposals first, without changing the plan', async () => {
  const { workId } = await setup();
  await models.save({ name: 'Fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'test', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'test-key');
  for (let i = 0; i < 40; i++) {
    await entries.create({ workId, type: 'place', name: `地点${i}`, summary: '海边的地方', facts: ['description', 'belongsTo', 'location'].map(field => ({ field, value: `第${i}处。` + '潮水拍岸，灯塔孤立。'.repeat(45) })) });
  }
  const proposedEntry = await entries.create({ workId, type: 'character', name: '灯塔' });
  await entries.proposeFacts(proposedEntry.id, [{ field: 'identity', value: '来自北方的旅人' }], { kind: 'partner', ref: null });
  const scope = { kind: 'confirmed' as const, chapterId: null, includeProposed: true };
  const overview = await partner.inspectScope(workId, scope, '灯塔');
  expect(overview.omitted).toBeGreaterThan(0);
  expect(overview.omittedBlocks.length).toBeGreaterThan(0);
  const included = new Set(overview.blocks.map(block => block.sourceId));
  expect(overview.omittedBlocks.every(block => !included.has(block.sourceId))).toBe(true);
  expect(overview.omittedBlocks.some(block => block.sourceId.startsWith('proposed:'))).toBe(true);
  expect(overview.blocks.some(block => block.sourceId.startsWith('proposed:'))).toBe(false);
});
