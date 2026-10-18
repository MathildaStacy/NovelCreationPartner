import { act, type ReactTestRenderer } from 'react-test-renderer';
import * as modelServices from '../../src/features/modelServices';
import * as works from '../../src/features/works';
import { testConnection } from '../../src/ai/providers/connectionTest';
import { createProvider } from '../../src/ai/providers/httpProvider';
import { aiFailure } from '../../src/ai/providers/errors';
import type { TestResult } from '../../src/features/modelServices';
import { useOverlay } from '../../src/components/overlay/store';
import { setSecureDriver } from '../../src/secure';
import { allText, flush, press, renderApp, until, wait } from '../helpers/render';
import { blur, draft, fill, held, input, installSecure, result, setupDb, temporaryKey } from '../helpers/modelServices';

jest.mock('../../src/ai/providers/connectionTest', () => ({ testConnection: jest.fn() }));
jest.mock('../../src/ai/providers/httpProvider', () => ({ createProvider: jest.fn() }));

const testMock = jest.mocked(testConnection);
const providerMock = jest.mocked(createProvider);
const listMock = jest.fn<Promise<string[]>, [{ signal: AbortSignal }]>();
let screen: ReactTestRenderer | undefined;
let slots: Map<string, string>;

beforeEach(() => {
  slots = installSecure().slots;
  testMock.mockReset();
  testMock.mockImplementation(async () => result());
  listMock.mockReset();
  listMock.mockResolvedValue(['gpt-6-luna']);
  providerMock.mockReset();
  providerMock.mockImplementation(() => ({ listModels: listMock, generate: jest.fn() }));
});

afterEach(async () => {
  if (screen) {
    await act(async () => screen?.unmount());
    screen = undefined;
  }
  setSecureDriver(undefined);
  jest.restoreAllMocks();
});

async function openSettings() {
  const d = await setupDb();
  return openSettingsOn(d);
}

async function openSettingsOn(d: Awaited<ReturnType<typeof setupDb>>) {
  screen = await renderApp(d);
  await until(screen, s => s.includes('写下第一句灵感'));
  await press(screen, '设置');
  await until(screen, s => s.includes('模型服务') && s.includes('写作偏好'));
  return screen;
}

async function openAdd() {
  const r = await openSettings();
  await press(r, '添加模型服务');
  await until(r, s => s.includes('添加模型服务') && s.includes('实际请求 https://api.openai.com/v1/responses'));
  return r;
}

async function openEdit(name: string) {
  const r = screen!;
  await press(r, new RegExp(`^${name} · `));
  await until(r, s => s.includes('测试连接') && s.includes('删除'));
  await press(r, /^(编辑|填写 Key)$/);
  await wait(400);
  await until(r, s => s.includes('编辑模型服务') && s.includes('删除这个服务'));
  return r;
}

const dialogs = () => useOverlay.getState().dialogs;

test('creates the first service as default after the untested reminder and strips a Bearer prefix', async () => {
  const r = await openAdd();
  const key = temporaryKey();
  await fill(r, 'API Key', `Bearer ${key}`);
  await fill(r, '模型', 'gpt-6-luna');
  await press(r, '保存');
  await until(r, s => s.includes('还没有测试连接'));
  await press(r, '直接保存');
  await until(r, s => s.includes('OpenAI · gpt-6-luna') && s.includes('已保存'));
  const [service] = await modelServices.list();
  expect(service).toMatchObject({ name: 'OpenAI', isDefault: true, hasKey: true, lastTest: null });
  expect([...slots.values()]).toEqual([key]);
  expect(allText(r)).toContain('默认');
  expect(allText(r)).toContain('api.openai.com · 未测试');
});

