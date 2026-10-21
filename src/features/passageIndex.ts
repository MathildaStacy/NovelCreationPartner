/**
 * Maintenance of the derived history-passage index (`chapter_chunks`, `chunk_mentions`).
 *
 * Freshness rules:
 * - a chapter body change deletes that chapter's chunks inside the same SQL statement
 *   (trigger `passage_body_changed`), so existing chunks always describe the current body;
 * - every chunk row stores the body hash, the chunking policy and the hash of the name
 *   set its mentions were computed with; a different name set or policy is stale;
 * - each rebuild replaces one chapter's chunks and mentions in one transaction.
 */
import { db, type Db } from '../data/db';
import { fingerprint } from '../ai/context/fingerprint';
import { PASSAGE_POLICY, splitPassageChunks, type PassageChunk } from '../ai/retrieval/chunking';
import { matchableName, NameMatcher, type NamePattern } from '../ai/retrieval/matcher';
import { uuid } from '../utils/id';
import { record } from './passageMetrics';
import type { ID } from './types';

export interface WorkNames { hash: string; patterns: NamePattern<ID>[]; matcher: NameMatcher<ID>; }
const matcherCache = new Map<ID, WorkNames>();

/** All live entry names and aliases of the work (from `entry_names`), minus single characters. */
export async function namesIn(q: Db, workId: ID): Promise<WorkNames> {
  const rows = await q.all<{ entry_id: string; name: string }>(`SELECT n.entry_id, n.name FROM entry_names n JOIN entries e ON e.id = n.entry_id
    WHERE n.work_id = ? AND e.deleted_at IS NULL ORDER BY n.entry_id, n.name`, [workId]);
  const patterns = rows.filter(row => matchableName(row.name)).map(row => ({ name: row.name, value: row.entry_id }));
  const hash = fingerprint(patterns.map(pattern => [pattern.value, pattern.name]));
  const cached = matcherCache.get(workId);
  if (cached?.hash === hash) return cached;
  const names: WorkNames = { hash, patterns, matcher: new NameMatcher(patterns) };
  matcherCache.set(workId, names);
  return names;
}

export interface ChapterIndexState {
  chapterId: ID;
  kind: string;
  charCount: number;
  chunks: number;
  namesHash: string | null;
  policy: string | null;
}
export type Freshness = 'fresh' | 'empty' | 'missing' | 'names' | 'policy';
export function freshness(state: ChapterIndexState, namesHash: string): Freshness {
  if (state.charCount === 0) return 'empty';
  if (!state.chunks) return 'missing';
  if (state.policy !== PASSAGE_POLICY) return 'policy';
  return state.namesHash === namesHash ? 'fresh' : 'names';
}

export async function indexStatesIn(q: Db, workId: ID): Promise<Map<ID, ChapterIndexState>> {
  const rows = await q.all<{ id: string; kind: string; char_count: number; chunks: number; names_hash: string | null; policy: string | null }>(`SELECT c.id, c.kind, c.char_count,
      (SELECT count(*) FROM chapter_chunks k WHERE k.chapter_id = c.id) chunks,
      (SELECT k.names_hash FROM chapter_chunks k WHERE k.chapter_id = c.id LIMIT 1) names_hash,
      (SELECT k.policy FROM chapter_chunks k WHERE k.chapter_id = c.id LIMIT 1) policy
    FROM chapters c WHERE c.work_id = ? AND c.deleted_at IS NULL`, [workId]);
  return new Map(rows.map(row => [row.id, { chapterId: row.id, kind: row.kind, charCount: Number(row.char_count), chunks: Number(row.chunks), namesHash: row.names_hash, policy: row.policy }]));
}

/** Mentions of one chunk text; exported for the temporary-scan path. */
export function mentionsOf(text: string, names: WorkNames): ID[] { return names.matcher.valuesIn(text); }

async function insertRows(q: Db, table: string, columns: string[], rows: (string | number)[][]): Promise<void> {
  const per = Math.max(1, Math.floor(400 / columns.length));
  for (let i = 0; i < rows.length; i += per) {
    const batch = rows.slice(i, i + per);
    await q.run(`INSERT OR IGNORE INTO ${table} (${columns.join(',')}) VALUES ${batch.map(() => `(${columns.map(() => '?').join(',')})`).join(',')}`, batch.flat());
  }
}

