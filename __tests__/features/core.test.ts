import { db } from '../../src/data/db';
import { SCHEMA_VERSION, migrate } from '../../src/data/migrations';
import * as chapters from '../../src/features/chapters';
import { isAppError } from '../../src/features/errors';
import { on } from '../../src/features/events';
import * as prefs from '../../src/features/prefs';
import * as versions from '../../src/features/versions';
import * as volumes from '../../src/features/volumes';
import * as works from '../../src/features/works';
import { countChars, normalizeBody } from '../../src/utils/text';
import { freshDb, tickingClock } from '../helpers/db';

beforeEach(async () => {
  tickingClock();
  await freshDb();
});

async function expectCode(p: Promise<unknown>, code: string) {
  let caught: unknown = null;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  expect(isAppError(caught) ? caught.code : caught).toBe(code);
}

async function newWork(premise = '少年在废墟里捡到一枚会说话的戒指') {
  const w = await works.create({ premise, genre: 'xuanhuan' });
  const [vol] = await volumes.list(w.id);
  return { w, vol };
}

describe('migrations', () => {
  test('sets user_version and is idempotent', async () => {
    const v = await db().get<{ user_version: number }>('PRAGMA user_version');
    expect(Number(v?.user_version)).toBe(SCHEMA_VERSION);
    expect(await migrate(db())).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION });
  });
});

describe('text rules', () => {
  test('countChars ignores whitespace incl. full-width space, counts emoji as 1', () => {
    expect(countChars('　　林舟 拔剑。\n😀')).toBe(6);
  });
  test('normalizeBody strips paragraph indents and CRLF', () => {
    expect(normalizeBody('　　第一段\r\n  第二段\r第三段')).toBe('第一段\n第二段\n第三段');
  });
});

describe('works', () => {
  test('create makes a default volume and validates premise', async () => {
    const { w, vol } = await newWork();
    expect(w.title).toBeNull();
    expect(w.status).toBe('ongoing');
    expect(w.cover).toEqual({ kind: 'text' });
    expect(vol.title).toBe('第一卷');
    await expectCode(works.create({ premise: '   ' }), 'VALIDATION');
    await expectCode(works.create({ premise: '字'.repeat(2001) }), 'VALIDATION');
  });

  test('list sorts by latest of lastOpenedAt/updatedAt, filters and searches', async () => {
    const a = (await newWork('甲：修仙的快递员')).w;
    const b = (await newWork('乙：深海城市的侦探')).w;
    await works.update(a.id, { title: '星海之境' });
    expect((await works.list()).map(x => x.id)).toEqual([a.id, b.id]);
    await works.touch(b.id);
    expect((await works.list())[0].id).toBe(b.id);

    await works.update(b.id, { status: 'finished' });
    expect((await works.list({ status: 'finished' })).map(x => x.id)).toEqual([b.id]);
    expect((await works.list({ query: '星海' })).map(x => x.id)).toEqual([a.id]);
    expect((await works.list({ query: '侦探' })).map(x => x.id)).toEqual([b.id]);
    expect((await works.list({ query: '玄幻' })).length).toBe(2);
    expect(await works.list({ query: '%' })).toEqual([]);
  });

  test('list counts main chapters, chars of all live chapters', async () => {
    const { w, vol } = await newWork();
    const c1 = await chapters.create({ workId: w.id, volumeId: vol.id });
    const c2 = await chapters.create({ workId: w.id, volumeId: vol.id, kind: 'extra' });
    await chapters.saveBody(c1.id, '一二三', 3);
    await chapters.saveBody(c2.id, '四五', 2);
    const [s] = await works.list();
    expect(s.chapterCount).toBe(1);
    expect(s.charCount).toBe(5);
  });

  test('update validates and normalises', async () => {
    const { w } = await newWork();
    expect((await works.update(w.id, { title: '  ' })).title).toBeNull();
    await expectCode(works.update(w.id, { title: '长'.repeat(31) }), 'VALIDATION');
    await expectCode(works.update(w.id, { plannedChapters: 0 }), 'VALIDATION');
    expect((await works.update(w.id, { plannedChapters: 300 })).plannedChapters).toBe(300);
  });

  test('remove hides the work and emits', async () => {
    const { w } = await newWork();
    const seen: string[] = [];
    on('work.removed', p => seen.push(p.workId));
    await works.remove(w.id);
    expect(await works.list()).toEqual([]);
    expect(seen).toEqual([w.id]);
    await expectCode(works.get(w.id), 'NOT_FOUND');
  });

  test('overview', async () => {
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    await chapters.saveBody(c.id, '第一段\n最后一段的内容', 0);
    const o = await works.overview(w.id);
    expect(o.chapterCount).toBe(1);
    expect(o.lastEdited).toMatchObject({ chapterId: c.id, number: 1, excerpt: '最后一段的内容' });
    expect(o.pending).toEqual({ conflicts: 0, proposals: 0, activeJobs: 0, failedJobs: 0 });
  });
});