test('field errors appear under their fields and nothing is saved', async () => {
  const r = await openAdd();
  await fill(r, 'Base URL', 'http://example.com');
  await blur(r, 'Base URL');
  expect(allText(r)).toContain('只支持 https 地址；http 只能用于本机或局域网');
  await fill(r, 'Base URL', 'http://192.168.1.5:8080');
  expect(allText(r)).not.toContain('只支持 https 地址');
  expect(allText(r)).toContain('这是未加密的 http 地址');
  expect(allText(r)).toContain('实际请求 http://192.168.1.5:8080/v1/responses');
  await press(r, '高级设置');
  await fill(r, '最大输出（token）', '0');
  await press(r, '保存');
  const text = await until(r, s => s.includes('请填写 API Key'));
  expect(text).toContain('请填写模型名，或点“从列表选择”');
  expect(text).toContain('请填写 1 到 128000 之间的整数，或留空');
  expect(dialogs()).toHaveLength(0);
  await fill(r, '最大输出（token）', '2000');
  expect(allText(r)).toContain('低于 4000 时');
  await fill(r, '输入预算（token）', '25400');
  await blur(r, '输入预算（token）');
  expect(input(r, '输入预算（token）').props.value).toBe('25000');
  await fill(r, 'API Key', 'sk with space');
  await press(r, '保存');
  await until(r, s => s.includes('Key 中不能有空格或换行，请重新粘贴'));
  expect(await modelServices.list()).toHaveLength(0);
  expect(testMock).not.toHaveBeenCalled();
});

test('switching protocol swaps only official addresses and keeps both protocol-only options', async () => {
  const r = await openAdd();
  await press(r, 'Anthropic Messages');
  expect(input(r, 'Base URL').props.value).toBe('https://api.anthropic.com');
  expect(allText(r)).toContain('实际请求 https://api.anthropic.com/v1/messages');
  await press(r, '高级设置');
  expect(allText(r)).toContain('鉴权头');
  expect(allText(r)).not.toContain('不在服务端保存');
  await fill(r, 'Base URL', 'https://relay.example.com/v1');
  await press(r, 'OpenAI Responses');
  expect(input(r, 'Base URL').props.value).toBe('https://relay.example.com/v1');
  expect(allText(r)).toContain('不在服务端保存');
  expect(input(r, '名称').props.placeholder).toBe('relay.example.com');
});

test('a successful test saves without a reminder and stores its result and capability evidence', async () => {
  const r = await openAdd();
  await fill(r, 'API Key', temporaryKey());
  await fill(r, '模型', 'gpt-6-luna');
  await press(r, '测试连接');
  const text = await until(r, s => s.includes('连接成功'));
  expect(text).toContain('用时 1.2 秒 · 回复模型 gpt-6-luna');
  expect(text).toContain('可用模型 1 个，已观察到流式输出。');
  expect(text).toContain('重新测试');
  // Non-connection edits keep the result.
  await press(r, '高级设置');
  await fill(r, '最大输出（token）', '16000');
  expect(allText(r)).toContain('连接成功');
  await press(r, '保存');
  await until(r, s => s.includes('上次测试正常'));
  expect(dialogs()).toHaveLength(0);
  const [service] = await modelServices.list();
  expect(service.lastTest).toMatchObject({ ok: true });
  expect(service.options).toMatchObject({ maxOutputTokens: 16000, caps: { streaming: true } });
});

test('a connection change aborts the running test and a late result never shows or counts', async () => {
  const r = await openAdd();
  await fill(r, 'API Key', temporaryKey());
  await fill(r, '模型', 'gpt-6-luna');
  const network = held<TestResult>();
  testMock.mockImplementationOnce((_d, _k, o) => network.run(o.signal));
  await press(r, '测试连接');
  await until(r, s => s.includes('正在测试连接') && s.includes('正在请求 api.openai.com'));
  await fill(r, '模型', 'gpt-6-sol');
  expect(network.signal?.aborted).toBe(true);
  expect(allText(r)).not.toContain('正在测试连接');
  await network.finish(result());
  await flush();
  expect(allText(r)).not.toContain('连接成功');
  await press(r, '保存');
  await until(r, s => s.includes('还没有测试连接'));
  await press(r, '先测试');
  await until(r, s => s.includes('连接成功'));
  expect(testMock).toHaveBeenCalledTimes(2);
  expect(testMock.mock.calls[1][0]).toMatchObject({ model: 'gpt-6-sol' });
});

