import { freshDb } from '../helpers/db';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as conflicts from '../../src/features/conflicts';

/** S14/S14a/S05 read-time display context for conflicts. */
async function fixture() {
  const db = await freshDb();
  const work = await works.create({ title: '归潮', premise: '海边的古镜' });
  const volume = (await chapters.list(work.id))[0].volume;
  const first = await chapters.create({ workId: work.id, volumeId: volume.id, title: '渔村' });
  const second = await chapters.create({ workId: work.id, volumeId: volume.id, title: '星图残页' });
  const third = await chapters.create({ workId: work.id, volumeId: volume.id, title: '突破' });
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇', facts: [{ field: 'ability', value: '只能淬体', fromChapterId: first.id }] });
  await db.run('UPDATE entry_facts SET to_chapter_id=? WHERE entry_id=?', [third.id, entry.id]);
  const fact = (await db.get<{ id: string }>('SELECT id FROM entry_facts WHERE entry_id=?', [entry.id]))!;
  const insert = (id: string, chapterId: string, createdAt: string) => db.run(`INSERT INTO conflicts
    (id,work_id,chapter_id,entry_id,type,severity,a_label,a_ref,a_quote,b_label,b_ref,b_quote,explanation,suggestions,status,fingerprint,created_at)
    VALUES (?,?,?,?,'character','high','正文',?,'光刃','林宇的能力',?,'只能淬体','提前外放','[]','open',?,?)`,
  [id, work.id, chapterId, entry.id, `chapter:${chapterId}`, `fact:${fact.id}`, id, createdAt]);
  await insert('older', first.id, '2026-10-01T00:00:00.000Z');
  await insert('newer', second.id, '2026-10-02T00:00:00.000Z');
  return { db, work, first, second, third, entry, fact };
}

test('conflict views carry live chapter number, entry name and the fact interval', async () => {
  const { db, second, fact } = await fixture();
  const view = await conflicts.get('newer');
  expect(view).toMatchObject({ chapter: { id: second.id, number: 2, title: '星图残页' }, entryName: '林宇', resolvedAt: null,
    fact: { id: fact.id, field: 'ability', value: '只能淬体', fromNumber: 1, toNumber: 3, currentValue: null } });
  await conflicts.resolve('newer', { status: 'intentional', note: '伏笔' });
  expect((await conflicts.get('newer')).resolvedAt).toEqual(expect.any(String));
  db.close();
});

test('S05 second lines name the newest unresolved conflict and the chapters proposals came from', async () => {
  const { db, work } = await fixture();
  const overview = await works.overview(work.id);
  expect(overview.pendingDetail.latestConflict).toMatchObject({ chapterNumber: 2, chapterTitle: '星图残页', entryName: '林宇' });
  expect(overview.pendingDetail.latestConflict?.fieldLabel).toBe(entries.FIELD_LABELS.ability ?? 'ability');
  expect(overview.pendingDetail.proposalChapterNumbers).toEqual([]);
  await conflicts.resolve('newer', { status: 'fixed_text' });
  expect((await works.overview(work.id)).pendingDetail.latestConflict?.chapterNumber).toBe(1);
  db.close();
});

test('a conflict whose chapter is in the trash reads as NOT_FOUND until restored', async () => {
  const { db, second } = await fixture();
  await chapters.remove(second.id);
  await expect(conflicts.get('newer')).rejects.toMatchObject({ code: 'NOT_FOUND', message: '这处冲突已不存在' });
  db.close();
});
