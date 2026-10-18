/** Conflicts (G02 §5.9). Phase 1 only reads them for the editor bar and chapter badges. */
import { db } from '../data/db';
import type { Conflict, ConflictStatus, ID } from './types';

interface ConflictRow {
  id: string;
  work_id: string;
  chapter_id: string | null;
  entry_id: string | null;
  type: string;
  severity: string;
  a_label: string;
  a_ref: string;
  a_quote: string;
  b_label: string;
  b_ref: string;
  b_quote: string;
  explanation: string;
  suggestions: string;
  status: string;
  note: string | null;
  created_at: string;
}

const parseList = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

const toConflict = (r: ConflictRow): Conflict => ({
  id: r.id,
  workId: r.work_id,
  chapterId: r.chapter_id,
  entryId: r.entry_id,
  type: r.type as Conflict['type'],
  severity: r.severity as Conflict['severity'],
  a: { label: r.a_label, ref: r.a_ref, quote: r.a_quote },
  b: { label: r.b_label, ref: r.b_ref, quote: r.b_quote },
  explanation: r.explanation,
  suggestions: parseList(r.suggestions),
  status: r.status as ConflictStatus,
  note: r.note,
  createdAt: r.created_at,
});

const SEVERITY = "CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END";

/** Open and "later" conflicts of one chapter (editor bar, S07). */
export async function forChapter(chapterId: ID): Promise<Conflict[]> {
  const rows = await db().all<ConflictRow>(
    `SELECT * FROM conflicts WHERE chapter_id = ? AND status IN ('open','later') ORDER BY ${SEVERITY}, created_at DESC`,
    [chapterId],
  );
  return rows.map(toConflict);
}
