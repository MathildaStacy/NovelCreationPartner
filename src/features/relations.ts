/** Directed relationships, including per-chapter validity (G02 §5.6). */
import { db } from '../data/db';
import { nowIso, uuid } from '../utils/id';
import { chapterOrderIn, relationsIn, requireChapterIn, requireEntryIn } from './archiveSupport';
import { AppError, notFound, validation } from './errors';
import { emit } from './events';
import { requireLength } from './validate';
import type { ID, Relation } from './types';

export async function list(entryId: ID, options: { atChapterId?: ID } = {}): Promise<Relation[]> {
  return relationsIn(db(), entryId, options.atChapterId);
}
export async function upsert(input: {
  id?: ID; fromEntryId: ID; toEntryId: ID; kind: string; note?: string | null;
  fromChapterId?: ID | null; toChapterId?: ID | null;
}): Promise<Relation> {
  let workId = '';
  const id = input.id ?? uuid();
  await db().transaction(async tx => {
    const a = await requireEntryIn(tx, input.fromEntryId);
    const b = await requireEntryIn(tx, input.toEntryId);
    workId = a.work_id;
    if (a.work_id !== b.work_id || a.id === b.id) { throw validation('toEntryId', '请选择同作品的其他条目'); }
    if (input.id && !(await tx.get('SELECT id FROM relations WHERE id = ? AND work_id = ? AND deleted_at IS NULL', [id, workId]))) {
      throw notFound('关系');
    }
    await requireChapterIn(tx, workId, input.fromChapterId);
    await requireChapterIn(tx, workId, input.toChapterId);
    const { rank } = await chapterOrderIn(tx, workId);
    if (input.fromChapterId && input.toChapterId && rank.get(input.toChapterId)! < rank.get(input.fromChapterId)!) {
      throw validation('toChapterId', '结束章节不能早于生效章节');
    }
    const kind = requireLength('kind', input.kind, 1, 10, '关系类型');
    const note = requireLength('note', input.note, 0, 100, '关系说明') || null;
    const peers = await tx.all<{ from_chapter_id: ID | null; to_chapter_id: ID | null }>(
      `SELECT from_chapter_id, to_chapter_id FROM relations WHERE work_id = ? AND from_entry = ?
        AND to_entry = ? AND kind = ? AND deleted_at IS NULL AND id != ?`, [workId, a.id, b.id, kind, id]);
    const fromRank = input.fromChapterId ? rank.get(input.fromChapterId)! : -Infinity;
    const toRank = input.toChapterId ? rank.get(input.toChapterId)! : Infinity;
    if (peers.some(peer => {
      const peerFrom = peer.from_chapter_id ? rank.get(peer.from_chapter_id) : -Infinity;
      const peerTo = peer.to_chapter_id ? rank.get(peer.to_chapter_id) : Infinity;
      return peerFrom !== undefined && peerTo !== undefined && fromRank <= peerTo && toRank >= peerFrom;
    })) { throw new AppError('DUPLICATE', '已有这条关系'); }
    const now = nowIso();
    await tx.run(`INSERT INTO relations (id, work_id, from_entry, to_entry, kind, note, from_chapter_id,
      to_chapter_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?)
      ON CONFLICT(id) DO UPDATE SET from_entry = excluded.from_entry, to_entry = excluded.to_entry,
        kind = excluded.kind, note = excluded.note, from_chapter_id = excluded.from_chapter_id,
        to_chapter_id = excluded.to_chapter_id, updated_at = excluded.updated_at`,
    [id, workId, a.id, b.id, kind, note, input.fromChapterId ?? null, input.toChapterId ?? null, now, now]);
  });
  emit('entries.changed', { workId, entryIds: [input.fromEntryId, input.toEntryId] });
  return (await list(input.fromEntryId)).find(r => r.id === id)!;
}
export async function end(id: ID, atChapterId: ID): Promise<void> {
  const row = await db().get<{ from_entry: string }>('SELECT from_entry FROM relations WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!row) { throw notFound('关系'); }
  const relation = (await list(row.from_entry)).find(r => r.id === id);
  if (!relation) { throw notFound('关系'); }
  await upsert({ ...relation, id, toChapterId: atChapterId });
}
export async function remove(id: ID): Promise<void> {
  let workId = '';
  let entryIds: ID[] = [];
  await db().transaction(async tx => {
    const row = await tx.get<{ work_id: string; from_entry: string; to_entry: string }>(
      'SELECT work_id, from_entry, to_entry FROM relations WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) { throw notFound('关系'); }
    await requireEntryIn(tx, row.from_entry);
    workId = row.work_id; entryIds = [row.from_entry, row.to_entry];
    await tx.run('DELETE FROM relations WHERE id = ?', [id]);
  });
  emit('entries.changed', { workId, entryIds });
}
