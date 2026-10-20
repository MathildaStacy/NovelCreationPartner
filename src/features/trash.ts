/** Trash (G02 §4.1, §5.13). Phase 1: restore works and chapters, and the 30-day purge at startup. */
import { db, type Db } from '../data/db';
import { validateNamesIn } from './entries';
import type { EntryRow } from './archiveSupport';
import { isoMs, nowIso } from '../utils/id';
import { AppError, notFound } from './errors';
import { emit } from './events';
import * as covers from './covers';
import type { ChapterKind, EntryType, ID, TrashKind } from './types';

export const RETENTION_DAYS = 30;

/**
 * Restores from the trash. A work keeps its updatedAt, so it returns to its old
 * place on the shelf. A chapter returns to its old place in its volume (later
 * chapters shift down by one); if the volume is gone it goes to the end of the
 * first volume. A chapter whose work is in the trash cannot be restored alone.
 * Returns `movedToVolume` (that first volume's title) when the original volume
 * was gone, so S15d can say "（已放入「卷名」）".
 */
export async function restore(kind: TrashKind, id: ID): Promise<{ movedToVolume?: string }> {
  if (kind === 'work') {
    const res = await db().run('UPDATE works SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL', [id]);
    if (res.changes === 0) {
      throw notFound('作品');
    }
    emit('work.updated', { workId: id });
    return {};
  }
  if (kind === 'chapter') {
    let workId = '';
    let movedToVolume: string | undefined;
    await db().transaction(async tx => {
      const ch = await tx.get<{ work_id: string; volume_id: string; order_index: number; work_deleted: string | null }>(
        `SELECT c.work_id, c.volume_id, c.order_index, w.deleted_at AS work_deleted
         FROM chapters c JOIN works w ON w.id = c.work_id WHERE c.id = ? AND c.deleted_at IS NOT NULL`,
        [id],
      );
      if (!ch) {
        throw notFound('章节');
      }
      if (ch.work_deleted) {
        throw new AppError('CONFLICT_STATE', '这一章所在的作品也在回收站里，请先恢复作品');
      }
      workId = ch.work_id;
      const vol = await tx.get('SELECT id FROM volumes WHERE id = ?', [ch.volume_id]);
      if (vol) {
        await tx.run(
          'UPDATE chapters SET order_index = order_index + 1 WHERE volume_id = ? AND deleted_at IS NULL AND order_index >= ?',
          [ch.volume_id, ch.order_index],
        );
        await tx.run('UPDATE chapters SET deleted_at = NULL WHERE id = ?', [id]);
      } else {
        const first = await tx.get<{ id: string; title: string }>(
          'SELECT id, title FROM volumes WHERE work_id = ? ORDER BY order_index LIMIT 1',
          [ch.work_id],
        );
        const max = await tx.get<{ m: number | null }>('SELECT max(order_index) m FROM chapters WHERE volume_id = ?', [
          first!.id,
        ]);
        await tx.run('UPDATE chapters SET deleted_at = NULL, volume_id = ?, order_index = ? WHERE id = ?', [
          first!.id,
          (max?.m ?? -1) + 1,
          id,
        ]);
        movedToVolume = first!.title;
      }
    });
    emit('chapters.changed', { workId });
    return movedToVolume === undefined ? {} : { movedToVolume };
  }
  let workId = '';
  await db().transaction(async tx => {
    const row = await tx.get<EntryRow & { work_deleted: string | null }>(
      `SELECT e.*, w.deleted_at AS work_deleted FROM entries e JOIN works w ON w.id = e.work_id
       WHERE e.id = ? AND e.deleted_at IS NOT NULL`, [id]);
    if (!row) { throw notFound('档案条目'); }
    if (row.work_deleted) { throw new AppError('CONFLICT_STATE', '请先恢复条目所在的作品'); }
    workId = row.work_id;
    await validateNamesIn(tx, workId, row.type, row.name, JSON.parse(row.aliases), id);
    await tx.run('UPDATE entries SET deleted_at = NULL WHERE id = ?', [id]);
    // Restore only relationships hidden by endpoint deletion, and only once both endpoints live.
    await tx.run(`UPDATE relations SET deleted_at = NULL, deleted_with_entry = 0
      WHERE (from_entry = ? OR to_entry = ?) AND deleted_with_entry = 1
      AND EXISTS (SELECT 1 FROM entries a WHERE a.id = relations.from_entry AND a.deleted_at IS NULL)
      AND EXISTS (SELECT 1 FROM entries b WHERE b.id = relations.to_entry AND b.deleted_at IS NULL)`, [id, id]);
  });
  emit('entries.changed', { workId, entryIds: [id] });  return {};
}

