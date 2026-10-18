import { act } from 'react-test-renderer';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { setDb } from '../../src/data/db';
import * as prefs from '../../src/features/prefs';
import * as works from '../../src/features/works';
import { slipText } from '../../src/utils/format';
import { allText, press, renderApp, typeInto, until, wait } from '../helpers/render';

async function seeded() {
  const d = openMemoryDb();
  await migrate(d);
  setDb(d);
  const a = await works.create({ premise: '少年在废墟里捡到一面能映出星图的古镜', genre: 'xuanhuan', title: '星海之境' });
  await works.create({ premise: '雾港码头的连环失踪案', genre: 'xuanyi', title: '雾港疑案' });
  const b = await works.create({ premise: '无题的灵感' });
  await works.update(b.id, { status: 'finished' });
  return { d, a };
}

afterEach(() => {
  jest.useRealTimers();
});

test('empty shelf shows the first-step state without filters', async () => {
  const d = openMemoryDb();
  const r = await renderApp(d);
  const text = await until(r, s => s.includes('写下第一句灵感'));
  expect(text).toContain('新建作品');
  expect(text).not.toContain('全部 0');
  await act(async () => r.unmount());
});

test('lists works with counts, filters and remembers the filter', async () => {
  const { d } = await seeded();
  const r = await renderApp(d);
  const text = await until(r, s => s.includes('全部 3'));
  expect(text).toContain('连载中 2');
  expect(text).toContain('已完结 1');
  expect(text).toContain('未命名作品');
  expect(text).toContain('构思中 已完结');
  await press(r, '已完结 1');
  const filtered = allText(r);
  expect(filtered).not.toContain('星海之境\n');
  expect(await prefs.get('shelfFilter')).toBe('finished');
  await act(async () => r.unmount());
});

test('marking finished from the long-press menu updates counts and can be undone', async () => {
  const { d } = await seeded();
  const r = await renderApp(d);
  await until(r, s => s.includes('全部 3'));
  await press(r, /^星海之境，/, 'onLongPress');
  await until(r, s => s.includes('标记为已完结'));
  await press(r, '标记为已完结');
  await wait(400); // sheet close animation, then the action
  const text = await until(r, s => s.includes('已完结 2'));
  expect(text).toContain('已标记为已完结');
  await press(r, '撤销');
  await until(r, s => s.includes('已完结 1'));
  await act(async () => r.unmount());
});

test('deleting from the menu asks first and can be undone', async () => {
  const { d } = await seeded();
  const r = await renderApp(d);
  await until(r, s => s.includes('全部 3'));
  await press(r, /^雾港疑案，/, 'onLongPress');
  await until(r, s => s.includes('删除作品'));
  await press(r, '删除作品，移到回收站');
  await until(r, s => s.includes('删除「雾港疑案」？'));
  await press(r, '删除作品');
  await until(r, s => s.includes('全部 2'));
  expect(allText(r)).toContain('已移到回收站');
  await press(r, '撤销');
  await until(r, s => s.includes('全部 3'));
  await act(async () => r.unmount());
});

test('search highlights and excerpts', async () => {
  const { d } = await seeded();
  const r = await renderApp(d);
  await until(r, s => s.includes('全部 3'));
  await press(r, '搜索作品');
  await typeInto(r, '搜索书名、简介或题材', '星图');
  const text = await until(r, s => s.includes('找到 1 部作品'));
  expect(text).toContain('星图');
  await typeInto(r, '搜索书名、简介或题材', 'zzz');
  await until(r, s => s.includes('没有找到与「zzz」相关的作品'));
  await act(async () => r.unmount());
});

test('slip text strips punctuation and keeps 8 characters', () => {
  expect(slipText('星海之境：潮起篇的故事')?.join('')).toBe('星海之境潮起篇的');
  expect(slipText('  ……  ')).toBeNull();
});


test('empty shelf restore opens the real file recovery page', async () => {
  const d = openMemoryDb(); const r = await renderApp(d);
  await until(r, text => text.includes('写下第一句灵感'));
  await press(r, '从备份恢复');
  await until(r, text => text.includes('选择备份文件'));
  await press(r, '返回');
  await until(r, text => text.includes('写下第一句灵感'));
  await act(async () => r.unmount());
});
