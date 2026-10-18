/** Trash (G02 §4.1, §5.13). Phase 1: restore works and chapters, and the 30-day purge at startup. */
import { db } from '../data/db';
import { validateNamesIn } from './entries';
import type { EntryRow } from './archiveSupport';
import { isoMs, nowIso } from '../utils/id';
import { AppError, notFound } from './errors';
import { emit } from './events';
import type { ID, TrashKind } from './types';

export const RETENTION_DAYS = 30;

/**
 * Restores from the trash. A work keeps its updatedAt, so it returns to its old
 * place on the shelf. A chapter returns to its old place in its volume (later
 * chapters shift down by one); if the volume is gone it goes to the end of the
 * first volume. A chapter whose work is in the trash cannot be restored alone.
 */
export async function restore(kind: TrashKind, id: ID): Promise<void> {
  if (kind === 'work') {
    const res = await db().run('UPDATE works SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL', [id]);
    if (res.changes === 0) {
      throw notFound('作品');
    }
    emit('work.updated', { workId: id });
    return;
  }
  if (kind === 'chapter') {
    let workId = '';
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
        const first = await tx.get<{ id: string }>(
          'SELECT id FROM volumes WHERE work_id = ? ORDER BY order_index LIMIT 1',
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
      }
    });
    emit('chapters.changed', { workId });
    return;
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
  emit('entries.changed', { workId, entryIds: [id] });
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
    const works = await pick('works');
    const chapters = await pick('chapters');
    const entries = await pick('entries');
    for (const id of chapters) {
      await tx.run('DELETE FROM chapters WHERE id = ?', [id]);
    }
    for (const id of entries) {
      await tx.run('DELETE FROM entries WHERE id = ?', [id]);
    }
    for (const id of works) {
      // Chapters reference volumes without a cascade, so remove them first.
      await tx.run('DELETE FROM chapters WHERE work_id = ?', [id]);
      await tx.run('DELETE FROM works WHERE id = ?', [id]);
    }
    return { works: works.length, chapters: chapters.length, entries: entries.length };
  });
}