describe('volumes', () => {
  test('create, rename, reorder, remove rules', async () => {
    const { w, vol } = await newWork();
    const v2 = await volumes.create(w.id, '第二卷');
    await volumes.rename(v2.id, '风起');
    await volumes.reorder(w.id, [v2.id, vol.id]);
    expect((await volumes.list(w.id)).map(v => v.title)).toEqual(['风起', '第一卷']);

    const c = await chapters.create({ workId: w.id, volumeId: v2.id });
    await chapters.remove(c.id);
    // A chapter in the trash still blocks deleting its volume.
    await expectCode(volumes.remove(v2.id), 'VALIDATION');
    await volumes.remove(vol.id);
    await expectCode(volumes.remove(v2.id), 'VALIDATION');
  });
});

describe('chapters', () => {
  test('numbering is continuous across volumes and skips extras and drafts', async () => {
    const { w, vol } = await newWork();
    const v2 = await volumes.create(w.id, '第二卷');
    const a = await chapters.create({ workId: w.id, volumeId: vol.id });
    const x = await chapters.create({ workId: w.id, volumeId: vol.id, kind: 'extra' });
    const b = await chapters.create({ workId: w.id, volumeId: v2.id });
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    expect([a.title, b.title, c.title]).toEqual(['第 1 章', '第 2 章', '第 3 章']);
    const groups = await chapters.list(w.id);
    expect(groups.map(g => g.chapters.map(ch => ch.number))).toEqual([[1, null, 2], [3]]);
    expect(await chapters.numberOf(b.id)).toBe(3);
    expect(x.number).toBeNull();

    await volumes.reorder(w.id, [v2.id, vol.id]);
    expect(await chapters.numberOf(b.id)).toBe(1);
  });

  test('saveBody normalises, counts, warns, and skips unchanged bodies', async () => {
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    const events: number[] = [];
    on('chapter.saved', p => events.push(p.charCount));
    const r = await chapters.saveBody(c.id, '　　林舟醒来。\r\n　　天还没亮。', 5);
    expect(r).toEqual({ charCount: 10, state: 'draft', warning: null });
    const before = await chapters.get(c.id);
    expect(before.body).toBe('林舟醒来。\n天还没亮。');

    await chapters.saveBody(c.id, before.body, 9);
    const after = await chapters.get(c.id);
    expect(after.lastCursor).toBe(9);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(events).toEqual([10]);

    expect((await chapters.saveBody(c.id, '字'.repeat(20001), 0)).warning).toBe('long');
    expect((await chapters.saveBody(c.id, '字'.repeat(50001), 0)).warning).toBe('too_long');
  });

  test('state: draft → finalized → modified → finalized when reverted', async () => {
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    await expectCode(chapters.finalize(c.id), 'VALIDATION');
    await chapters.saveBody(c.id, '定稿的内容', 0);
    const { jobIds } = await chapters.finalize(c.id);
    expect(jobIds).toHaveLength(3);
    expect((await chapters.get(c.id)).state).toBe('finalized');
    expect((await chapters.saveBody(c.id, '改过的内容', 0)).state).toBe('modified');
    expect((await chapters.saveBody(c.id, '定稿的内容', 0)).state).toBe('finalized');

    await expectCode(chapters.update(c.id, { kind: 'extra' }), 'VALIDATION');
    await chapters.unfinalize(c.id);
    expect((await chapters.saveBody(c.id, '再改', 0)).state).toBe('draft');
  });

  test('finalize queues three jobs in order and re-finalize cancels the old ones', async () => {
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    await chapters.saveBody(c.id, '内容', 0);
    const first = await chapters.finalize(c.id);
    await chapters.saveBody(c.id, '内容二', 0);
    await chapters.finalize(c.id);
    const jobs = await db().all<{ id: string; kind: string; status: string }>(
      'SELECT id, kind, status FROM jobs ORDER BY created_at, rowid',
    );
    expect(jobs.map(j => `${j.kind}:${j.status}`)).toEqual([
      'summarize:cancelled',
      'extract_memory:cancelled',
      'detect_conflicts:cancelled',
      'summarize:queued',
      'extract_memory:queued',
      'detect_conflicts:queued',
    ]);
    expect(jobs.slice(0, 3).map(j => j.id)).toEqual(first.jobIds);
  });

  test('extras and drafts cannot be finalized', async () => {
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id, kind: 'draft' });
    await chapters.saveBody(c.id, '内容', 0);
    await expectCode(chapters.finalize(c.id), 'VALIDATION');
  });

  test('reorder across volumes; stale layout is rejected', async () => {
    const { w, vol } = await newWork();
    const v2 = await volumes.create(w.id, '第二卷');
    const a = await chapters.create({ workId: w.id, volumeId: vol.id });
    const b = await chapters.create({ workId: w.id, volumeId: vol.id });
    await chapters.reorder(w.id, [
      { volumeId: vol.id, chapterIds: [b.id] },
      { volumeId: v2.id, chapterIds: [a.id] },
    ]);
    const groups = await chapters.list(w.id);
    expect(groups.map(g => g.chapters.map(ch => [ch.id, ch.number]))).toEqual([[[b.id, 1]], [[a.id, 2]]]);
    await expectCode(chapters.reorder(w.id, [{ volumeId: vol.id, chapterIds: [a.id] }]), 'VALIDATION');
  });

  test('update moves to the end of the target volume', async () => {
    const { w, vol } = await newWork();
    const v2 = await volumes.create(w.id, '第二卷');
    const a = await chapters.create({ workId: w.id, volumeId: vol.id });
    const b = await chapters.create({ workId: w.id, volumeId: v2.id });
    await chapters.update(a.id, { volumeId: v2.id, title: '重逢' });
    const groups = await chapters.list(w.id);
    expect(groups[1].chapters.map(ch => ch.id)).toEqual([b.id, a.id]);
    expect(groups[1].chapters[1].title).toBe('重逢');
    await expectCode(chapters.update(a.id, { title: '' }), 'VALIDATION');
  });

  test('remove cancels the chapter jobs and renumbers', async () => {
    const { w, vol } = await newWork();
    const a = await chapters.create({ workId: w.id, volumeId: vol.id });
    const b = await chapters.create({ workId: w.id, volumeId: vol.id });
    await chapters.saveBody(a.id, '内容', 0);
    await chapters.finalize(a.id);
    await chapters.remove(a.id);
    expect(await chapters.numberOf(b.id)).toBe(1);
    const st = await db().all<{ status: string }>('SELECT DISTINCT status FROM jobs');
    expect(st).toEqual([{ status: 'cancelled' }]);
    await expectCode(chapters.get(a.id), 'NOT_FOUND');
  });

  test('applyAiText snapshots first, then inserts or replaces', async () => {
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    await chapters.saveBody(c.id, '他推开门。', 0);
    const r1 = await chapters.applyAiText(c.id, { start: 2, end: 2, text: '用力', mode: 'insert' });
    expect(r1).toEqual({ body: '他推用力开门。', cursor: 4 });
    const r2 = await chapters.applyAiText(c.id, { start: 0, end: 1, text: '林舟', mode: 'replace' });
    expect(r2.body).toBe('林舟推用力开门。');
    const vs = await versions.list(c.id);
    expect(vs.map(v => v.reason)).toEqual(['before_ai', 'before_ai']);
    expect((await versions.get(vs[1].id)).body).toBe('他推开门。');
  });
});