test('closing the page aborts the request and drops its late result silently', async () => {
  const r = await openAdd();
  await fill(r, 'API Key', temporaryKey());
  await fill(r, '模型', 'gpt-6-luna');
  const network = held<TestResult>();
  testMock.mockImplementationOnce((_d, _k, o) => network.run(o.signal));
  await press(r, '测试连接');
  await until(r, s => s.includes('正在测试连接'));
  await press(r, '返回');
  await until(r, s => s.includes('放弃未保存的修改？'));
  await press(r, '放弃修改');
  await until(r, s => s.includes('写作偏好') && !s.includes('添加模型服务'));
  expect(network.signal?.aborted).toBe(true);
  await network.finish(result());
  await wait(50);
  expect(useOverlay.getState().toast).toBeNull();
  expect(dialogs()).toHaveLength(0);
  expect(await modelServices.list()).toHaveLength(0);
});

test('a failed test is classified, and saving anyway records the failure for S15', async () => {
  testMock.mockImplementation(async (d) => result({
    ok: false, capsPatch: {}, streaming: null, error: aiFailure('AI_AUTH', { ...d, serviceName: d.name }, 401).info,
  }));
  const r = await openAdd();
  await fill(r, 'API Key', temporaryKey());
  await fill(r, '模型', 'gpt-6-luna');
  await press(r, '测试连接');
  const text = await until(r, s => s.includes('Key 有问题'));
  expect(text).toContain('API Key 无效或已失效。');
  expect(text).toContain('修改 Key');
  await press(r, '查看详情');
  const detail = await until(r, s => s.includes('错误详情'));
  expect(detail).toContain('状态码：401 · AI_AUTH');
  expect(detail).toContain('请求地址：api.openai.com/v1/responses');
  await press(r, '关闭');
  await press(r, '保存');
  await until(r, s => s.includes('连接测试没有通过'));
  await press(r, '仍然保存');
  await until(r, s => s.includes('Key 无效，点此修改'));
  expect((await modelServices.list())[0].lastTest).toMatchObject({ ok: false });
});

test('editing with an empty Key keeps the saved Key; revealing is not an edit and cannot overwrite typing', async () => {
  const d = await setupDb();
  const key = temporaryKey();
  await modelServices.save(draft(), key);
  await openSettingsOn(d);
  const r = await openEdit('OpenAI');
  expect(input(r, 'API Key').props.placeholder).toBe(`已保存 ••••${key.slice(-4)}，留空则不修改`);
  // Reveal fills the saved Key but leaving is not blocked by D04.
  await press(r, '显示 API Key');
  await until(r, () => input(r, 'API Key').props.value === key);
  await press(r, '返回');
  await until(r, s => s.includes('写作偏好') && !s.includes('编辑模型服务'));
  expect(dialogs()).toHaveLength(0);

  // A slow reveal must not replace what the author typed meanwhile.
  await openEdit('OpenAI');
  let reveal!: (value: string) => void;
  jest.spyOn(modelServices, 'revealKey').mockReturnValueOnce(new Promise(done => { reveal = done; }));
  await press(r, '显示 API Key');
  const typed = temporaryKey();
  await fill(r, 'API Key', typed);
  await act(async () => reveal(key));
  expect(input(r, 'API Key').props.value).toBe(typed);
  await fill(r, 'API Key', '');

  // Empty Key + model change: the saved Key is kept and used by the next test.
  await fill(r, '模型', 'gpt-6-sol');
  await press(r, '保存');
  await until(r, s => s.includes('还没有测试连接'));
  await press(r, '直接保存');
  await until(r, s => s.includes('OpenAI · gpt-6-sol'));
  expect([...slots.values()]).toEqual([key]);
  const saved = await modelServices.get((await modelServices.list())[0].id);
  await modelServices.test(saved, undefined, { signal: new AbortController().signal });
  expect(testMock.mock.calls.at(-1)?.[1]).toBe(key);
});

