/** Chapters service (G02 §5.3, rules in §4.3 状态 / §4.4 编号 / §4.6 正文格式). */
import { db, type Db, type SqlValue } from '../data/db';
import { nowIso, uuid } from '../utils/id';
import { countChars, normalizeBody } from '../utils/text';
import { AppError, notFound, validation } from './errors';
import { emit } from './events';
import { requireLength } from './validate';
import { snapshotIn } from './versions';
import type { Chapter, ChapterKind, ChapterListItem, ChapterState, ID, JobKind, Volume } from './types';

interface ChapterRow {
  id: string;
  work_id: string;
  volume_id: string;
  title: string;
  kind: string;
  order_index: number;
  char_count: number;
  state: string;
  summary: string | null;
  finalized_version_id: string | null;
  updated_at: string;
  deleted_at: string | null;
  open_conflicts: number;
}

const LIST_COLUMNS = `c.id, c.work_id, c.volume_id, c.title, c.kind, c.order_index, c.char_count, c.state,
  c.summary, c.finalized_version_id, c.updated_at, c.deleted_at,
  (SELECT count(*) FROM conflicts x WHERE x.chapter_id = c.id AND x.status IN ('open','later')) AS open_conflicts`;

const toItem = (r: ChapterRow, number: number | null): ChapterListItem => ({
  id: r.id,
  workId: r.work_id,
  volumeId: r.volume_id,
  title: r.title,
  kind: r.kind as ChapterKind,
  order: Number(r.order_index),
  number,
  charCount: Number(r.char_count),
  state: r.state as ChapterState,
  summary: r.summary,
  finalizedVersionId: r.finalized_version_id,
  openConflictCount: Number(r.open_conflicts),
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

/** Live chapters of a work in reading order (volume order → order in volume), with 第 N 章 numbers. */
export async function listNumbered(q: Db, workId: ID): Promise<ChapterListItem[]> {
  const rows = await q.all<ChapterRow>(
    `SELECT ${LIST_COLUMNS} FROM chapters c JOIN volumes v ON v.id = c.volume_id
     WHERE c.work_id = ? AND c.deleted_at IS NULL
     ORDER BY v.order_index, c.order_index`,
    [workId],
  );
  let n = 0;
  return rows.map(r => toItem(r, r.kind === 'main' ? ++n : null));
}

export async function list(workId: ID): Promise<{ volume: Volume; chapters: ChapterListItem[] }[]> {
  const q = db();
  const volumes = await q.all<{ id: string; work_id: string; title: string; order_index: number }>(
    'SELECT * FROM volumes WHERE work_id = ? ORDER BY order_index',
    [workId],
  );
  const chapters = await listNumbered(q, workId);
  return volumes.map(v => ({
    volume: { id: v.id, workId: v.work_id, title: v.title, order: Number(v.order_index) },
    chapters: chapters.filter(c => c.volumeId === v.id),
  }));
}

async function liveRow(q: Db, id: ID) {
  const r = await q.get<{
    id: string;
    work_id: string;
    volume_id: string;
    kind: string;
    body: string;
    state: string;
    finalized_version_id: string | null;
    last_cursor: number;
  }>('SELECT id, work_id, volume_id, kind, body, state, finalized_version_id, last_cursor FROM chapters WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!r) {
    throw notFound('章节');
  }
  return r;
}

export async function numberOf(id: ID, q: Db = db()): Promise<number | null> {
  const r = await q.get<{ work_id: string }>('SELECT work_id FROM chapters WHERE id = ?', [id]);
  if (!r) {
    return null;
  }
  return (await listNumbered(q, r.work_id)).find(c => c.id === id)?.number ?? null;
}

export async function get(id: ID): Promise<Chapter> {
  const q = db();
  const row = await liveRow(q, id);
  const item = (await listNumbered(q, row.work_id)).find(c => c.id === id)!;
  return { ...item, body: row.body, lastCursor: Number(row.last_cursor) };
}

const KINDS: ChapterKind[] = ['main', 'extra', 'draft'];

export async function create(input: { workId: ID; volumeId: ID; title?: string; kind?: ChapterKind }): Promise<Chapter> {
  const kind = input.kind ?? 'main';
  if (!KINDS.includes(kind)) {
    throw validation('kind', '未知的章节类型');
  }
  const id = uuid();
  await db().transaction(async tx => {
    const vol = await tx.get('SELECT id FROM volumes WHERE id = ? AND work_id = ?', [input.volumeId, input.workId]);
    if (!vol) {
      throw notFound('卷');
    }
    let title = (input.title ?? '').trim();
    if (title === '') {
      const mains = (await listNumbered(tx, input.workId)).filter(c => c.kind === 'main').length;
      title = kind === 'main' ? `第 ${mains + 1} 章` : kind === 'extra' ? '番外' : '草稿';
    }
    title = requireLength('title', title, 1, 30, '章节标题');
    const max = await tx.get<{ m: number | null }>(
      'SELECT max(order_index) m FROM chapters WHERE volume_id = ?',
      [input.volumeId],
    );
    const now = nowIso();
    await tx.run(
      `INSERT INTO chapters (id, work_id, volume_id, title, kind, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.workId, input.volumeId, title, kind, (max?.m ?? -1) + 1, now, now],
    );
    await tx.run('UPDATE works SET updated_at = ? WHERE id = ?', [now, input.workId]);
  });
  emit('chapters.changed', { workId: input.workId });
  return get(id);
}

/** State after a body change (§4.3): finalized ↔ modified by comparing with the finalized version. */
async function nextState(q: Db, row: { state: string; finalized_version_id: string | null }, body: string): Promise<ChapterState> {
  if (row.state === 'draft' || !row.finalized_version_id) {
    return row.state as ChapterState;
  }
  const v = await q.get<{ body: string }>('SELECT body FROM chapter_versions WHERE id = ?', [row.finalized_version_id]);
  return v && v.body === body ? 'finalized' : 'modified';
}

export const LONG_CHAPTER = 20000;
export const TOO_LONG_CHAPTER = 50000;

async function writeBody(q: Db, row: Awaited<ReturnType<typeof liveRow>>, body: string, cursor: number) {
  const charCount = countChars(body);
  const state = await nextState(q, row, body);
  const now = nowIso();
  await q.run('UPDATE chapters SET body = ?, char_count = ?, state = ?, last_cursor = ?, updated_at = ? WHERE id = ?', [
    body,
    charCount,
    state,
    cursor,
    now,
    row.id,
  ]);
  await q.run('UPDATE works SET updated_at = ? WHERE id = ?', [now, row.work_id]);
  return { charCount, state };
}

/**
 * Autosave (2 s after typing stops, on leaving the editor, on app background).
 * Unchanged body: only the cursor is stored, nothing else changes and no event.
 */
export async function saveBody(
  id: ID,
  body: string,
  cursor: number,
): Promise<{ charCount: number; state: ChapterState; warning: 'long' | 'too_long' | null }> {
  const text = normalizeBody(body);
  let changed = false;
  let workId = '';
  const result = await db().transaction(async tx => {
    const row = await liveRow(tx, id);
    workId = row.work_id;
    if (row.body === text) {
      await tx.run('UPDATE chapters SET last_cursor = ? WHERE id = ?', [cursor, id]);
      return { charCount: countChars(text), state: row.state as ChapterState };
    }
    changed = true;
    return writeBody(tx, row, text, cursor);
  });
  if (changed) {
    emit('chapter.saved', { chapterId: id, workId, ...result });
  }
  const warning = result.charCount > TOO_LONG_CHAPTER ? 'too_long' : result.charCount > LONG_CHAPTER ? 'long' : null;
  return { ...result, warning };
}

export async function update(id: ID, patch: { title?: string; kind?: ChapterKind; volumeId?: ID }): Promise<void> {
  let workId = '';
  await db().transaction(async tx => {
    const row = await liveRow(tx, id);
    workId = row.work_id;
    const sets: string[] = [];
    const params: SqlValue[] = [];
    if (patch.title !== undefined) {
      sets.push('title = ?');
      params.push(requireLength('title', patch.title, 1, 30, '章节标题'));
    }
    if (patch.kind !== undefined && patch.kind !== row.kind) {
      if (!KINDS.includes(patch.kind)) {
        throw validation('kind', '未知的章节类型');
      }
      if (row.kind === 'main' && row.state !== 'draft') {
        throw validation('kind', '已定稿的章节不能改为番外或草稿，请先撤销定稿');
      }
      sets.push('kind = ?');
      params.push(patch.kind);
    }
    if (patch.volumeId !== undefined && patch.volumeId !== row.volume_id) {
      const vol = await tx.get('SELECT id FROM volumes WHERE id = ? AND work_id = ?', [patch.volumeId, row.work_id]);
      if (!vol) {
        throw notFound('卷');
      }
      const max = await tx.get<{ m: number | null }>('SELECT max(order_index) m FROM chapters WHERE volume_id = ?', [
        patch.volumeId,
      ]);
      sets.push('volume_id = ?', 'order_index = ?');
      params.push(patch.volumeId, (max?.m ?? -1) + 1);
    }
    if (sets.length) {
      await tx.run(`UPDATE chapters SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    }
  });
  emit('chapters.changed', { workId });
}

/** Submits the complete order after dragging, possibly across volumes. */
export async function reorder(workId: ID, layout: { volumeId: ID; chapterIds: ID[] }[]): Promise<void> {
  await db().transaction(async tx => {
    const live = await tx.all<{ id: string }>('SELECT id FROM chapters WHERE work_id = ? AND deleted_at IS NULL', [workId]);
    const vols = await tx.all<{ id: string }>('SELECT id FROM volumes WHERE work_id = ?', [workId]);
    const volIds = new Set(vols.map(v => v.id));
    const given = layout.flatMap(l => l.chapterIds);
    const liveIds = new Set(live.map(c => c.id));
    if (
      given.length !== liveIds.size ||
      new Set(given).size !== given.length ||
      given.some(cid => !liveIds.has(cid)) ||
      layout.length !== volIds.size ||
      new Set(layout.map(l => l.volumeId)).size !== layout.length ||
      layout.some(l => !volIds.has(l.volumeId))
    ) {
      throw validation('layout', '章节列表已变化，请刷新后重新排序');
    }
    for (const l of layout) {
      for (let i = 0; i < l.chapterIds.length; i++) {
        await tx.run('UPDATE chapters SET volume_id = ?, order_index = ? WHERE id = ?', [l.volumeId, i, l.chapterIds[i]]);
      }
    }
  });
  emit('chapters.changed', { workId });
}

/** Moves to the trash and cancels the chapter's queued jobs. Accepted memories stay. */
export async function remove(id: ID): Promise<void> {
  let workId = '';
  await db().transaction(async tx => {
    const row = await liveRow(tx, id);
    workId = row.work_id;
    await tx.run('UPDATE chapters SET deleted_at = ? WHERE id = ?', [nowIso(), id]);
    await cancelJobsFor(tx, { chapterId: id });
  });
  emit('chapters.changed', { workId });
}

/** Inserts or replaces AI text after a before_ai snapshot. Offsets refer to the stored body. */
export async function applyAiText(
  id: ID,
  input: { start: number; end: number; text: string; mode: 'insert' | 'replace' },
): Promise<{ body: string; cursor: number }> {
  let saved: { charCount: number; state: ChapterState } | null = null;
  let workId = '';
  const out = await db().transaction(async tx => {
    const row = await liveRow(tx, id);
    workId = row.work_id;
    const start = Math.max(0, Math.min(input.start, row.body.length));
    const end = input.mode === 'insert' ? start : Math.max(start, Math.min(input.end, row.body.length));
    await snapshotIn(tx, id, 'before_ai');
    const text = normalizeBody(input.text);
    const body = normalizeBody(row.body.slice(0, start) + text + row.body.slice(end));
    const cursor = Math.min(body.length, start + text.length);
    saved = await writeBody(tx, row, body, cursor);
    return { body, cursor };
  });
  emit('versions.changed', { chapterId: id });
  emit('chapter.saved', { chapterId: id, workId, ...saved! });
  return out;
}

const FINALIZE_JOBS: JobKind[] = ['summarize', 'extract_memory', 'detect_conflicts'];

/** Snapshot → 已定稿 → cancel old jobs → enqueue summarize, extract_memory, detect_conflicts. */
export async function finalize(id: ID): Promise<{ jobIds: ID[] }> {
  let workId = '';
  const jobIds: ID[] = [];
  await db().transaction(async tx => {
    const row = await liveRow(tx, id);
    workId = row.work_id;
    if (row.kind !== 'main') {
      throw validation('kind', '只有正文章节可以定稿');
    }
    if (countChars(row.body) === 0) {
      throw validation('body', '这一章还没有内容');
    }
    const version = await snapshotIn(tx, id, 'finalize');
    const now = nowIso();
    await tx.run("UPDATE chapters SET state = 'finalized', finalized_version_id = ?, updated_at = ? WHERE id = ?", [
      version.id,
      now,
      id,
    ]);
    await cancelJobsFor(tx, { chapterId: id });
    const service = await tx.get<{ id: string }>('SELECT id FROM model_services WHERE is_default = 1');
    for (let i = 0; i < FINALIZE_JOBS.length; i++) {
      const jobId = uuid();
      // All three share created_at; the queue orders by created_at, then rowid (insert order).
      await tx.run(
        `INSERT INTO jobs (id, work_id, kind, chapter_id, service_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
        [jobId, row.work_id, FINALIZE_JOBS[i], id, service?.id ?? null, now, now],
      );
      jobIds.push(jobId);
    }
  });
  emit('versions.changed', { chapterId: id });
  emit('chapters.changed', { workId });
  emit('jobs.changed', { workId });
  return { jobIds };
}

/** Back to 草稿; snapshots and accepted memories stay. */
export async function unfinalize(id: ID): Promise<void> {
  let workId = '';
  await db().transaction(async tx => {
    const row = await liveRow(tx, id);
    workId = row.work_id;
    if (row.state === 'draft') {
      throw new AppError('CONFLICT_STATE', '这一章还没有定稿');
    }
    await tx.run("UPDATE chapters SET state = 'draft' WHERE id = ?", [id]);
  });
  emit('chapters.changed', { workId });
}

/** Cancels unfinished jobs of a chapter or work (queued, paused, failed, running). */
export async function cancelJobsFor(q: Db, scope: { chapterId?: ID; workId?: ID }): Promise<number> {
  const col = scope.chapterId ? 'chapter_id' : 'work_id';
  const res = await q.run(
    `UPDATE jobs SET status = 'cancelled', pause_reason = NULL, updated_at = ?
     WHERE ${col} = ? AND status IN ('queued','paused','failed','running')`,
    [nowIso(), (scope.chapterId ?? scope.workId)!],
  );
  return res.changes;
}

/** Longest non-overlapping name matches for archive appearances and precise editor navigation. */
export async function findText(
  workId: ID, terms: string[], options: { kinds?: ChapterKind[] } = {},
): Promise<{ chapterId: ID; number: number | null; kind: ChapterKind; title: string; count: number; firstOffset: number; firstLength: number }[]> {
  const q = db();
  if (!(await q.get('SELECT id FROM works WHERE id = ? AND deleted_at IS NULL', [workId]))) { throw notFound('作品'); }
  const names = [...new Set(terms.map(term => term.trim()).filter(term => [...term].length >= 2))]
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  if (!names.length) { return []; }
  const kinds = options.kinds ?? ['main', 'extra'];
  const numbered = (await listNumbered(q, workId)).filter(c => kinds.includes(c.kind));
  const bodies = await q.all<{ id: ID; body: string }>('SELECT id, body FROM chapters WHERE work_id = ? AND deleted_at IS NULL', [workId]);
  const byId = new Map(bodies.map(c => [c.id, c.body]));
  const output: Awaited<ReturnType<typeof findText>> = [];
  for (const chapter of numbered) {
    const body = byId.get(chapter.id) ?? '';
    let count = 0; let firstOffset = -1; let firstLength = 0;
    for (let offset = 0; offset < body.length;) {
      const match = names.find(name => body.startsWith(name, offset));
      if (match) {
        if (!count) { firstOffset = offset; firstLength = match.length; }
        count++; offset += match.length;
      } else { offset++; }
    }
    if (count) { output.push({ chapterId: chapter.id, number: chapter.number, kind: chapter.kind,
      title: chapter.title, count, firstOffset, firstLength }); }
  }
  return output;
}