/** Startup (G02 §10 step 2): permanently deletes what has been in the trash for over 30 days. */
export async function purgeExpired(): Promise<{ works: number; chapters: number; entries: number }> {
  const cutoff = isoMs(nowIso()) - RETENTION_DAYS * 24 * 3600 * 1000;
  const expired = (iso: string | null) => iso != null && isoMs(iso) < cutoff;
  return db().transaction(async tx => {
    const pick = async (table: string) =>
      (await tx.all<{ id: string; deleted_at: string }>(`SELECT id, deleted_at FROM ${table} WHERE deleted_at IS NOT NULL`))
        .filter(r => expired(r.deleted_at))
        .map(r => r.id);
    const expiredWorks = await pick('works');
    const expiredChapters = await pick('chapters');
    const expiredEntries = await pick('entries');
    let works = 0;
    for (const id of expiredWorks) {
      // A legacy arbitrary path lacks a safe deletion token; retain it for manual migration.
      if (await tx.get('SELECT id FROM works WHERE id=? AND cover_path IS NOT NULL AND cover_token IS NULL', [id])) { continue; }
      await purgeIn(tx, 'work', id); works++;
    }
    let entries = 0; let chapters = 0;
    for (const id of expiredEntries) {
      if (await tx.get('SELECT id FROM entries WHERE id=?', [id])) { await purgeIn(tx, 'entry', id); entries++; }
    }
    for (const id of expiredChapters) {
      if (await tx.get('SELECT id FROM chapters WHERE id=?', [id]) && !await hasChapterAnchorsIn(tx, id)) {
        await purgeIn(tx, 'chapter', id); chapters++;
      }
    }
    return { works, chapters, entries };
  });
}

export interface TrashItem {
  id: ID; kind: TrashKind; workId: ID; title: string; parentTitle: string | null; parentDeleted: boolean;
  deletedAt: string; remainingDays: number;
  /** Chapters: kind and the 正文 number it would get back on restore (S15d #4 "第 N 章 标题"). */
  chapterKind?: ChapterKind; chapterNumber?: number | null;
  /** Entries: the archive type (S15d #4 类型标签). */
  entryType?: EntryType;
  /** Works: live 正文 chapters (S15d #4 作品行副标题). */
  chapterCount?: number;
}
/** Independently deleted children remain listed when their work is also in the trash. */
export async function list(options: { kind?: TrashKind } = {}): Promise<TrashItem[]> {
  type Row = { id: string; kind: TrashKind; work_id: string; title: string | null; parent_title: string | null; parent_deleted: string | null; deleted_at: string;
    sub_kind: string | null; num: number | null; chapter_count: number | null };
  // A main chapter's number counts the live main chapters before its slot; a chapter whose volume is gone goes to the end of the first volume.
  const rows = await db().all<Row>(`
    SELECT w.id,'work' kind,w.id work_id,w.title,NULL parent_title,NULL parent_deleted,w.deleted_at,NULL sub_kind,NULL num,
      (SELECT count(*) FROM chapters m WHERE m.work_id=w.id AND m.deleted_at IS NULL AND m.kind='main') chapter_count
      FROM works w WHERE w.deleted_at IS NOT NULL
    UNION ALL SELECT c.id,'chapter',c.work_id,c.title,w.title,w.deleted_at,c.deleted_at,c.kind,
      CASE WHEN c.kind='main' THEN 1 + (SELECT count(*) FROM chapters o JOIN volumes ov ON ov.id=o.volume_id
        WHERE o.work_id=c.work_id AND o.deleted_at IS NULL AND o.kind='main' AND (
          ov.order_index < coalesce(v.order_index,(SELECT min(order_index) FROM volumes f WHERE f.work_id=c.work_id))
          OR (ov.order_index = coalesce(v.order_index,(SELECT min(order_index) FROM volumes f WHERE f.work_id=c.work_id)) AND (v.id IS NULL OR o.order_index < c.order_index))))
      ELSE NULL END,NULL
      FROM chapters c JOIN works w ON w.id=c.work_id LEFT JOIN volumes v ON v.id=c.volume_id WHERE c.deleted_at IS NOT NULL
    UNION ALL SELECT e.id,'entry',e.work_id,e.name,w.title,w.deleted_at,e.deleted_at,e.type,NULL,NULL
      FROM entries e JOIN works w ON w.id=e.work_id WHERE e.deleted_at IS NOT NULL
    ORDER BY deleted_at DESC`);
  const now = isoMs(nowIso());
  return rows.filter(row => !options.kind || row.kind === options.kind).map(row => ({ id: row.id, kind: row.kind, workId: row.work_id,
    title: row.title || (row.kind === 'work' ? '未命名作品' : ''), parentTitle: row.kind === 'work' ? null : row.parent_title || '未命名作品',
    parentDeleted: !!row.parent_deleted, deletedAt: row.deleted_at, remainingDays: Math.max(1, RETENTION_DAYS - Math.floor((now - isoMs(row.deleted_at)) / 86400000)),
    ...(row.kind === 'chapter' ? { chapterKind: row.sub_kind as ChapterKind, chapterNumber: row.num == null ? null : Number(row.num) } : {}),
    ...(row.kind === 'entry' ? { entryType: row.sub_kind as EntryType } : {}),
    ...(row.kind === 'work' ? { chapterCount: Number(row.chapter_count ?? 0) } : {}) }));
}

