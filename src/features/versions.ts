/** Versions service (G02 §5.4, retention rules §4.2). */
import { db, type Db } from '../data/db';
import { nowIso, uuid } from '../utils/id';
import { countChars } from '../utils/text';
import { notFound } from './errors';
import { emit } from './events';
import type { ChapterState, ChapterVersion, ID, VersionReason } from './types';

/** Max kept per chapter; reasons not listed are kept forever. */
export const RETENTION: Partial<Record<VersionReason, number>> = { auto: 50, before_ai: 30 };

interface VersionRow {
  id: string;
  chapter_id: string;
  reason: string;
  char_count: number;
  created_at: string;
}

const toVersion = (r: VersionRow): ChapterVersion => ({
  id: r.id,
  chapterId: r.chapter_id,
  reason: r.reason as VersionReason,
  charCount: Number(r.char_count),
  createdAt: r.created_at,
});

export async function list(chapterId: ID): Promise<ChapterVersion[]> {
  const rows = await db().all<VersionRow>(
    'SELECT id, chapter_id, reason, char_count, created_at FROM chapter_versions WHERE chapter_id = ? ORDER BY created_at DESC, rowid DESC',
    [chapterId],
  );
  return rows.map(toVersion);
}

export async function get(versionId: ID): Promise<{ version: ChapterVersion; body: string }> {
  const r = await db().get<VersionRow & { body: string }>('SELECT * FROM chapter_versions WHERE id = ?', [versionId]);
  if (!r) {
    throw notFound('版本');
  }
  return { version: toVersion(r), body: r.body };
}

/**
 * Snapshot inside an open transaction. When the body equals the latest snapshot
 * no new row is made and the latest is returned. If that latest one could later be
 * pruned (auto / before_ai) but the new reason is permanent, it is upgraded to the
 * new reason so a finalized or manual version is never pruned away.
 */
export async function snapshotIn(q: Db, chapterId: ID, reason: VersionReason): Promise<ChapterVersion> {
  const ch = await q.get<{ body: string }>('SELECT body FROM chapters WHERE id = ?', [chapterId]);
  if (!ch) {
    throw notFound('章节');
  }
  const latest = await q.get<VersionRow & { body: string }>(
    'SELECT * FROM chapter_versions WHERE chapter_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    [chapterId],
  );
  if (latest && latest.body === ch.body) {
    const latestPrunable = RETENTION[latest.reason as VersionReason] !== undefined;
    const newPermanent = RETENTION[reason] === undefined;
    if (latestPrunable && newPermanent) {
      await q.run('UPDATE chapter_versions SET reason = ? WHERE id = ?', [reason, latest.id]);
      return toVersion({ ...latest, reason });
    }
    return toVersion(latest);
  }
  const row: VersionRow = {
    id: uuid(),
    chapter_id: chapterId,
    reason,
    char_count: countChars(ch.body),
    created_at: nowIso(),
  };
  await q.run('INSERT INTO chapter_versions (id, chapter_id, body, reason, char_count, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    row.id,
    chapterId,
    ch.body,
    reason,
    row.char_count,
    row.created_at,
  ]);
  const max = RETENTION[reason];
  if (max !== undefined) {
    await q.run(
      `DELETE FROM chapter_versions WHERE id IN (
         SELECT id FROM chapter_versions WHERE chapter_id = ? AND reason = ?
         ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?)`,
      [chapterId, reason, max],
    );
  }
  return toVersion(row);
}

export async function snapshot(chapterId: ID, reason: VersionReason): Promise<ChapterVersion> {
  const v = await db().transaction(tx => snapshotIn(tx, chapterId, reason));
  emit('versions.changed', { chapterId });
  return v;
}

