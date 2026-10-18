import { act, type ReactTestRenderer } from 'react-test-renderer';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { setDb } from '../../src/data/db';
import * as chapters from '../../src/features/chapters';
import { emit } from '../../src/features/events';
import { AppError } from '../../src/features/errors';
import * as modelServices from '../../src/features/modelServices';
import * as volumes from '../../src/features/volumes';
import * as works from '../../src/features/works';
import { useOverlay } from '../../src/components/overlay/store';
import { allText, press, renderApp, typeInto, until, wait } from '../helpers/render';

let screen: ReactTestRenderer | undefined;

afterEach(async () => {
  if (screen) {
    await act(async () => screen?.unmount());
    screen = undefined;
  }
  jest.restoreAllMocks();
});

async function setup() {
  const d = openMemoryDb();
  await migrate(d);
  setDb(d);
  return d;
}

async function fill(label: string, text: string) {
  const inputs = screen!.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
  expect(inputs.length).toBeGreaterThan(0);
  await act(async () => inputs[inputs.length - 1].props.onChangeText(text));
}

test('offline creation only needs an inspiration and creates one unnamed work with its volume', async () => {
  const d = await setup();
  screen = await renderApp(d);
  await until(screen, s => s.includes('写下第一句灵感'));
  await press(screen, '新建作品');
  expect(screen.root.findAll(n => n.props.accessibilityLabel === '只创建作品，直接写' && n.props.accessibilityState?.disabled).length).toBeGreaterThan(0);
  await typeInto(screen, '写下脑海里的一个画面、人物或故事点子…', '  一座漂浮在云海里的城  ');
  await press(screen, '仙侠');
  await press(screen, '仙侠');
  await press(screen, '只创建作品，直接写');
  await until(screen, s => s.includes('故事档案速览'));
  const result = await works.list();
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ title: null, genre: null, premise: '一座漂浮在云海里的城' });
  expect(await volumes.list(result[0].id)).toHaveLength(1);
  expect(allText(screen)).toContain('新建第一章');
  expect(allText(screen)).not.toContain('待处理');
  await press(screen, '返回书架');
  await until(screen, s => s.includes('全部 1'));
});

test('new-work cancellation protects the form and AI fallback creates locally', async () => {
  const d = await setup();
  screen = await renderApp(d);
  await until(screen, s => s.includes('写下第一句灵感'));
  await press(screen, '新建作品');
  await typeInto(screen, '写下脑海里的一个画面、人物或故事点子…', '古镜倒映出尚未发生的战争');
  await press(screen, '取消');
  await until(screen, s => s.includes('放弃这部新作品？'));
  await press(screen, '继续编辑');
  expect(await works.list()).toHaveLength(0);
  await press(screen, '开始和 AI 构思');
  await until(screen, s => s.includes('先连接一个模型服务'));
  expect(await works.list()).toHaveLength(0);
  await press(screen, '不用 AI，继续写');
  await until(screen, s => s.includes('故事档案速览'));
  expect(await works.list()).toHaveLength(1);
});