/** Replaces one chapter's chunks and mentions atomically. Returns false when the chapter is gone. */
export async function rebuildChapterIn(q: Db, chapterId: ID, names?: WorkNames): Promise<boolean> {
  const chapter = await q.get<{ work_id: string; body: string }>('SELECT work_id, body FROM chapters WHERE id = ? AND deleted_at IS NULL', [chapterId]);
  if (!chapter) return false;
  const workNames = names ?? await namesIn(q, chapter.work_id);
  const chunks = splitPassageChunks(chapter.body);
  const sourceHash = fingerprint(chapter.body);
  await q.run('DELETE FROM chunk_mentions WHERE chunk_id IN (SELECT id FROM chapter_chunks WHERE chapter_id = ?)', [chapterId]);
  await q.run('DELETE FROM chapter_chunks WHERE chapter_id = ?', [chapterId]);
  const ids = chunks.map(() => uuid());
  await insertRows(q, 'chapter_chunks', ['id', 'work_id', 'chapter_id', 'chunk_index', 'start_offset', 'end_offset', 'text', 'source_hash', 'names_hash', 'policy'],
    chunks.map((chunk, i) => [ids[i], chapter.work_id, chapterId, chunk.index, chunk.start, chunk.end, chunk.text, sourceHash, workNames.hash, PASSAGE_POLICY]));
  await insertRows(q, 'chunk_mentions', ['entry_id', 'chunk_id'], chunks.flatMap((chunk, i) => mentionsOf(chunk.text, workNames).map(entryId => [entryId, ids[i]])));
  return true;
}

/** Name or alias changes only recompute mentions; chunk boundaries stay. */
export async function refreshMentionsIn(q: Db, chapterId: ID, names: WorkNames): Promise<void> {
  const chunks = await q.all<{ id: string; text: string }>('SELECT id, text FROM chapter_chunks WHERE chapter_id = ? ORDER BY chunk_index', [chapterId]);
  await q.run('DELETE FROM chunk_mentions WHERE chunk_id IN (SELECT id FROM chapter_chunks WHERE chapter_id = ?)', [chapterId]);
  await insertRows(q, 'chunk_mentions', ['entry_id', 'chunk_id'], chunks.flatMap(chunk => mentionsOf(chunk.text, names).map(entryId => [entryId, chunk.id])));
  await q.run('UPDATE chapter_chunks SET names_hash = ? WHERE chapter_id = ?', [names.hash, chapterId]);
}

/** Brings one chapter up to date in its own transaction. */
export async function ensureChapter(chapterId: ID): Promise<Freshness | 'gone'> {
  return db().transaction(async tx => {
    const row = await tx.get<{ work_id: string }>('SELECT work_id FROM chapters WHERE id = ? AND deleted_at IS NULL', [chapterId]);
    if (!row) return 'gone';
    const names = await namesIn(tx, row.work_id);
    const state = (await indexStatesIn(tx, row.work_id)).get(chapterId);
    const status = state ? freshness(state, names.hash) : 'missing';
    if (status === 'names') await refreshMentionsIn(tx, chapterId, names);
    else if (status === 'missing' || status === 'policy') await rebuildChapterIn(tx, chapterId, names);
    return status;
  });
}

/**
 * One bounded batch of index maintenance for a work (stale chapters in reading order,
 * or only `chapterIds`). Each chapter is its own short transaction so typing never waits
 * long for the shared database lock.
 */
export async function refreshWork(workId: ID, options: { maxChapters?: number; chapterIds?: readonly ID[]; signal?: AbortSignal } = {}): Promise<{ updated: number; remaining: number }> {
  const started = Date.now();
  const q = db();
  const work = await q.get('SELECT id FROM works WHERE id = ? AND deleted_at IS NULL', [workId]);
  if (!work) return { updated: 0, remaining: 0 };
  const names = await namesIn(q, workId);
  const states = await indexStatesIn(q, workId);
  const order = await q.all<{ id: string }>(`SELECT c.id FROM chapters c JOIN volumes v ON v.id = c.volume_id
    WHERE c.work_id = ? AND c.deleted_at IS NULL ORDER BY v.order_index, c.order_index`, [workId]);
  const wanted = options.chapterIds ? new Set(options.chapterIds) : null;
  const stale = order.map(row => states.get(row.id)!).filter(state => state && (!wanted || wanted.has(state.chapterId)))
    .filter(state => !['fresh', 'empty'].includes(freshness(state, names.hash)));
  const limit = options.maxChapters ?? stale.length;
  let updated = 0;
  for (const state of stale.slice(0, limit)) {
    if (options.signal?.aborted) break;
    await ensureChapter(state.chapterId);
    updated++;
  }
  if (updated) record({ kind: 'index', ms: Date.now() - started, chapters: updated });
  return { updated, remaining: stale.length - updated };
}

/** Chunks of a body that is not (yet) indexed — the explicit temporary-scan path. */
export function scanChunks(body: string): PassageChunk[] { return splitPassageChunks(body); }
