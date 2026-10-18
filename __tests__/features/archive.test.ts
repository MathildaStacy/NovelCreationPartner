import { db, setDb } from '../../src/data/db';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { m0001 } from '../../src/data/migrations/0001_init';
import { m0002 } from '../../src/data/migrations/0002_model_services';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import { on } from '../../src/features/events';
import * as relations from '../../src/features/relations';
import * as trash from '../../src/features/trash';
import * as volumes from '../../src/features/volumes';
import * as works from '../../src/features/works';
import { freshDb, tickingClock } from '../helpers/db';

beforeEach(async () => { tickingClock(); await freshDb(); });
afterEach(async () => { await db().close(); setDb(null); });
async function book() {
  const work = await works.create({ premise: '守住已经写下的事实', genre: 'xianxia' });
  const [volume] = await volumes.list(work.id);
  const chapterIds: string[] = [];
  for (const title of ['开端', '转折', '结局']) {
    chapterIds.push((await chapters.create({ workId: work.id, volumeId: volume.id, title })).id);
  }
  return { workId: work.id, volumeId: volume.id, chapterIds };
}
async function person(workId: string, name = '小明', aliases = ['阿明']) {
  return entries.create({ workId, type: 'character', name, aliases, summary: '人物简介', facts: [{ field: 'ability', value: '尚未习武' }] });
}
const valueAt = async (id: string, chapterId?: string) => (await entries.get(id, { atChapterId: chapterId })).facts.find(f => f.field === 'ability')?.value;

test('names, aliases and FTS handle Chinese short queries, literal wildcard and updated/deleted facts', async () => {
  const { workId } = await book(); const p = await person(workId);
  const other = await entries.create({ workId, type: 'place', name: '云中仙城', summary: '繁华的南方渡口' });
  expect((await entries.search(workId, '阿明')).map(e => e.id)).toEqual([p.id]);
  expect((await entries.search(workId, '云中仙')).map(e => e.id)).toEqual([other.id]);
  expect((await entries.search(workId, '南方渡口')).map(e => e.id)).toEqual([other.id]);
  expect(await entries.search(workId, '%')).toEqual([]);
  await entries.update(p.id, { facts: [{ field: 'ability', value: '可以御剑飞行' }] });
  expect((await entries.search(workId, '御剑飞行')).map(e => e.id)).toEqual([p.id]);
  expect(await entries.search(workId, '尚未习武')).toEqual([]);
  await entries.remove(p.id);
  expect(await entries.search(workId, '御剑飞行')).toEqual([]);
  await trash.restore('entry', p.id);
  expect((await entries.search(workId, '御剑飞行')).map(e => e.id)).toEqual([p.id]);
  await entries.retire(p.id); expect(await entries.search(workId, '阿明')).toEqual([]);
  await entries.unretire(p.id); expect((await entries.search(workId, '阿明')).length).toBe(1);
});

test('name/alias conflicts are atomic, same name in another type/work is allowed', async () => {
  const { workId } = await book(); const p = await person(workId);
  await expect(person(workId, '阿明', [])).rejects.toMatchObject({ code: 'DUPLICATE' });
  await entries.create({ workId, type: 'place', name: '阿明' });
  const other = await person(workId, '小红', ['红儿']);
  await expect(entries.update(other.id, { aliases: ['阿明'], summary: '不会保存' })).rejects.toMatchObject({ code: 'DUPLICATE' });
  expect((await entries.get(other.id)).summary).toBe('人物简介');
  await person((await book()).workId);
  await entries.remove(p.id);
  await person(workId, '阿明', []);
  await expect(trash.restore('entry', p.id)).rejects.toMatchObject({ code: 'DUPLICATE' });
});