test('clearing capabilities forgets the earlier test so saving cannot merge its old evidence', async () => {
  const d = await setupDb();
  await modelServices.save(draft({ options: { ...modelServices.DEFAULT_OPTIONS, caps: { jsonSchema: false } } }), temporaryKey());
  await openSettingsOn(d);
  const r = await openEdit('OpenAI');
  await press(r, '测试连接');
  await until(r, s => s.includes('连接成功'));
  await press(r, '高级设置');
  await until(r, s => s.includes('结构化输出') && s.includes('清除能力记录'));
  await press(r, '清除能力记录');
  expect(allText(r)).not.toContain('连接成功');
  expect(allText(r)).toContain('还没有探测过');
  await press(r, '保存');
  await until(r, s => s.includes('上次测试正常') || s.includes('未测试'));
  expect((await modelServices.list())[0].options.caps).toEqual({});
});

test('S02a lists text models, hides non-text ones, caches the list and fills a manual model back', async () => {
  listMock.mockResolvedValue(['gpt-6-luna', 'text-embedding-3-large', 'gpt-6-sol']);
  const r = await openAdd();
  await press(r, '从列表选择');
  expect(allText(r)).toContain('请填写 API Key');
  expect(listMock).not.toHaveBeenCalled();
  await fill(r, 'API Key', temporaryKey());
  await press(r, '从列表选择');
  const text = await until(r, s => s.includes('服务提供的模型 · 2 个'));
  expect(text).toContain('api.openai.com · OpenAI Responses');
  expect(text).toContain('已隐藏 1 个非文本模型 · 显示全部');
  await fill(r, '搜索或输入模型名', 'gpt 6 sol');
  expect(allText(r)).toContain('服务提供的模型 · 1 个');
  await fill(r, '搜索或输入模型名', 'my-relay-alias');
  await until(r, s => s.includes('使用「my-relay-alias」作为模型名'));
  await press(r, '使用「my-relay-alias」作为模型名');
  await until(r, s => !s.includes('选择模型'));
  expect(input(r, '模型').props.value).toBe('my-relay-alias');
  await press(r, '从列表选择');
  await until(r, s => s.includes('服务提供的模型 · 2 个'));
  expect(listMock).toHaveBeenCalledTimes(1);
  await press(r, '取消');
  await fill(r, 'Base URL', 'https://relay.example.com/v1');
  await press(r, '从列表选择');
  await until(r, s => s.includes('relay.example.com · OpenAI Responses') && s.includes('服务提供的模型'));
  expect(listMock).toHaveBeenCalledTimes(2);
});

test('S02a without a models endpoint explains it and still accepts a typed model', async () => {
  listMock.mockImplementation(async () => { throw aiFailure('AI_NOT_FOUND', { ...draft(), serviceName: 'x' }, 404); });
  const r = await openAdd();
  await fill(r, 'API Key', temporaryKey());
  await press(r, '从列表选择');
  await until(r, s => s.includes('这个服务没有提供模型列表'));
  expect(allText(r)).not.toContain('查看详情');
  await fill(r, '搜索或输入模型名', 'claude-relay');
  await press(r, '使用「claude-relay」作为模型名');
  await until(r, () => input(r, '模型').props.value === 'claude-relay');
});

test('a missing service on edit shows a toast and goes back; deleting from S02 uses D02', async () => {
  const d = await setupDb();
  const first = (await modelServices.save(draft(), temporaryKey())).service;
  await modelServices.save(draft({ name: 'Relay', baseUrl: 'https://relay.example.com/v1' }), temporaryKey());
  await openSettingsOn(d);
  const r = await openEdit('OpenAI');
  await press(r, '删除这个服务');
  const text = await until(r, s => s.includes('删除模型服务「OpenAI」？'));
  expect(text).toContain('删除后，「Relay」将成为默认服务。');
  await press(r, '删除服务');
  await until(r, s => s.includes('已删除') && s.includes('写作偏好'));
  const left = await modelServices.list();
  expect(left).toHaveLength(1);
  expect(left[0]).toMatchObject({ name: 'Relay', isDefault: true });
  expect(left.find(s => s.id === first.id)).toBeUndefined();
  expect(await works.list()).toHaveLength(0);
});
