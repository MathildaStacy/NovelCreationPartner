import { freshDb } from '../helpers/db';
import { db } from '../../src/data/db';
import * as works from '../../src/features/works';
import * as volumes from '../../src/features/volumes';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as conflicts from '../../src/features/conflicts';
import * as trash from '../../src/features/trash';
import * as appInfo from '../../src/features/appInfo';
import { errorDetailText } from '../../src/app/errors';
import { AppError } from '../../src/features/errors';
import { cancelledWithSummary } from '../../src/screens/work/JobsScreen';
import type { Job } from '../../src/features/types';

const mockInfo = jest.fn();
jest.mock('../../src/native/NativeAppInfo', () => ({ __esModule: true, default: { getInfo: () => mockInfo() } }));

async function fixture() {
  await freshDb();
  const work = await works.create({ title: '归潮', premise: '海边的古镜' });
  const [first] = await volumes.list(work.id);
  const chapter = await chapters.create({ workId: work.id, volumeId: first.id, title: '潮起' });
  const other = await chapters.create({ workId: work.id, volumeId: first.id, title: '潮落' });
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇', facts: [{ field: 'identity', value: '守灯人' }, { field: 'goal', value: '找回古镜' }] });
  const identity = entry.facts.find(f => f.field === 'identity')!;
  const insert = async (id: string, status = 'open', chapterId = chapter.id) => db().run(`INSERT INTO conflicts
    (id,work_id,chapter_id,entry_id,type,severity,a_label,a_ref,a_quote,b_label,b_ref,b_quote,explanation,suggestions,status,fingerprint,created_at)
    VALUES (?,?,?,?,'character','high','正文',?,'他是渔夫','档案',?,'守灯人','身份不一致','[]',?,?,?)`,
  [id, work.id, chapterId, entry.id, `chapter:${chapterId}`, `fact:${identity.id}`, status, id, new Date().toISOString()]);
  return { work, first, chapter, other, entry, identity, insert };
}

const stateOf = async (entryId: string) => (await entries.get(entryId)).state;
const factState = async (entryId: string, field: string) => (await entries.get(entryId)).facts.find(f => f.field === field)!.state;

test('an unresolved conflict marks the entry and the quoted field 有冲突, and resolving restores the original state', async () => {
  const { work, entry, insert } = await fixture();
  expect(await stateOf(entry.id)).toBe('CONFIRMED');
  await insert('c1');
  expect(await stateOf(entry.id)).toBe('CONFLICTED');
  expect(await factState(entry.id, 'identity')).toBe('CONFLICTED');
  expect(await factState(entry.id, 'goal')).toBe('CONFIRMED');
  expect((await entries.list(work.id, { states: ['CONFLICTED'] })).map(e => e.id)).toEqual([entry.id]);
  expect((await entries.counts(work.id)).byState.character.CONFLICTED).toBe(1);
  expect((await entries.counts(work.id)).byType.character).toBe(1);
  // 稍后处理 still counts as unresolved (G02 §5.9).
  await conflicts.resolve('c1', { status: 'later' });
  expect(await stateOf(entry.id)).toBe('CONFLICTED');
  await conflicts.resolve('c1', { status: 'intentional', note: '伏笔' });
  expect(await stateOf(entry.id)).toBe('CONFIRMED');
  expect(await factState(entry.id, 'identity')).toBe('CONFIRMED');
  expect(await entries.list(work.id, { states: ['CONFLICTED'] })).toEqual([]);
  // Reopening marks it again; the stored row never changed.
  await conflicts.reopen('c1');
  expect(await stateOf(entry.id)).toBe('CONFLICTED');
  expect((await db().get<{ state: string }>('SELECT state FROM entries WHERE id = ?', [entry.id]))?.state).toBe('CONFIRMED');
});

test('conflicts of a trashed chapter or entry are hidden from lists, badges and states until restored', async () => {
  const { work, chapter, other, entry, insert } = await fixture();
  await insert('c1', 'open', chapter.id);
  await insert('c2', 'later', other.id);
  const badge = async (id: string) => (await chapters.list(work.id))[0].chapters.find(c => c.id === id)?.openConflictCount;
  expect((await works.overview(work.id)).pending.conflicts).toBe(2);
  expect(await badge(chapter.id)).toBe(1);
  await chapters.remove(chapter.id);
  expect((await works.overview(work.id)).pending.conflicts).toBe(1);
  expect((await conflicts.list(work.id)).map(c => c.id)).toEqual(['c2']);
  expect((await entries.get(entry.id)).conflicts.map(c => c.id)).toEqual(['c2']);
  await chapters.remove(other.id);
  expect((await works.overview(work.id)).pending.conflicts).toBe(0);
  expect(await stateOf(entry.id)).toBe('CONFIRMED');
  await trash.restore('chapter', chapter.id);
  expect((await works.overview(work.id)).pending.conflicts).toBe(1);
  expect(await conflicts.forChapter(chapter.id)).toHaveLength(1);
  expect(await stateOf(entry.id)).toBe('CONFLICTED');
  await entries.remove(entry.id);
  expect((await works.overview(work.id)).pending.conflicts).toBe(0);
  expect(await conflicts.forChapter(chapter.id)).toEqual([]);
  await trash.restore('entry', entry.id);
  expect((await works.overview(work.id)).pending.conflicts).toBe(1);
});

