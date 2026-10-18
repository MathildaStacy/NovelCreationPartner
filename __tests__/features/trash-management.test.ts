import { freshDb } from '../helpers/db';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as trash from '../../src/features/trash';
import * as relations from '../../src/features/relations';

async function setup() {
  const db = await freshDb(); const work = await works.create({ title: '归潮', premise: '海边的故事' });
  const group = (await chapters.list(work.id))[0];
  const chapter = await chapters.create({ workId: work.id, volumeId: group.volume.id, title: '相遇' });
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇', facts: [{ field: 'identity', value: '少年' }] });
  await chapters.saveBody(chapter.id, '林宇向海面望去。', 0); await chapters.finalize(chapter.id);
  return { db, work, chapter, entry };
}
test('trash lists independent deletions and requires parent restore before a child', async () => {
  const { db, work, chapter } = await setup();
  await chapters.remove(chapter.id); await works.remove(work.id);
  const list = await trash.list();
  expect(list.map(item => item.kind).sort()).toEqual(['chapter', 'work']);
  expect(list.find(item => item.kind === 'chapter')).toMatchObject({ parentDeleted: true, workId: work.id, title: '相遇' });
  await expect(trash.restore('chapter', chapter.id)).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  await trash.restore('work', work.id); await trash.restore('chapter', chapter.id);
  expect(await trash.list()).toEqual([]); await db.close();
});
test('permanent work deletion removes versions, jobs, archive and attempt parent budgets', async () => {
  const { db, work, entry } = await setup();
  await entries.update(entry.id, { facts: [{ field: 'identity', value: '成长后的旅者' }] });
  await works.remove(work.id);
  await trash.purge('work', work.id);
  for (const table of ['works','volumes','chapters','chapter_versions','entries','entry_facts','jobs','ai_requests']) {
    expect(await db.all(`SELECT * FROM ${table}`)).toHaveLength(0);
  }
  await expect(trash.purge('work', work.id)).rejects.toMatchObject({ code: 'NOT_FOUND' }); await db.close();
});
test('clear is atomic when an image cover cannot be safely deleted', async () => {
  const { db, work, chapter, entry } = await setup();
  await chapters.remove(chapter.id); await entries.remove(entry.id); await works.setCoverPath(work.id, 'covers/private.jpg'); await works.remove(work.id);
  await expect(trash.empty()).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(await trash.list()).toHaveLength(3); expect(await db.all('SELECT * FROM chapters')).toHaveLength(1); await db.close();
});

test.each(['fact', 'relation'] as const)('permanent chapter deletion and empty preserve surviving %s interval anchors', async kind => {
  const { db, work, chapter, entry } = await setup();
  if (kind === 'fact') {
    await entries.update(entry.id, { facts: [{ field: 'identity', value: '海上少年', fromChapterId: chapter.id }] });
  } else {
    const peer = await entries.create({ workId: work.id, type: 'character', name: '余舟' });
    await relations.upsert({ fromEntryId: entry.id, toEntryId: peer.id, kind: '朋友', fromChapterId: chapter.id });
  }
  await chapters.remove(chapter.id);
  await expect(trash.purge('chapter', chapter.id)).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  await expect(trash.empty()).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  expect(await db.get('SELECT id FROM chapters WHERE id=?', [chapter.id])).toBeDefined();
  const table = kind === 'fact' ? 'entry_facts' : 'relations';
  expect(await db.get(`SELECT id FROM ${table} WHERE from_chapter_id=?`, [chapter.id])).toBeDefined();
  await trash.restore('chapter', chapter.id);
  expect((await chapters.get(chapter.id)).body).toBe('林宇向海面望去。');
  await db.close();
});

test('expiry skips referenced chapters but still removes independent expired items', async () => {
  const { db, work, chapter, entry } = await setup();
  await entries.update(entry.id, { facts: [{ field: 'identity', value: '海上少年', fromChapterId: chapter.id }] });
  const volume = (await chapters.list(work.id))[0].volume;
  const other = await chapters.create({ workId: work.id, volumeId: volume.id, title: '可清理' });
  await chapters.remove(chapter.id); await chapters.remove(other.id);
  await db.run("UPDATE chapters SET deleted_at='2000-01-01T00:00:00Z' WHERE id IN (?,?)", [chapter.id, other.id]);
  expect(await trash.purgeExpired()).toEqual({ works: 0, chapters: 1, entries: 0 });
  expect(await db.get('SELECT id FROM chapters WHERE id=?', [chapter.id])).toBeDefined();
  expect(await db.get('SELECT id FROM chapters WHERE id=?', [other.id])).toBeUndefined();
  await db.close();
});

test('empty can purge an entire work with its anchored archive in the same transaction', async () => {
  const { db, work, chapter, entry } = await setup();
  await entries.update(entry.id, { facts: [{ field: 'identity', value: '海上少年', fromChapterId: chapter.id }] });
  await chapters.remove(chapter.id); await works.remove(work.id);
  await trash.empty();
  expect(await trash.list()).toEqual([]); expect(await db.all('SELECT * FROM entry_facts')).toEqual([]);
  await db.close();
});
