import { db } from '../../src/data/db';
import * as chapters from '../../src/features/chapters';
import * as proposals from '../../src/features/proposals';
import { diffBodies, inlineDiff } from '../../src/features/versions';
import * as volumes from '../../src/features/volumes';
import * as works from '../../src/features/works';
import { freshDb } from '../helpers/db';

beforeEach(freshDb);

test('reorder rejects missing and repeated empty volumes without changing the order', async () => {
  const w = await works.create({ premise: '排序' });
  const [first] = await volumes.list(w.id);
  const second = await volumes.create(w.id, '第二卷');
  const c = await chapters.create({ workId: w.id, volumeId: first.id });
  const invalid = [
    [{ volumeId: first.id, chapterIds: [c.id] }],
    [{ volumeId: first.id, chapterIds: [c.id] }, { volumeId: first.id, chapterIds: [] }],
  ];
  for (const layout of invalid) {
    await expect(chapters.reorder(w.id, layout)).rejects.toMatchObject({ code: 'VALIDATION', field: 'layout' });
  }
  expect((await chapters.get(c.id)).volumeId).toBe(first.id);
  await chapters.reorder(w.id, [
    { volumeId: first.id, chapterIds: [] },
    { volumeId: second.id, chapterIds: [c.id] },
  ]);
  expect((await chapters.get(c.id)).volumeId).toBe(second.id);
});

test('chapter deletion confirmation counts only pending proposals and rejects deleted parents', async () => {
  const w = await works.create({ premise: '提案' });
  const [v] = await volumes.list(w.id);
  const c = await chapters.create({ workId: w.id, volumeId: v.id });
  const other = await chapters.create({ workId: w.id, volumeId: v.id });
  expect(await proposals.pendingCount(c.id)).toBe(0);
  for (const [id, chapterId, status] of [['p1', c.id, 'pending'], ['p2', c.id, 'accepted'], ['p3', other.id, 'pending']]) {
    await db().run(
      `INSERT INTO memory_proposals (id, work_id, chapter_id, kind, target_type, target_name, after_value, evidence, confidence, status, created_at)
       VALUES (?, ?, ?, 'add', 'character', '人物', '内容', '原文', 'high', ?, '2026-10-18T12:00:00+08:00')`,
      [id, w.id, chapterId, status],
    );
  }
  expect(await proposals.pendingCount(c.id)).toBe(1);
  await works.remove(w.id);
  await expect(proposals.pendingCount(c.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('large paragraph diffs preserve both bodies and matching context within a bounded matrix', () => {
  const a = ['前缀', ...Array.from({ length: 2500 }, (_, i) => `甲${i}`), '后缀'].join('\n');
  const b = ['前缀', ...Array.from({ length: 2501 }, (_, i) => `乙${i}`), '后缀'].join('\n');
  const blocks = diffBodies(a, b);
  expect(blocks[0]).toEqual({ type: 'same', a: '前缀', b: '前缀' });
  expect(blocks[blocks.length - 1]).toEqual({ type: 'same', a: '后缀', b: '后缀' });
  expect(blocks.filter(x => 'a' in x).map(x => 'a' in x ? x.a : '').join('\n')).toBe(a);
  expect(blocks.filter(x => 'b' in x).map(x => 'b' in x ? x.b : '').join('\n')).toBe(b);
});

test('inline diff retains complete long paragraphs when the matrix budget is exceeded', () => {
  const a = '甲'.repeat(3000);
  const b = '乙'.repeat(3000);
  expect(inlineDiff(a, b)).toEqual([{ type: 'removed', text: a }, { type: 'added', text: b }]);
});
