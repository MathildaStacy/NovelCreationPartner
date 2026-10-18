/** Read-only proposal support for the chapter deletion confirmation (G02 §5.8). */
import { db } from '../data/db';
import { notFound } from './errors';
import type { ID } from './types';

export async function pendingCount(chapterId: ID): Promise<number> {
  const row = await db().get<{ n: number }>(
    `SELECT (SELECT count(*) FROM memory_proposals p WHERE p.chapter_id = c.id AND p.status = 'pending') AS n
     FROM chapters c JOIN works w ON w.id = c.work_id
     WHERE c.id = ? AND c.deleted_at IS NULL AND w.deleted_at IS NULL`,
    [chapterId],
  );
  if (!row) {
    throw notFound('章节');
  }
  return Number(row.n);
}
