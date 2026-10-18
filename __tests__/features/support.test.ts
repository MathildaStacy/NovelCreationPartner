import { db } from '../../src/data/db';
import * as chapters from '../../src/features/chapters';
import * as conflicts from '../../src/features/conflicts';
import { isAppError } from '../../src/features/errors';
import { on } from '../../src/features/events';
import * as jobs from '../../src/features/jobs';
import { runStartupMaintenance } from '../../src/features/maintenance';
import * as modelServices from '../../src/features/modelServices';
import * as trash from '../../src/features/trash';
import * as volumes from '../../src/features/volumes';
import * as works from '../../src/features/works';
import { setClock } from '../../src/utils/id';
import { freshDb, tickingClock } from '../helpers/db';
import { setFileStoreDriver } from '../../src/files';

beforeEach(async () => {
  tickingClock();
  await freshDb();
});

async function newWork() {
  const w = await works.create({ premise: '灵感', genre: 'xuanhuan' });
  const [vol] = await volumes.list(w.id);
  return { w, vol };
}

const titles = async (workId: string) => (await chapters.list(workId)).flatMap(g => g.chapters.map(c => c.title));

describe('trash.restore', () => {
  test('work keeps updatedAt and returns to the shelf', async () => {
    const { w } = await newWork();
    const before = (await works.get(w.id)).updatedAt;
    const seen: string[] = [];
    on('work.updated', p => seen.push(p.workId));
    await works.remove(w.id);
    await trash.restore('work', w.id);
    expect((await works.get(w.id)).updatedAt).toBe(before);
    expect(seen).toEqual([w.id]);
    await expect(trash.restore('work', w.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('chapter returns to its old position', async () => {
    const { w, vol } = await newWork();
    const a = await chapters.create({ workId: w.id, volumeId: vol.id, title: 'A' });
    const b = await chapters.create({ workId: w.id, volumeId: vol.id, title: 'B' });
    await chapters.create({ workId: w.id, volumeId: vol.id, title: 'C' });
    await chapters.remove(b.id);
    expect(await titles(w.id)).toEqual(['A', 'C']);
    await trash.restore('chapter', b.id);
    expect(await titles(w.id)).toEqual(['A', 'B', 'C']);
    // After a reorder that reuses order indexes, the restored chapter still gets a unique slot.
    await chapters.remove(a.id);
    const live = (await chapters.list(w.id))[0].chapters.map(c => c.id);
    await chapters.reorder(w.id, [{ volumeId: vol.id, chapterIds: [...live].reverse() }]);
    await trash.restore('chapter', a.id);
    expect(await titles(w.id)).toEqual(['A', 'C', 'B']);
  });

  test('chapter of a deleted work is refused', async () => {
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    await chapters.remove(c.id);
    await works.remove(w.id);
    let caught: unknown;
    try {
      await trash.restore('chapter', c.id);
    } catch (e) {
      caught = e;
    }
    expect(isAppError(caught, 'CONFLICT_STATE')).toBe(true);
  });
});

describe('startup maintenance', () => {
  test('export cleanup failure is logged while later recovery still runs', async () => {
    const cleanup=jest.fn(async()=>{throw new Error('cache unavailable');});
    const recover=jest.spyOn(jobs,'recoverRunning');
    const log=jest.fn();
    setFileStoreDriver({cleanupExports:cleanup,pick:async()=>null,writeAndShare:async()=>'opened'});
    try {
      await runStartupMaintenance(log);
      expect(cleanup).toHaveBeenCalledWith();
      expect(log).toHaveBeenCalledWith('[startup] clean export files failed',expect.any(Error));
      expect(recover).toHaveBeenCalledTimes(1);
    } finally { setFileStoreDriver(undefined); recover.mockRestore(); }
  });
  test('purges trash older than 30 days with everything below it', async () => {
    const old = await newWork();
    const keep = await newWork();
    const c = await chapters.create({ workId: old.w.id, volumeId: old.vol.id });
    await chapters.saveBody(c.id, '正文', 0);
    await chapters.finalize(c.id);
    const k = await chapters.create({ workId: keep.w.id, volumeId: keep.vol.id });
    await works.remove(old.w.id);
    await chapters.remove(k.id);
    setClock(() => new Date(Date.parse('2026-12-01T09:00:00+08:00')));
    await runStartupMaintenance();
    const count = async (sql: string) => Number((await db().get<{ n: number }>(sql))?.n);
    expect(await count('SELECT count(*) n FROM works')).toBe(1);
    expect(await count('SELECT count(*) n FROM chapters')).toBe(0);
    expect(await count('SELECT count(*) n FROM chapter_versions')).toBe(0);
    expect(await count('SELECT count(*) n FROM jobs')).toBe(0);
    expect(await count('SELECT count(*) n FROM volumes')).toBe(1);
  });

  test('keeps recent trash and never requeues jobs whose source was deleted', async () => {
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    await chapters.saveBody(c.id, '正文', 0);
    await chapters.finalize(c.id);
    await db().run("UPDATE jobs SET status = 'running' WHERE kind = 'summarize'");
    await chapters.remove(c.id);
    await db().run("UPDATE jobs SET status = 'running'");
    await runStartupMaintenance();
    expect((await jobs.list(w.id)).map(j => [j.status,j.pauseReason])).toEqual([
      ['paused','no_service'], ['paused','no_service'], ['paused','no_service'],
    ]);
    expect(Number((await db().get<{ n: number }>('SELECT count(*) n FROM chapters'))?.n)).toBe(1);
  });
});

describe('jobs', () => {
  test('list active and pause without a model service', async () => {
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    await chapters.saveBody(c.id, '正文', 0);
    const { jobIds } = await chapters.finalize(c.id);
    expect((await jobs.list(w.id, { active: true })).map(j => j.id)).toEqual(jobIds);
    const seen: string[] = [];
    on('jobs.changed', p => seen.push(p.workId));
    expect(await jobs.pauseWithoutService()).toEqual([]);
    const after = await jobs.list(w.id, { active: true });
    expect(after.map(j => [j.status, j.pauseReason])).toEqual([
      ['paused', 'no_service'],
      ['paused', 'no_service'],
      ['paused', 'no_service'],
    ]);
    expect(seen).toEqual([]);
    expect(await jobs.pauseWithoutService()).toEqual([]);
  });

  test('does not pause when a service exists, or for works in the trash', async () => {
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    await chapters.saveBody(c.id, '正文', 0);
    await chapters.finalize(c.id);
    await works.remove(w.id);
    expect(await jobs.pauseWithoutService()).toEqual([]);
    await trash.restore('work', w.id);
    await db().run(
      `INSERT INTO model_services (id, name, protocol, base_url, model, is_default, created_at, updated_at)
       VALUES ('s1', 'Claude', 'anthropic_messages', 'https://api.anthropic.com', 'm', 1, 'x', 'x')`,
    );
    expect(await jobs.pauseWithoutService()).toEqual([]);
    expect((await modelServices.getDefault())?.name).toBe('Claude');
  });
});

describe('reads', () => {
  test('getDefault is null without services; forChapter lists open and later', async () => {
    expect(await modelServices.getDefault()).toBeNull();
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    const ins = (id: string, status: string, severity: string) =>
      db().run(
        `INSERT INTO conflicts (id, work_id, chapter_id, type, severity, a_label, a_ref, a_quote, b_label, b_ref, b_quote,
           explanation, status, fingerprint, created_at)
         VALUES (?, ?, ?, 'setting', ?, 'a', 'r', 'q', 'b', 'r', 'q', 'e', ?, ?, '2026-10-18T10:00:00.000+08:00')`,
        [id, w.id, c.id, severity, status, id],
      );
    await ins('x1', 'open', 'low');
    await ins('x2', 'later', 'high');
    await ins('x3', 'fixed_text', 'high');
    expect((await conflicts.forChapter(c.id)).map(x => x.id)).toEqual(['x2', 'x1']);
  });
});
