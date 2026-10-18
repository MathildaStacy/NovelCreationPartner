import { act, type ReactTestRenderer } from 'react-test-renderer';
import * as modelServices from '../../src/features/modelServices';
import * as chapters from '../../src/features/chapters';
import * as volumes from '../../src/features/volumes';
import * as works from '../../src/features/works';
import { testConnection } from '../../src/ai/providers/connectionTest';
import { createProvider } from '../../src/ai/providers/httpProvider';
import { useOverlay } from '../../src/components/overlay/store';
import { setSecureDriver } from '../../src/secure';
import { allText, press, renderApp, typeInto, until } from '../helpers/render';
import { draft, fill, input, installSecure, result, setupDb, temporaryKey } from '../helpers/modelServices';

jest.mock('../../src/ai/providers/connectionTest', () => ({ testConnection: jest.fn() }));
jest.mock('../../src/ai/providers/httpProvider', () => ({ createProvider: jest.fn() }));

let screen: ReactTestRenderer | undefined;

beforeEach(() => {
  installSecure();
  jest.mocked(testConnection).mockReset();
  jest.mocked(testConnection).mockImplementation(async () => result());
  jest.mocked(createProvider).mockReset();
  jest.mocked(createProvider).mockImplementation(() => ({ listModels: jest.fn(async () => ['gpt-6-luna']), generate: jest.fn() }));
});

afterEach(async () => {
  if (screen) {
    await act(async () => screen?.unmount());
    screen = undefined;
  }
  setSecureDriver(undefined);
  jest.restoreAllMocks();
});

test('D03 connect opens S02 in create mode and returns to the untouched new-work form', async () => {
  const d = await setupDb();
  screen = await renderApp(d);
  const r = screen;
  await until(r, s => s.includes('写下第一句灵感'));
  await press(r, '新建作品');
  await typeInto(r, '写下脑海里的一个画面、人物或故事点子…', '雾中的灯塔');
  await press(r, '开始和 AI 构思');
  await until(r, s => s.includes('先连接一个模型服务'));
  await press(r, '连接模型');
  await until(r, s => s.includes('连接模型') && s.includes('Base URL'));
  expect(allText(r)).not.toContain('稍后再说');
  await fill(r, 'API Key', temporaryKey());
  await fill(r, '模型', 'gpt-6-luna');
  await press(r, '测试连接');
  await until(r, s => s.includes('连接成功'));
  await press(r, '保存');
  await until(r, s => s.includes('已保存模型服务。返回后可重新预览并发送。') && s.includes('开始和 AI 构思'));
  expect(input(r, '脑海里的画面或一句话灵感（必填）').props.value).toBe('雾中的灯塔');
  expect(await works.list()).toHaveLength(0);
  expect(await modelServices.list()).toHaveLength(1);
});

test('D03 for a default service without a Key opens S02 to edit that service', async () => {
  const d = await setupDb();
  const saved = (await modelServices.save(draft({ name: 'Restored' }), temporaryKey())).service;
  await d.run('UPDATE model_services SET has_key = 0, key_ref = NULL WHERE id = ?', [saved.id]);
  screen = await renderApp(d);
  const r = screen;
  await until(r, s => s.includes('写下第一句灵感'));
  await press(r, '新建作品');
  await typeInto(r, '写下脑海里的一个画面、人物或故事点子…', '雾中的灯塔');
  await press(r, '开始和 AI 构思');
  await until(r, s => s.includes('需要填写 API Key') && s.includes('「Restored」缺少 API Key，填写后才能使用。'));
  await press(r, '填写 Key');
  await until(r, s => s.includes('编辑模型服务') && s.includes('这个服务缺少 API Key，需要重新填写。'));
  await press(r, '返回');
  await until(r, s => s.includes('开始和 AI 构思') && !s.includes('编辑模型服务'));
  expect(useOverlay.getState().dialogs).toHaveLength(0);
  expect(await works.list()).toHaveLength(0);
});

test('D03 from the editor opens S02 above it and backing out returns to the chapter', async () => {
  const d = await setupDb();
  const work = await works.create({ title: '星海之境', premise: '海中的古镜' });
  const [volume] = await volumes.list(work.id);
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, title: '海边' });
  await chapters.saveBody(chapter.id, '风从海上来。', 3);
  screen = await renderApp(d);
  const r = screen;
  await until(r, s => s.includes('全部 1'));
  await press(r, /^星海之境，/);
  await until(r, s => s.includes('继续写作'));
  await press(r, '继续写作');
  await until(r, s => s.includes('定稿本章'));
  await press(r, '描写助手');
  await until(r, s => s.includes('先连接一个模型服务'));
  await press(r, '连接模型');
  await until(r, s => s.includes('Base URL') && s.includes('连接模型'));
  await press(r, '返回');
  await until(r, s => s.includes('定稿本章') && !s.includes('Base URL'));
  expect(useOverlay.getState().dialogs).toHaveLength(0);
  expect(await modelServices.list()).toHaveLength(0);
  expect((await chapters.get(chapter.id)).body).toBe('风从海上来。');
});