/** before_restore snapshot, then the old body replaces the current one; state per §4.3. */
export async function restore(chapterId: ID, versionId: ID): Promise<void> {
  let saved = { workId: '', charCount: 0, state: 'draft' as ChapterState };
  await db().transaction(async tx => {
    const ch = await tx.get<{ work_id: string; state: string; finalized_version_id: string | null }>(
      'SELECT work_id, state, finalized_version_id FROM chapters WHERE id = ? AND deleted_at IS NULL',
      [chapterId],
    );
    const v = await tx.get<{ body: string }>('SELECT body FROM chapter_versions WHERE id = ? AND chapter_id = ?', [
      versionId,
      chapterId,
    ]);
    if (!ch || !v) {
      throw notFound(ch ? '版本' : '章节');
    }
    await snapshotIn(tx, chapterId, 'before_restore');
    let state = ch.state as ChapterState;
    if (state !== 'draft' && ch.finalized_version_id) {
      const fin = await tx.get<{ body: string }>('SELECT body FROM chapter_versions WHERE id = ?', [ch.finalized_version_id]);
      state = fin?.body === v.body ? 'finalized' : 'modified';
    }
    const now = nowIso();
    const charCount = countChars(v.body);
    await tx.run('UPDATE chapters SET body = ?, char_count = ?, state = ?, last_cursor = 0, updated_at = ? WHERE id = ?', [
      v.body,
      charCount,
      state,
      now,
      chapterId,
    ]);
    await tx.run('UPDATE works SET updated_at = ? WHERE id = ?', [now, ch.work_id]);
    saved = { workId: ch.work_id, charCount, state };
  });
  emit('chapter.saved', { chapterId, ...saved });
  emit('versions.changed', { chapterId });
}

// ---- diff ---------------------------------------------------------------

export type InlinePart = { type: 'same' | 'added' | 'removed'; text: string };
export type DiffBlock =
  | { type: 'same'; a: string; b: string }
  | { type: 'added'; b: string }
  | { type: 'removed'; a: string }
  | { type: 'changed'; a: string; b: string; inline: InlinePart[] };

/** LCS table walk over two sequences; returns ops in order. */
function lcsOps<T>(a: T[], b: T[]): ('same' | 'removed' | 'added')[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: ('same' | 'removed' | 'added')[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push('same');
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push('removed');
      i++;
    } else {
      ops.push('added');
      j++;
    }
  }
  while (i++ < n) {
    ops.push('removed');
  }
  while (j++ < m) {
    ops.push('added');
  }
  return ops;
}

/** Above this many cells the character diff falls back to whole-paragraph replace. */
const MAX_INLINE_CELLS = 4_000_000;

export function inlineDiff(a: string, b: string): InlinePart[] {
  const ac = [...a];
  const bc = [...b];
  if (ac.length * bc.length > MAX_INLINE_CELLS) {
    return [
      { type: 'removed', text: a },
      { type: 'added', text: b },
    ];
  }
  const parts: InlinePart[] = [];
  let i = 0;
  let j = 0;
  for (const op of lcsOps(ac, bc)) {
    const ch = op === 'added' ? bc[j++] : ac[i++];
    if (op === 'same') {
      j++;
    }
    const last = parts[parts.length - 1];
    if (last && last.type === op) {
      last.text += ch;
    } else {
      parts.push({ type: op, text: ch });
    }
  }
  return parts;
}

/**
 * Paragraph diff, then character diff inside changed paragraphs. A run of removed
 * paragraphs directly followed by added ones is paired one-to-one as "changed".
 * One block per paragraph; folding unchanged runs is done by the UI (S07e).
 */
export function diffBodies(aBody: string, bBody: string): DiffBlock[] {
  const a = aBody === '' ? [] : aBody.split('\n');
  const b = bBody === '' ? [] : bBody.split('\n');
  const ops = lcsOps(a, b);
  const blocks: DiffBlock[] = [];
  let i = 0;
  let j = 0;
  let k = 0;
  while (k < ops.length) {
    if (ops[k] === 'same') {
      blocks.push({ type: 'same', a: a[i++], b: b[j++] });
      k++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (k < ops.length && ops[k] !== 'same') {
      if (ops[k] === 'removed') {
        removed.push(a[i++]);
      } else {
        added.push(b[j++]);
      }
      k++;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let p = 0; p < pairs; p++) {
      blocks.push({ type: 'changed', a: removed[p], b: added[p], inline: inlineDiff(removed[p], added[p]) });
    }
    removed.slice(pairs).forEach(t => blocks.push({ type: 'removed', a: t }));
    added.slice(pairs).forEach(t => blocks.push({ type: 'added', b: t }));
  }
  return blocks;
}

/** `a` may be 'current' (the chapter's live body). */
export async function diff(aVersionId: ID | 'current', bVersionId: ID): Promise<DiffBlock[]> {
  const b = await get(bVersionId);
  let aBody: string;
  if (aVersionId === 'current') {
    const ch = await db().get<{ body: string }>('SELECT body FROM chapters WHERE id = ?', [b.version.chapterId]);
    if (!ch) {
      throw notFound('章节');
    }
    aBody = ch.body;
  } else {
    aBody = (await get(aVersionId)).body;
  }
  return diffBodies(aBody, b.body);
}