test('phased facts, history, clear and revert preserve phases and consult current chapter order', async () => {
  const { workId, volumeId, chapterIds: [a, b, c] } = await book(); const p = await person(workId);
  await entries.update(p.id, { facts: [{ field: 'ability', value: '能够飞行', fromChapterId: b }] });
  expect(await valueAt(p.id, a)).toBe('尚未习武');
  expect(await valueAt(p.id, b)).toBe('能够飞行');
  expect(await valueAt(p.id)).toBe('能够飞行');
  const original = (await entries.history(p.id)).at(-1)!;
  await entries.update(p.id, { facts: [{ field: 'ability', value: '飞行需要风力' }] });
  expect(await valueAt(p.id, a)).toBe('尚未习武');
  expect(await valueAt(p.id, c)).toBe('飞行需要风力');
  await expect(entries.revertFact(original.factId)).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  // Restore acts on the phase that contains the historical starting point, rather than overwriting later phases.
  expect(await valueAt(p.id, b)).toBe('飞行需要风力');
  await expect(entries.revertFact(original.factId)).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  await chapters.reorder(workId, [{ volumeId, chapterIds: [a, c, b] }]);
  expect(await valueAt(p.id, c)).toBeUndefined();
  expect(await valueAt(p.id, b)).toBe('飞行需要风力');
  await entries.update(p.id, { facts: [{ field: 'ability', value: '' }] });
  expect(await valueAt(p.id, b)).toBeUndefined();
  expect((await entries.history(p.id))[0].after).toBeNull();
});

test('historical restore appends a new confirmed fact with source and preserves the target interval', async () => {
  const { workId, chapterIds: [, b] } = await book(); const p = await person(workId);
  await entries.update(p.id, { facts: [{ field: 'ability', value: '初学剑法', fromChapterId: b }] });
  const phase = (await entries.history(p.id))[0];
  await entries.update(p.id, { facts: [{ field: 'ability', value: '精通剑法' }] });
  await entries.revertFact(phase.factId);
  expect(await valueAt(p.id, b)).toBe('初学剑法');
  const latest = (await entries.history(p.id))[0];
  expect(latest).toMatchObject({ sourceKind: 'revert', before: '精通剑法', after: '初学剑法', fromChapterId: b });
});

test('historical review inserts and replaces only its own interval, preserving earlier and future formal phases', async () => {
  const {workId,chapterIds:[a,b,c]}=await book();const p=await person(workId);
  await entries.update(p.id,{facts:[{field:'ability',value:'未来能够御剑',fromChapterId:c}]});
  const future=(await entries.get(p.id)).facts[0];
  await db().transaction(tx=>entries.updateFactsIn(tx,p.id,[{field:'ability',value:'中段学会轻功',fromChapterId:b}],{kind:'review',ref:'review-fixture'},'ESTABLISHED'));
  expect(await valueAt(p.id,a)).toBe('尚未习武');expect(await valueAt(p.id,b)).toBe('中段学会轻功');expect(await valueAt(p.id,c)).toBe('未来能够御剑');
  const middle=(await entries.get(p.id,{atChapterId:b})).facts[0];expect(middle.toChapterId).toBe(b);
  expect((await db().get<{is_current:number}>('SELECT is_current FROM entry_facts WHERE id=?',[future.id]))?.is_current).toBe(1);
  await entries.update(p.id,{facts:[{field:'ability',value:'中段重新核对',fromChapterId:b}]});
  const revised=(await entries.get(p.id,{atChapterId:b})).facts[0];expect(revised).toMatchObject({value:'中段重新核对',fromChapterId:b,toChapterId:b,supersedesId:middle.id});
  expect(await valueAt(p.id,c)).toBe('未来能够御剑');
  await entries.update(p.id,{facts:[{field:'ability',value:'',fromChapterId:b}]});
  expect(await valueAt(p.id,a)).toBe('尚未习武');expect(await valueAt(p.id,b)).toBeUndefined();expect(await valueAt(p.id,c)).toBe('未来能够御剑');
  await entries.update(p.id,{facts:[{field:'ability',value:'全局核对',fromChapterId:null}]});
  expect(await valueAt(p.id,a)).toBe('全局核对');expect(await valueAt(p.id,b)).toBeUndefined();expect(await valueAt(p.id,c)).toBe('未来能够御剑');
  await entries.update(p.id,{facts:[{field:'ability',value:'最新默认编辑'}]});
  expect(await valueAt(p.id,a)).toBe('全局核对');expect(await valueAt(p.id,b)).toBeUndefined();expect(await valueAt(p.id,c)).toBe('最新默认编辑');
});

test('inserting before the first known phase stops at that future phase and missing anchors reject without mutation', async () => {
  const {workId,chapterIds:[a,b,c]}=await book();
  const p=await entries.create({workId,type:'character',name:'后来者',facts:[{field:'ability',value:'后来觉醒',fromChapterId:c}]});
  await entries.update(p.id,{facts:[{field:'ability',value:'最初状态',fromChapterId:a}]});
  expect(await valueAt(p.id,a)).toBe('最初状态');expect(await valueAt(p.id,b)).toBe('最初状态');expect(await valueAt(p.id,c)).toBe('后来觉醒');
  expect((await entries.get(p.id,{atChapterId:a})).facts[0].toChapterId).toBe(b);
  await chapters.remove(c);const before=await entries.history(p.id);
  await expect(entries.update(p.id,{facts:[{field:'ability',value:'不能扩大',fromChapterId:a}]})).rejects.toMatchObject({code:'VALIDATION'});
  expect(await entries.history(p.id)).toEqual(before);
});