describe('versions', () => {
  test('snapshot dedupes identical bodies and upgrades prunable ones', async () => {
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    await chapters.saveBody(c.id, '内容', 0);
    const a = await versions.snapshot(c.id, 'auto');
    const b = await versions.snapshot(c.id, 'auto');
    expect(b.id).toBe(a.id);
    const m = await versions.snapshot(c.id, 'manual');
    expect(m.id).toBe(a.id);
    expect((await versions.list(c.id)).map(v => v.reason)).toEqual(['manual']);
  });

  test('auto snapshots are capped at 50, manual ones are kept', async () => {
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    await chapters.saveBody(c.id, 'm', 0);
    await versions.snapshot(c.id, 'manual');
    for (let i = 0; i < 55; i++) {
      await chapters.saveBody(c.id, `第${i}稿`, 0);
      await versions.snapshot(c.id, 'auto');
    }
    const vs = await versions.list(c.id);
    expect(vs.filter(v => v.reason === 'auto')).toHaveLength(50);
    expect(vs.filter(v => v.reason === 'manual')).toHaveLength(1);
  });

  test('restore takes a before_restore snapshot and recomputes state', async () => {
    const { w, vol } = await newWork();
    const c = await chapters.create({ workId: w.id, volumeId: vol.id });
    await chapters.saveBody(c.id, '定稿', 0);
    await chapters.finalize(c.id);
    const finV = (await versions.list(c.id))[0];
    await chapters.saveBody(c.id, '改了', 0);
    await versions.restore(c.id, finV.id);
    const ch = await chapters.get(c.id);
    expect(ch.body).toBe('定稿');
    expect(ch.state).toBe('finalized');
    expect((await versions.list(c.id)).map(v => v.reason)).toEqual(['before_restore', 'finalize']);
  });

  test('diff pairs changed paragraphs and diffs characters', () => {
    const blocks = versions.diffBodies('甲\n林舟拔剑。\n乙\n删掉的', '甲\n林舟缓缓拔剑。\n乙\n新增的\n再一段');
    expect(blocks.map(b => b.type)).toEqual(['same', 'changed', 'same', 'changed', 'added']);
    const changed = blocks[1];
    expect(changed.type === 'changed' && changed.inline).toEqual([
      { type: 'same', text: '林舟' },
      { type: 'added', text: '缓缓' },
      { type: 'same', text: '拔剑。' },
    ]);
  });
});