test.each(['missing', 'configured', 'failure'] as const)(
  'leaving a new work discards a late %s model lookup without creating or showing overlays',
  async result => {
    const d = await setup();
    screen = await renderApp(d);
    await until(screen, s => s.includes('写下第一句灵感'));
    await press(screen, '新建作品');
    await typeInto(screen, '写下脑海里的一个画面、人物或故事点子…', '离开后不应保存的灵感');
    type DefaultService = Awaited<ReturnType<typeof modelServices.getDefault>>;
    let resolve!: (service: DefaultService) => void;
    let reject!: (reason: unknown) => void;
    const pending = new Promise<DefaultService>((done, fail) => { resolve = done; reject = fail; });
    const lookup = jest.spyOn(modelServices, 'getDefault').mockReturnValueOnce(pending);
    const create = jest.spyOn(works, 'create');
    await press(screen, '开始和 AI 构思');
    expect(lookup).toHaveBeenCalledTimes(1);
    await press(screen, '取消');
    await until(screen, s => s.includes('放弃这部新作品？'));
    await press(screen, '放弃');
    await until(screen, s => s.includes('写下第一句灵感') && !s.includes('开始和 AI 构思'));

    await act(async () => {
      if (result === 'failure') {
        reject(new AppError('DB_ERROR', 'Delayed model lookup failed'));
      } else {
        resolve(result === 'missing' ? null : {
          id: 'configured', name: 'My model', protocol: 'openai_responses',
          baseUrl: 'https://example.com/v1', model: 'my-model', isDefault: true,
          options: {
            maxOutputTokens: null, effort: 'default', authHeader: 'bearer',
            store: false, contextBudget: 24000, caps: {},
          },
          hasKey: true, lastTest: null,
        });
      }
    });
    await wait(0);
    expect(useOverlay.getState().dialogs).toHaveLength(0);
    expect(useOverlay.getState().toast).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(await works.list()).toHaveLength(0);
    expect(allText(screen)).toContain('写下第一句灵感');
    expect(allText(screen)).not.toContain('开始和 AI 构思');
  },
);

test('failed local creation keeps the form and a rapid retry creates only one work', async () => {
  const d = await setup();
  screen = await renderApp(d);
  await until(screen, s => s.includes('写下第一句灵感'));
  await press(screen, '新建作品');
  await typeInto(screen, '写下脑海里的一个画面、人物或故事点子…', '古镜倒映出尚未发生的战争');
  const create = jest.spyOn(works, 'create').mockRejectedValueOnce(new AppError('STORAGE_FULL', 'SQLITE_FULL'));
  await press(screen, '只创建作品，直接写');
  await until(screen, s => s.includes('手机存储空间不足'));
  await press(screen, '知道了');
  expect(await works.list()).toHaveLength(0);
  const button = screen.root.findAll(n => n.props.accessibilityLabel === '只创建作品，直接写' && typeof n.props.onPress === 'function').pop()!;
  await act(async () => { button.props.onPress(); button.props.onPress(); });
  await until(screen, s => s.includes('故事档案速览'));
  expect(create).toHaveBeenCalledTimes(2);
  expect((await works.list())[0].premise).toBe('古镜倒映出尚未发生的战争');
});

test('the overview creates the first chapter and opens it directly in the editor', async () => {
  const d = await setup();
  const work = await works.create({ title: '星海之境', premise: '海中的古镜' });
  screen = await renderApp(d);
  await until(screen, s => s.includes('全部 1'));
  await press(screen, /^星海之境，/);
  await until(screen, s => s.includes('故事档案速览'));
  await press(screen, '＋ 新建第一章');
  await until(screen, s => s.includes('创建并开始写'));
  await typeInto(screen, '给这一章起个标题', '海边的相遇');
  await press(screen, '创建并开始写');
  await until(screen, s => s.includes('定稿本章') && !s.includes('创建并开始写'));
  const list = await chapters.list(work.id);
  expect(list[0].chapters).toHaveLength(1);
  expect(list[0].chapters[0].title).toBe('海边的相遇');
});