test('saving S12a with a conflictId commits the archive edit and 已更新档案 together', async () => {
  const { work, entry, insert } = await fixture();
  await insert('c1');
  await insert('c2', 'superseded');
  await entries.update(entry.id, { facts: [{ field: 'identity', value: '渔夫' }] }, { conflictId: 'c1' });
  expect((await conflicts.get('c1')).status).toBe('updated_entry');
  expect(await stateOf(entry.id)).toBe('CONFIRMED');
  expect(await factState(entry.id, 'identity')).toBe('CONFIRMED');
  expect((await works.overview(work.id)).pending.conflicts).toBe(0);
  const history = await entries.history(entry.id);
  expect(history[0].sourceKind).toBe('conflict');
  // A superseded conflict keeps its status; the edit itself still saves.
  await entries.update(entry.id, { facts: [{ field: 'identity', value: '老渔夫' }] }, { conflictId: 'c2' });
  expect((await conflicts.get('c2')).status).toBe('superseded');
  // Unknown conflict: nothing is written.
  await expect(entries.update(entry.id, { facts: [{ field: 'identity', value: '船长' }] }, { conflictId: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await entries.get(entry.id)).facts.find(f => f.field === 'identity')!.value).toBe('老渔夫');
});

test('restoring a chapter whose volume was deleted reports the first volume it was placed in', async () => {
  const { work, first } = await fixture();
  await volumes.rename(first.id, '第一卷 · 潮');
  const second = await volumes.create(work.id, '远航');
  const moved = await chapters.create({ workId: work.id, volumeId: second.id, title: '远行' });
  await chapters.remove(moved.id);
  expect(await trash.restore('chapter', moved.id)).toEqual({});
  await chapters.remove(moved.id);
  // volumes.remove refuses while trashed chapters remain, so the "volume gone"
  // branch is a defensive fallback; simulate it directly.
  await db().run('PRAGMA foreign_keys = OFF');
  await db().run('DELETE FROM volumes WHERE id = ?', [second.id]);
  await db().run('PRAGMA foreign_keys = ON');
  expect(await trash.restore('chapter', moved.id)).toEqual({ movedToVolume: '第一卷 · 潮' });
  expect((await chapters.get(moved.id)).volumeId).toBe(first.id);
});

const job = (patch: Partial<Job>): Job => ({ id: 'x', workId: 'w', chapterId: 'ch', kind: 'extract_memory', status: 'queued', attempts: 0, error: null,
  createdAt: '', updatedAt: '', pauseReason: null, sourceVersionId: null, inputFingerprint: null, dependencyRevision: null, serviceId: null,
  serviceRevision: null, policyVersion: null, executionToken: null, operationId: null, candidateOffset: 0, ...patch });

test('cancelling a legacy summary never cancels unrelated jobs that also lack an operationId', () => {
  const summary = job({ id: 's', kind: 'summarize', status: 'paused', sourceVersionId: 'v1' });
  const list = [summary,
    job({ id: 'same', sourceVersionId: 'v1' }),
    job({ id: 'other-chapter', chapterId: 'ch2', sourceVersionId: 'v1' }),
    job({ id: 'other-version', sourceVersionId: 'v0' }),
    job({ id: 'no-version' }),
    job({ id: 'done', sourceVersionId: 'v1', status: 'done' }),
  ];
  expect(cancelledWithSummary(summary, list).map(j => j.id)).toEqual(['s', 'same']);
  const bare = job({ id: 'bare', kind: 'summarize' });
  expect(cancelledWithSummary(bare, [bare, job({ id: 'no-version' })]).map(j => j.id)).toEqual(['bare']);
  const current = job({ id: 'op', kind: 'summarize', operationId: 'o1', sourceVersionId: 'v1' });
  expect(cancelledWithSummary(current, [current, job({ id: 'child', operationId: 'o1' }), job({ id: 'legacy', sourceVersionId: 'v1' })]).map(j => j.id)).toEqual(['op', 'child']);
});

test('copied error details use the installed version, or say 未知 instead of a made-up number', async () => {
  const error = new AppError('DB_ERROR', 'boom');
  mockInfo.mockRejectedValueOnce(new Error('unavailable'));
  await appInfo.get();
  expect(errorDetailText(error, '保存失败')).toMatch(/App：未知，/);
  expect(errorDetailText(error, '保存失败')).not.toContain('0.0.1');
  mockInfo.mockResolvedValueOnce(JSON.stringify({ version: '2.4.1', build: '42', debug: false }));
  await appInfo.get();
  expect(errorDetailText(error, '保存失败')).toContain('App：2.4.1（构建 42），');
  // A later failed read keeps the last known good value.
  mockInfo.mockRejectedValueOnce(new Error('unavailable'));
  await appInfo.get();
  expect(appInfo.label()).toBe('2.4.1（构建 42）');
});
