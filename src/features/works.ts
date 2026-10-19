/** Works service (G02 §5.1). */
import { db, type Db } from '../data/db';
import { nowIso, uuid } from '../utils/id';
import { charCount as lengthOf } from './validate';
import { notFound, validation } from './errors';
import { emit } from './events';
import { activeConflictSql } from './conflictVisibility';
import { GENRE_LABELS, type Genre, type ID, type Overview, type Work, type WorkStatus, type WorkSummary } from './types';
import { listNumbered } from './chapters';
import { FIELD_LABELS } from './entries';
import * as covers from './covers';

export interface WorkRow {
  id: string;
  title: string | null;
  genre: string | null;
  premise: string;
  style_note: string | null;
  status: string;
  planned_chapters: number | null;
  cover_path: string | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  deleted_at: string | null;
}

export const toWork = (r: WorkRow): Work => ({
  id: r.id,
  title: r.title,
  genre: (r.genre as Genre | null) ?? null,
  premise: r.premise,
  styleNote: r.style_note,
  status: r.status as WorkStatus,
  plannedChapters: r.planned_chapters,
  cover: r.cover_path ? { kind: 'image', path: r.cover_path } : { kind: 'text' },
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastOpenedAt: r.last_opened_at,
  deletedAt: r.deleted_at,
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);

/**
 * Excluding deleted; newest of lastOpenedAt / updatedAt first. chapterCount counts
 * main chapters only; charCount covers every live chapter (S05 字数口径).
 */
export async function list(opts: { status?: WorkStatus; query?: string } = {}): Promise<WorkSummary[]> {
  const where = ['w.deleted_at IS NULL'];
  const params: (string | number)[] = [];
  if (opts.status) {
    where.push('w.status = ?');
    params.push(opts.status);
  }
  const q = (opts.query ?? '').trim();
  if (q) {
    const like = `%${escapeLike(q.toLowerCase())}%`;
    const genres = (Object.keys(GENRE_LABELS) as Genre[]).filter(g =>
      GENRE_LABELS[g].toLowerCase().includes(q.toLowerCase()),
    );
    const genreSql = genres.length ? ` OR w.genre IN (${genres.map(() => '?').join(',')})` : '';
    where.push(
      `(lower(coalesce(w.title,'')) LIKE ? ESCAPE '\\' OR lower(w.premise) LIKE ? ESCAPE '\\'${genreSql})`,
    );
    params.push(like, like, ...genres);
  }
  const rows = await db().all<WorkRow & { chapter_count: number; char_count: number }>(
    `SELECT w.*,
       (SELECT count(*) FROM chapters c WHERE c.work_id = w.id AND c.deleted_at IS NULL AND c.kind = 'main') AS chapter_count,
       (SELECT coalesce(sum(c.char_count), 0) FROM chapters c WHERE c.work_id = w.id AND c.deleted_at IS NULL) AS char_count
     FROM works w WHERE ${where.join(' AND ')}
     ORDER BY max(coalesce(w.last_opened_at, ''), w.updated_at) DESC`,
    params,
  );
  return rows.map(r => ({ ...toWork(r), chapterCount: Number(r.chapter_count), charCount: Number(r.char_count) }));
}

export async function create(input: { premise: string; genre?: Genre | null; title?: string | null }): Promise<Work> {
  const premise = (input.premise ?? '').trim();
  const n = lengthOf(premise);
  if (n < 1) {
    throw validation('premise', '写一句话灵感再开始');
  }
  if (n > 2000) {
    throw validation('premise', '灵感最多 2000 字');
  }
  const title = normTitle(input.title);
  const now = nowIso();
  const id = uuid();
  await db().transaction(async tx => {
    await tx.run(
      `INSERT INTO works (id, title, genre, premise, status, created_at, updated_at, last_opened_at)
       VALUES (?, ?, ?, ?, 'ongoing', ?, ?, ?)`,
      [id, title, input.genre ?? null, premise, now, now, now],
    );
    await tx.run('INSERT INTO volumes (id, work_id, title, order_index) VALUES (?, ?, ?, 0)', [uuid(), id, '第一卷']);
  });
  emit('work.created', { workId: id });
  return get(id);
}

export async function get(id: ID, q: Db = db()): Promise<Work> {
  const r = await q.get<WorkRow>('SELECT * FROM works WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!r) {
    throw notFound('作品');
  }
  return toWork(r);
}

function normTitle(t: string | null | undefined): string | null {
  const v = (t ?? '').trim();
  if (lengthOf(v) > 30) {
    throw validation('title', '书名最多 30 字');
  }
  return v === '' ? null : v;
}

export interface WorkPatch {
  title?: string | null;
  genre?: Genre | null;
  premise?: string;
  styleNote?: string | null;
  plannedChapters?: number | null;
  status?: WorkStatus;
}

export async function update(id: ID, patch: WorkPatch): Promise<Work> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if ('title' in patch) {
    sets.push('title = ?');
    params.push(normTitle(patch.title));
  }
  if ('genre' in patch) {
    if (patch.genre != null && !(patch.genre in GENRE_LABELS)) {
      throw validation('genre', '未知的题材');
    }
    sets.push('genre = ?');
    params.push(patch.genre ?? null);
  }
  if ('premise' in patch) {
    const p = (patch.premise ?? '').trim();
    if (lengthOf(p) < 1 || lengthOf(p) > 2000) {
      throw validation('premise', '灵感需要 1–2000 字');
    }
    sets.push('premise = ?');
    params.push(p);
  }
  if ('styleNote' in patch) {
    const s = (patch.styleNote ?? '').trim();
    if (lengthOf(s) > 500) {
      throw validation('styleNote', '文风偏好最多 500 字');
    }
    sets.push('style_note = ?');
    params.push(s === '' ? null : s);
  }
  if ('plannedChapters' in patch) {
    const p = patch.plannedChapters;
    if (p != null && (!Number.isInteger(p) || p < 1 || p > 9999)) {
      throw validation('plannedChapters', '计划章数为 1–9999');
    }
    sets.push('planned_chapters = ?');
    params.push(p ?? null);
  }
  if ('status' in patch) {
    if (patch.status !== 'ongoing' && patch.status !== 'finished') {
      throw validation('status', '未知的状态');
    }
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (sets.length === 0) {
    return get(id);
  }
  sets.push('updated_at = ?');
  params.push(nowIso(), id);
  const res = await db().run(`UPDATE works SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params);
  if (res.changes === 0) {
    throw notFound('作品');
  }
  emit('work.updated', { workId: id });
  return get(id);
}

/** D06: native picker/normalization and transaction-safe private image ownership. */
export async function setCover(id: ID, choice: { kind: 'image' } | { kind: 'text' }): Promise<boolean> {
  return covers.set(id, choice);
}
/** Legacy/internal migration hook. New images must use setCover, never caller-provided paths. */
export async function setCoverPath(id: ID, path: string | null): Promise<void> {
  const res = await db().run('UPDATE works SET cover_path = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [
    path,
    nowIso(),
    id,
  ]);
  if (res.changes === 0) {
    throw notFound('作品');
  }
  emit('work.updated', { workId: id });
}

/** Called when entering a work. Does not change updatedAt. */
export async function touch(id: ID): Promise<void> {
  await db().run('UPDATE works SET last_opened_at = ? WHERE id = ?', [nowIso(), id]);
}

/**
 * Moves to the trash. The job queue skips jobs whose work is deleted, which
 * pauses them; restoring the work from the trash lets them run again.
 */
export async function remove(id: ID): Promise<void> {
  const res = await db().run('UPDATE works SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [nowIso(), id]);
  if (res.changes === 0) {
    throw notFound('作品');
  }
  emit('work.removed', { workId: id });
}

const EXCERPT = 60;

export async function overview(id: ID): Promise<Overview> {
  const q = db();
  const work = await get(id, q);
  const chapters = (await listNumbered(q, id)).filter(c => !c.deletedAt);
  const main = chapters.filter(c => c.kind === 'main');
  const last = [...chapters].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  let lastEdited: Overview['lastEdited'] = null;
  if (last) {
    const row = await q.get<{ body: string }>('SELECT body FROM chapters WHERE id = ?', [last.id]);
    const paras = (row?.body ?? '').split('\n').filter(p => p.trim() !== '');
    const tail = paras[paras.length - 1] ?? '';
    lastEdited = { chapterId: last.id, number: last.number, title: last.title, excerpt: [...tail].slice(0, EXCERPT).join('') };
  }
  const count = async (sql: string, params: (string | number)[] = [id]) =>
    Number((await q.get<{ n: number }>(sql, params))?.n ?? 0);
  const [conflicts, proposals, activeJobs, failedJobs] = await Promise.all([
    count(`SELECT count(*) n FROM conflicts x WHERE x.work_id = ? AND ${activeConflictSql('x')}`),
    count("SELECT count(*) n FROM memory_proposals p JOIN chapters c ON c.id = p.chapter_id WHERE p.work_id = ? AND p.status = 'pending' AND c.deleted_at IS NULL"),
    count("SELECT count(*) n FROM jobs WHERE work_id = ? AND status IN ('queued','running','paused')"),
    count("SELECT count(*) n FROM jobs WHERE work_id = ? AND status = 'failed'"),
  ]);
  const latest = conflicts ? await q.get<{ chapter_id: string | null; name: string | null; field: string | null }>(
    `SELECT x.chapter_id, e.name, f.field FROM conflicts x LEFT JOIN entries e ON e.id = x.entry_id
       LEFT JOIN entry_facts f ON x.b_ref = 'fact:' || f.id
     WHERE x.work_id = ? AND ${activeConflictSql('x')} ORDER BY x.created_at DESC LIMIT 1`, [id]) : undefined;
  const latestChapter = latest?.chapter_id ? chapters.find(ch => ch.id === latest.chapter_id) : undefined;
  const proposalChapterIds = proposals ? (await q.all<{ chapter_id: string }>(
    "SELECT DISTINCT p.chapter_id FROM memory_proposals p JOIN chapters c ON c.id = p.chapter_id WHERE p.work_id = ? AND p.status = 'pending' AND c.deleted_at IS NULL", [id])).map(r => r.chapter_id) : [];
  const live = "work_id = ? AND deleted_at IS NULL AND state <> 'RETIRED'";
  const [characters, others, foreshadows] = await Promise.all([
    count(`SELECT count(*) n FROM entries WHERE ${live} AND type = 'character'`),
    count(`SELECT count(*) n FROM entries WHERE ${live} AND type NOT IN ('character','foreshadow')`),
    count(`SELECT count(*) n FROM entries WHERE ${live} AND type = 'foreshadow'`),
  ]);
  // 未回收 = the current value of 伏笔 field "是否已回收" is not "yes" (missing counts as 未回收, S11).
  const foreshadowsOpen = await count(
    `SELECT count(*) n FROM entries e WHERE e.work_id = ? AND e.deleted_at IS NULL AND e.state <> 'RETIRED'
       AND e.type = 'foreshadow'
       AND NOT EXISTS (
         SELECT 1 FROM entry_facts f
         WHERE f.entry_id = e.id AND f.field = '是否已回收' AND f.value = 'yes'
           AND f.state <> 'PROPOSED' AND f.to_chapter_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM entry_facts n WHERE n.supersedes_id = f.id AND n.state <> 'PROPOSED'))`,
  );
  return {
    chapterCount: main.length,
    // 字数 covers all live chapters incl. extras and drafts (S05 §5); 章节数 only main ones.
    charCount: chapters.reduce((s, c) => s + c.charCount, 0),
    plannedChapters: work.plannedChapters,
    lastEdited,
    pending: { conflicts, proposals, activeJobs, failedJobs },
    pendingDetail: {
      latestConflict: latest ? { chapterNumber: latestChapter?.number ?? null, chapterTitle: latestChapter?.title ?? null, entryName: latest.name,
        fieldLabel: latest.field ? FIELD_LABELS[latest.field] ?? latest.field : null } : null,
      proposalChapterNumbers: proposalChapterIds.map(cid => chapters.find(ch => ch.id === cid)?.number ?? null),
    },
    archive: { characters, others, foreshadows, foreshadowsOpen },
  };
}