test('a timeless insertion before an existing first-chapter phase rejects without overwriting it', async () => {
  const { workId, chapterIds: [a, b] } = await book();
  const p = await entries.create({ workId, type: 'character', name: '首章人物',
    facts: [{ field: 'ability', value: '首章已有能力', fromChapterId: a }] });
  const before = await entries.history(p.id);
  await expect(entries.update(p.id, { facts: [{ field: 'ability', value: '不能扩大', fromChapterId: null }] }))
    .rejects.toMatchObject({ code: 'VALIDATION' });
  expect(await entries.history(p.id)).toEqual(before);
  expect(await valueAt(p.id, a)).toBe('首章已有能力');
  expect(await valueAt(p.id, b)).toBe('首章已有能力');
});

test('cross-work IDs, invalid fields and intervals reject without partial writes or events', async () => {
  const a = await book(); const b = await book(); const p = await person(a.workId);
  const q = await person(b.workId, '另一个人');
  const changed: string[] = []; on('entries.changed', x => changed.push(...x.entryIds));
  await expect(entries.update(p.id, { summary: '不会保存', facts: [{ field: 'ability', value: '乱入', fromChapterId: b.chapterIds[0] }] })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(entries.get(p.id, { atChapterId: b.chapterIds[0] })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(entries.create({ workId: a.workId, type: 'character', name: '坏字段', facts: [{ field: 'location', value: '错误' }] })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(relations.upsert({ fromEntryId: p.id, toEntryId: q.id, kind: '盟友' })).rejects.toMatchObject({ code: 'VALIDATION' });
  expect((await entries.get(p.id)).summary).toBe('人物简介'); expect(changed).toEqual([]);
});

test('relationship validity and restoring two deleted endpoints never revives a removed relationship', async () => {
  const { workId, chapterIds: [a, b, c] } = await book(); const p = await person(workId); const q = await person(workId, '小红', []);
  const r = await relations.upsert({ fromEntryId: p.id, toEntryId: q.id, kind: '盟友', fromChapterId: b });
  expect((await entries.get(p.id, { atChapterId: a })).relations).toEqual([]);
  expect((await entries.get(p.id, { atChapterId: b })).relations[0].toName).toBe('小红');
  await relations.end(r.id, b);
  expect((await entries.get(p.id, { atChapterId: c })).relations).toEqual([]);
  await expect(relations.end(r.id, a)).rejects.toMatchObject({ code: 'VALIDATION' });
  await entries.remove(p.id); await entries.remove(q.id);
  await trash.restore('entry', p.id); expect(await relations.list(p.id)).toEqual([]);
  await trash.restore('entry', q.id); expect((await relations.list(p.id)).length).toBe(1);
  await relations.remove(r.id); await entries.remove(p.id); await trash.restore('entry', p.id);
  expect(await relations.list(p.id)).toEqual([]);
});

test('mention matching prefers longest aliases and excludes trash, future and other works', async () => {
  const { workId, chapterIds: [a, b] } = await book(); const p = await person(workId);
  await entries.create({ workId, type: 'character', name: '明', facts: [] });
  const future = await entries.create({ workId, type: 'character', name: '未来人', facts: [{ field: 'identity', value: '未来出现', fromChapterId: b }] });
  const found = await entries.findMentions(workId, '小明与阿明谈到未来人', { atChapterId: a });
  expect(found).toEqual([{ entryId: p.id, name: '小明', count: 2 }]);
  await entries.remove(future.id); expect(await entries.findMentions(workId, '未来人')).toEqual([]);
});

test('AI proposal does not overwrite facts; confirmation retains author interval and source', async () => {
  const { workId, chapterIds: [, b] } = await book(); const p = await person(workId);
  await entries.update(p.id, { facts: [{ field: 'ability', value: '能飞', fromChapterId: b }] });
  const [id] = await entries.proposeFacts(p.id, [{ field: 'ability', value: '能读心' }], { kind: 'ai_complete', ref: 'local-proposal' });
  expect(await valueAt(p.id, b)).toBe('能飞');
  expect((await entries.get(p.id)).proposedFacts).toHaveLength(1);
  await entries.confirmFact(id, { value: '能听到风声' });
  expect((await entries.get(p.id)).proposedFacts).toEqual([]);
  expect((await entries.get(p.id)).facts[0]).toMatchObject({ value: '能听到风声', fromChapterId: b, source: { kind: 'ai_complete', ref: 'local-proposal' } });
});

test('events fire after transaction commit; upgrade preserves writing and model service', async () => {
  await db().close();
  const old = openMemoryDb(); setDb(old);
  await old.run('PRAGMA foreign_keys = ON');
  await old.transaction(async tx => { for (const sql of [...m0001, ...m0002]) { await tx.run(sql); } await tx.run('PRAGMA user_version = 2'); });
  const { workId, chapterIds: [chapterId] } = await book(); await chapters.saveBody(chapterId, '作者的正文', 2);
  await old.run(`INSERT INTO model_services (id,name,protocol,base_url,model,created_at,updated_at) VALUES ('saved','existing','openai_responses','https://example.com','m','x','x')`);
  await migrate(old);
  const checks: Promise<unknown>[] = [];
  on('entries.changed', e => { checks.push(entries.get(e.entryIds[0])); });
  const p = await person(workId); expect((await Promise.all(checks))[0]).toMatchObject({ id: p.id });
  expect((await chapters.get(chapterId)).body).toBe('作者的正文');
  expect((await old.get('SELECT name FROM model_services WHERE id = ?', ['saved']))).toMatchObject({ name: 'existing' });
});


test('manual custom fields keep 500 characters; AI cannot add unlisted fields or oversized suggestions', async () => {
  const { workId } = await book(); const p = await person(workId);
  await entries.update(p.id, { facts: [{ field: '口头禅', value: '哈'.repeat(500) }] });
  expect((await entries.get(p.id)).facts.find(f => f.field === '口头禅')?.value).toHaveLength(500);
  await expect(entries.proposeFacts(p.id, [{ field: '口头禅', value: 'AI 新增' }], { kind: 'ai_complete', ref: null })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(entries.proposeFacts(p.id, [{ field: 'goal', value: '哈'.repeat(301) }], { kind: 'ai_complete', ref: null })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(entries.update(p.id, { aliases: ['长'.repeat(21)] })).rejects.toMatchObject({ code: 'VALIDATION' });
});

test('appearance lookup skips drafts and single names; overlapping directed relations reject atomically', async () => {
  const { workId, volumeId, chapterIds: [a, b, c] } = await book(); const p = await person(workId); const q = await person(workId, '小红', []);
  await chapters.saveBody(a, '阿明与小明；小明。', 0);
  const draft = await chapters.create({ workId, volumeId, kind: 'draft', title: '草稿' });
  await chapters.saveBody(draft.id, '小明', 0);
  expect((await entries.get(p.id)).appearances).toEqual([{ chapterId: a, number: 1, kind: 'main', title: '开端', count: 3, firstOffset: 0, firstLength: 2 }]);
  const base = { fromEntryId: p.id, toEntryId: q.id, kind: '盟友' };
  await relations.upsert({ ...base, fromChapterId: a, toChapterId: b });
  await expect(relations.upsert({ ...base, fromChapterId: b, toChapterId: c })).rejects.toMatchObject({ code: 'DUPLICATE' });
  await relations.upsert({ ...base, fromChapterId: c });
  await relations.upsert({ fromEntryId: q.id, toEntryId: p.id, kind: '盟友', fromChapterId: a });
  expect(await relations.list(p.id)).toHaveLength(3);
});


test('ambiguous same-name entities remain separate and cleared fields can be restored', async () => {
  const { workId } = await book(); const p = await person(workId);
  const place = await entries.create({ workId, type: 'place', name: '小明' });
  const mentions = await entries.findMentions(workId, '小明');
  expect(new Set(mentions.map(m => m.entryId))).toEqual(new Set([p.id, place.id]));
  const first = (await entries.history(p.id))[0];
  await entries.update(p.id, { facts: [{ field: 'ability', value: '' }] });
  await entries.revertFact(first.factId);
  expect(await valueAt(p.id)).toBe('尚未习武');
  expect((await entries.history(p.id))[0]).toMatchObject({ before: null, after: '尚未习武', sourceKind: 'revert' });
});