test('work info validates, ignores surrounding whitespace, and saves only changed fields', async () => {
  const d = await setup();
  const work = await works.create({ title: '星海之境', premise: '海中的古镜' });
  screen = await renderApp(d);
  await until(screen, s => s.includes('全部 1'));
  await press(screen, /^星海之境，/);
  await until(screen, s => s.includes('故事档案速览'));
  await press(screen, '作品信息');
  await until(screen, s => s.includes('连载状态'));
  await fill('书名', '  星海之境  ');
  const saveDisabled = () => screen!.root.findAll(n => n.props.accessibilityLabel === '保存' && n.props.accessibilityState?.disabled).length > 0;
  expect(saveDisabled()).toBe(true);
  await fill('简介（一句话灵感）', '   ');
  expect(allText(screen)).toContain('简介不能为空');
  expect(saveDisabled()).toBe(true);
  await fill('简介（一句话灵感）', '海中的古镜');
  await fill('计划章数（选填）', '0');
  expect(allText(screen)).toContain('计划章数需在 1–9999 之间');
  await fill('计划章数（选填）', '12a');
  await fill('文风偏好（选填）', '  克制冷静  ');
  const update = jest.spyOn(works, 'update');
  await press(screen, '保存');
  await until(screen, s => s.includes('正文 0 / 计划 12 章'));
  expect(update).toHaveBeenCalledWith(work.id, { plannedChapters: 12, styleNote: '克制冷静' });
  expect(allText(screen)).toContain('正文 0 / 计划 12 章');
  expect(await works.get(work.id)).toMatchObject({ styleNote: '克制冷静', plannedChapters: 12 });
});

test('work info truncates pasted titles and discarded changes never reach the service', async () => {
  const d = await setup();
  const work = await works.create({ title: '星海之境', premise: '海中的古镜' });
  screen = await renderApp(d);
  await until(screen, s => s.includes('全部 1'));
  await press(screen, /^星海之境，/, 'onLongPress');
  await until(screen, s => s.includes('编辑作品信息'));
  await press(screen, '编辑作品信息');
  await until(screen, s => s.includes('连载状态'));
  await fill('书名', '星'.repeat(31));
  expect(allText(screen)).toContain('30 / 30');
  await press(screen, '返回书架');
  await until(screen, s => s.includes('放弃未保存的修改？'));
  await press(screen, '放弃修改');
  await until(screen, s => s.includes('全部 1'));
  expect((await works.get(work.id)).title).toBe('星海之境');
});

test('deleting from work info bypasses dirty guard and exposes the undo action on the shelf', async () => {
  const d = await setup();
  const work = await works.create({ title: '星海之境', premise: '海中的古镜' });
  screen = await renderApp(d);
  await until(screen, s => s.includes('全部 1'));
  await press(screen, /^星海之境，/);
  await until(screen, s => s.includes('故事档案速览'));
  await press(screen, '作品信息');
  await until(screen, s => s.includes('连载状态'));
  await fill('书名', '尚未保存的新书名');
  await press(screen, '删除作品');
  await until(screen, s => s.includes('删除「星海之境」？'));
  await press(screen, '删除作品');
  await until(screen, s => s.includes('写下第一句灵感'));
  expect(allText(screen)).not.toContain('放弃未保存的修改？');
  expect(await works.list()).toHaveLength(0);
  await press(screen, '撤销');
  await until(screen, s => s.includes('全部 1'));
  expect((await works.get(work.id)).title).toBe('星海之境');
});

test('overview refreshes the last nonempty paragraph and shows a truthful paused job state', async () => {
  const d = await setup();
  const work = await works.create({ title: '星海之境', premise: '海中的古镜' });
  const volume = (await volumes.list(work.id))[0];
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, title: '海边的相遇' });
  await chapters.saveBody(chapter.id, '第一段\n海水退去时露出青铜镜框\n  ', 0);
  await chapters.finalize(chapter.id);
  screen = await renderApp(d);
  await until(screen, s => s.includes('全部 1'));
  await press(screen, /^星海之境，/);
  await until(screen, s => s.includes('故事档案速览'));
  expect(allText(screen)).toContain('海水退去时露出青铜镜框');
  expect(allText(screen)).toContain('3 个任务已暂停');
  await act(async () => { await chapters.saveBody(chapter.id, '正文改变后\n新的最后一段', 0); });
  await until(screen, s => s.includes('新的最后一段'));
  // Unrelated-work events must not trigger an overview reload.
  const overview = jest.spyOn(works, 'overview');
  await act(async () => { emit('work.updated', { workId: 'another-work' }); });
  await wait(350);
  expect(overview).not.toHaveBeenCalled();
});
