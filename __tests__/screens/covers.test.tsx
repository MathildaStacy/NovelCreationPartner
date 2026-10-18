import { act, type ReactTestRenderer } from 'react-test-renderer';
import * as covers from '../../src/features/covers';
import * as works from '../../src/features/works';
import { freshDb } from '../helpers/db';
import { allText, press, renderApp, until, wait } from '../helpers/render';
import type { Db } from '../../src/data/db';

const token = '11111111-1111-4111-8111-111111111111';
const image = { token, uri: `file:///private/novel/covers/${token}.jpg` };
let screen: ReactTestRenderer;
let d: Db;
let picker: jest.Mock;
beforeEach(async () => {
  d = await freshDb(); picker = jest.fn(async () => JSON.stringify(image));
  covers.setCoverStoreDriver({ pick: picker, importImage: jest.fn(), read: jest.fn(), remove: jest.fn(async () => {}), prune: jest.fn(async () => {}) });
});
afterEach(async () => { if (screen) await act(async () => screen.unmount()); covers.setCoverStoreDriver(undefined); await d.close(); });

test('work info cover commits independently and leaves the unsaved metadata draft protected', async () => {
  const work = await works.create({ title: '归潮', premise: '海边的古镜' });
  screen = await renderApp(d); await until(screen, text => text.includes('全部 1'));
  await press(screen, /^归潮，/); await until(screen, text => text.includes('故事档案速览'));
  await press(screen, '作品信息'); await until(screen, text => text.includes('连载状态'));
  await act(async () => { screen.root.findAll(node => node.props.accessibilityLabel === '书名' && typeof node.props.onChangeText === 'function')[0].props.onChangeText('草稿书名'); });
  await press(screen, '更换封面'); await until(screen, text => text.includes('从相册选择'));
  await press(screen, '从相册选择');
  await until(screen, text => text.includes('封面已更换')); await wait(350);
  expect((await works.get(work.id)).cover).toEqual({ kind: 'image', path: image.uri });
  expect((await works.get(work.id)).title).toBe('归潮');
  expect(screen.root.findAll(node => node.props.value === '草稿书名').length).toBeGreaterThan(0);
  await press(screen, '返回概览'); await until(screen, text => text.includes('放弃未保存的修改？'));
  await press(screen, '放弃修改'); await until(screen, text => text.includes('故事档案速览'));
  expect((await works.get(work.id)).title).toBe('归潮');
  expect((await works.get(work.id)).cover.kind).toBe('image');
});

test('shelf cover source opens after actions close and cancellation keeps author on shelf', async () => {
  const work = await works.create({ title: '归潮', premise: '海边的古镜' });
  picker.mockResolvedValueOnce(null);
  screen = await renderApp(d); await until(screen, text => text.includes('全部 1'));
  await press(screen, /^归潮，/, 'onLongPress'); await until(screen, text => text.includes('编辑作品信息'));
  await press(screen, '更换封面'); await until(screen, text => text.includes('从相册选择'));
  expect(allText(screen)).not.toContain('编辑作品信息');
  await press(screen, '从相册选择');
  await until(screen, text => text.includes('全部 1') && !text.includes('从相册选择'));
  expect(picker).toHaveBeenCalledTimes(1);
  expect((await works.get(work.id)).cover).toEqual({ kind: 'text' });
  expect(allText(screen)).not.toContain('作品信息');
});