describe('prefs', () => {
  test('defaults, set, and event', async () => {
    expect(await prefs.get('editorFontSize')).toBe(18);
    const keys: string[] = [];
    on('prefs.changed', p => keys.push(p.key));
    await prefs.set('shelfFilter', 'finished');
    expect(await prefs.get('shelfFilter')).toBe('finished');
    expect(keys).toEqual(['shelfFilter']);
  });
});

describe('transactions', () => {
  test('a failing transaction rolls back and later work proceeds', async () => {
    await expect(
      db().transaction(async tx => {
        await tx.run("INSERT INTO preferences (key, value) VALUES ('x', '1')");
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db().get("SELECT * FROM preferences WHERE key = 'x'")).toBeUndefined();
  });

  test('concurrent calls do not interleave inside a transaction', async () => {
    const order: string[] = [];
    await Promise.all([
      db().transaction(async tx => {
        order.push('tx-start');
        await tx.run("INSERT INTO preferences (key, value) VALUES ('a', '1')");
        await new Promise<void>(r => setTimeout(() => r(), 5));
        order.push('tx-end');
      }),
      db()
        .get('SELECT 1')
        .then(() => order.push('outside')),
    ]);
    expect(order).toEqual(['tx-start', 'tx-end', 'outside']);
  });
});