async function hasChapterAnchorsIn(tx: Db, id: ID): Promise<boolean> {
  // Retired/history rows and recoverable entries still own their validity intervals.
  return Boolean(await tx.get(`SELECT id FROM entry_facts WHERE from_chapter_id=? OR to_chapter_id=?
    UNION ALL SELECT id FROM relations WHERE from_chapter_id=? OR to_chapter_id=? LIMIT 1`, [id, id, id, id]));
}
async function purgeIn(tx: Db, kind: TrashKind, id: ID): Promise<ID> {
  const table = kind === 'work' ? 'works' : kind === 'chapter' ? 'chapters' : 'entries';
  const row = await tx.get<{ id: string; work_id?: string; cover_path?: string | null; cover_token?: string | null }>(`SELECT * FROM ${table} WHERE id=? AND deleted_at IS NOT NULL`, [id]);
  if (!row) { throw notFound('回收站项目'); }
  const workId = kind === 'work' ? id : row.work_id!;
  if (kind === 'work') {
    if (row.cover_path && !row.cover_token) { throw new AppError('VALIDATION', '旧封面没有安全的文件所有权信息，请先保留此作品，避免删除其他文件。'); }
    if (row.cover_token) await covers.enqueueCleanupIn(tx, row.cover_token);
    await tx.run('DELETE FROM chapters WHERE work_id=?', [id]);
    await tx.run('DELETE FROM works WHERE id=?', [id]);
  } else if (kind === 'chapter') {
    if (await hasChapterAnchorsIn(tx, id)) {
      throw new AppError('CONFLICT_STATE', '档案字段或关系的生效历史仍引用这一章，暂不能彻底删除。请恢复章节并核对生效范围；删除整部作品时会一并删除所属历史。');
    }
    await tx.run('DELETE FROM conflicts WHERE chapter_id=?', [id]);
    await tx.run('DELETE FROM chapters WHERE id=?', [id]);
  } else {
    await tx.run('DELETE FROM conflicts WHERE entry_id=?', [id]);
    const receipts = await tx.all<{ id: string; entry_ids: string }>('SELECT id,entry_ids FROM adoption_receipts WHERE work_id=?', [workId]);
    for (const receipt of receipts) {
      let ids: string[] = []; try { ids = JSON.parse(receipt.entry_ids); } catch { /* invalid receipts are unusable */ }
      if (ids.includes(id)) { await tx.run('DELETE FROM adoption_receipts WHERE id=?', [receipt.id]); }
    }
    await tx.run('DELETE FROM entries WHERE id=?', [id]);
  }
  return workId;
}
function notifyPurge(workIds: ID[]) {
  for (const workId of new Set(workIds)) {
    emit('work.updated', { workId }); emit('chapters.changed', { workId }); emit('entries.changed', { workId, entryIds: [] });
    emit('jobs.changed', { workId }); emit('proposals.changed', { workId }); emit('conflicts.changed', { workId });
  }
}
export async function purge(kind: TrashKind, id: ID): Promise<void> {
  const workId = await db().transaction(tx => purgeIn(tx, kind, id));
  notifyPurge([workId]);
  await covers.retryCleanup();
}
/** One transaction: failures leave every item intact. */
export async function empty(): Promise<void> {
  const workIds: ID[] = [];
  await db().transaction(async tx => {
    // Delete whole selected owners first; independent chapter guards then see only surviving history.
    for (const table of [{ table: 'works', kind: 'work' }, { table: 'entries', kind: 'entry' }, { table: 'chapters', kind: 'chapter' }] as const) {
      const rows = await tx.all<{ id: string }>(`SELECT id FROM ${table.table} WHERE deleted_at IS NOT NULL`);
      for (const row of rows) { workIds.push(await purgeIn(tx, table.kind, row.id)); }
    }
  });
  notifyPurge(workIds);
  await covers.retryCleanup();
}

export const clear = empty;
