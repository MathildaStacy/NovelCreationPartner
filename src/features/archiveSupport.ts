/** Transaction-aware archive primitives. Never open a second DB connection in a caller's transaction. */
import type { Db } from '../data/db';
import { listNumbered } from './chapters';
import { notFound, validation } from './errors';
import type { Entry, EntryFact, ID, MemoryState, Relation } from './types';

export interface EntryRow {
  id: string; work_id: string; type: Entry['type']; name: string; aliases: string; summary: string;
  state: MemoryState; source_kind: Entry['source']['kind']; source_ref: string | null;
  created_at: string; updated_at: string; deleted_at: string | null; retired_state?: MemoryState | null;
}
export interface FactRow {
  id: string; entry_id: string; field: string; value: string; state: MemoryState;
  from_chapter_id: string | null; to_chapter_id: string | null;
  source_kind: Entry['source']['kind']; source_ref: string | null; supersedes_id: string | null;
  created_at: string; is_current: number;
}
export const toEntry = (r: EntryRow): Entry => ({
  id: r.id, workId: r.work_id, type: r.type, name: r.name, aliases: JSON.parse(r.aliases), summary: r.summary,
  state: r.state, source: { kind: r.source_kind, ref: r.source_ref },
  createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
});
export const toFact = (r: FactRow): EntryFact => ({
  id: r.id, entryId: r.entry_id, field: r.field, value: r.value, state: r.state,
  fromChapterId: r.from_chapter_id, toChapterId: r.to_chapter_id,
  source: { kind: r.source_kind, ref: r.source_ref }, supersedesId: r.supersedes_id, createdAt: r.created_at,
});
export async function requireWorkIn(q: Db, id: ID): Promise<void> {
  if (!(await q.get('SELECT id FROM works WHERE id = ? AND deleted_at IS NULL', [id]))) {
    throw notFound('作品');
  }
}
export async function requireEntryIn(q: Db, id: ID): Promise<EntryRow> {
  const row = await q.get<EntryRow>(`SELECT e.* FROM entries e JOIN works w ON w.id = e.work_id
    WHERE e.id = ? AND e.deleted_at IS NULL AND w.deleted_at IS NULL`, [id]);
  if (!row) { throw notFound('档案条目'); }
  return row;
}
export async function chapterOrderIn(q: Db, workId: ID) {
  const chapters = await listNumbered(q, workId);
  return { chapters, rank: new Map(chapters.map((c, i) => [c.id, i])) };
}
export async function requireChapterIn(q: Db, workId: ID, chapterId: ID | null | undefined): Promise<void> {
  if (chapterId != null && !(await q.get(`SELECT id FROM chapters
    WHERE id = ? AND work_id = ? AND deleted_at IS NULL`, [chapterId, workId]))) {
    throw validation('fromChapterId', '生效章节不在当前作品中或已删除');
  }
}
export function inInterval(
  from: ID | null, to: ID | null, at: number, rank: Map<ID, number>,
): boolean {
  // Deleted chapter anchors do not become timeless facts.
  if ((from !== null && !rank.has(from)) || (to !== null && !rank.has(to))) { return false; }
  return (from === null || rank.get(from)! <= at) && (to === null || rank.get(to)! >= at);
}
export function effectiveFacts(rows: FactRow[], rank: Map<ID, number>, at = Infinity): FactRow[] {
  const chosen = new Map<string, FactRow>();
  for (const r of rows) {
    if (!r.is_current || r.state === 'PROPOSED' || !inInterval(r.from_chapter_id, r.to_chapter_id, at, rank)) { continue; }
    const prev = chosen.get(r.field);
    const rRank = r.from_chapter_id === null ? -1 : rank.get(r.from_chapter_id)!;
    const pRank = prev?.from_chapter_id == null ? -1 : rank.get(prev.from_chapter_id)!;
    if (!prev || rRank > pRank || (rRank === pRank && r.created_at >= prev.created_at)) { chosen.set(r.field, r); }
  }
  return [...chosen.values()].filter(r => r.state !== 'RETIRED' && r.value !== '');
}
export async function relationsIn(q: Db, entryId: ID, atChapterId?: ID): Promise<Relation[]> {
  const entry = await requireEntryIn(q, entryId);
  const { rank } = await chapterOrderIn(q, entry.work_id);
  await requireChapterIn(q, entry.work_id, atChapterId);
  const rows = await q.all<{
    id: string; work_id: string; from_entry: string; to_entry: string; from_name: string; to_name: string;
    kind: string; note: string | null; from_chapter_id: string | null; to_chapter_id: string | null; state: MemoryState;
  }>(`SELECT r.*, a.name AS from_name, b.name AS to_name FROM relations r
    JOIN entries a ON a.id = r.from_entry JOIN entries b ON b.id = r.to_entry
    WHERE (r.from_entry = ? OR r.to_entry = ?) AND r.work_id = ? AND r.deleted_at IS NULL
      AND a.deleted_at IS NULL AND b.deleted_at IS NULL ORDER BY r.created_at, r.id`, [entryId, entryId, entry.work_id]);
  return rows.filter(r => atChapterId === undefined || inInterval(r.from_chapter_id, r.to_chapter_id, rank.get(atChapterId)!, rank))
    .map(r => ({ id: r.id, workId: r.work_id, fromEntryId: r.from_entry, toEntryId: r.to_entry,
      fromName: r.from_name, toName: r.to_name, kind: r.kind, note: r.note,
      fromChapterId: r.from_chapter_id, toChapterId: r.to_chapter_id, state: r.state }));
}
