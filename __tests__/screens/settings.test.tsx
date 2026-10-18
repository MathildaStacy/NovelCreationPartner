import { act, type ReactTestRenderer } from 'react-test-renderer';
import * as modelServices from '../../src/features/modelServices';
import { testConnection } from '../../src/ai/providers/connectionTest';
import { createProvider } from '../../src/ai/providers/httpProvider';
import { aiFailure } from '../../src/ai/providers/errors';
import type { TestResult } from '../../src/features/modelServices';
import { useOverlay } from '../../src/components/overlay/store';
import { setSecureDriver } from '../../src/secure';
import { allText, press, renderApp, until, wait } from '../helpers/render';
import { tickingClock } from '../helpers/db';
import { draft, fill, held, installSecure, result, setupDb, temporaryKey } from '../helpers/modelServices';

jest.mock('../../src/ai/providers/connectionTest', () => ({ testConnection: jest.fn() }));
jest.mock('../../src/ai/providers/httpProvider', () => ({ createProvider: jest.fn() }));

const testMock = jest.mocked(testConnection);
let screen: ReactTestRenderer | undefined;

let secure: ReturnType<typeof installSecure>;

beforeEach(() => {
  tickingClock();
  secure = installSecure();
  testMock.mockReset();
  testMock.mockImplementation(async () => result());
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

async function settings(d: Awaited<ReturnType<typeof setupDb>>) {
  screen = await renderApp(d);
  await until(screen, s => s.includes('写下第一句灵感'));
  await press(screen, '设置');
  await until(screen, s => s.includes('写作偏好'));
  return screen;
}

async function menu(r: ReactTestRenderer, name: string, which: 'onPress' | 'onLongPress' = 'onPress') {
  await press(r, new RegExp(`^${name} · `), which);
  await until(r, s => s.includes('编辑') || s.includes('填写 Key'));
}

async function choose(r: ReactTestRenderer, label: string) {
  await press(r, label);
  await wait(400); // sheet close animation, then the action
}

test('S15 shows the empty state, other entries announce later phases', async () => {
  const d = await setupDb();
  const r = await settings(d);
  expect(allText(r)).toContain('尚未连接模型服务');
  await press(r, '回收站');
  expect(useOverlay.getState().toast?.message).toBe('这个功能还在开发中，后续版本开放');
  await press(r, '返回书架');
  await until(r, s => s.includes('写下第一句灵感') && !s.includes('写作偏好'));
});

test('S15 lists the default first and marks missing Keys, failed Keys and pending Key cleanup', async () => {
  const d = await setupDb();
  const first = (await modelServices.save(draft({ name: 'First' }), temporaryKey())).service;
  const second = (await modelServices.save(draft({ name: 'Second', model: 'gpt-6-sol' }), temporaryKey())).service;
  const restored = (await modelServices.save(draft({ name: 'Restored', baseUrl: 'https://relay.example.com/v1' }), temporaryKey())).service;
  await modelServices.setDefault(second.id);
  await d.run('UPDATE model_services SET has_key = 0, key_ref = NULL WHERE id = ?', [restored.id]);
  await d.run('UPDATE model_services SET last_test_at = ?, last_test_ok = 0, last_test_message = ? WHERE id = ?',
    ['2026-10-18T01:00:00.000Z', 'API Key 无效或已失效。', first.id]);
  await d.run('INSERT INTO credential_cleanup (key_ref) VALUES (?)', ['orphan-slot']);
  // The device stays locked, so startup cleanup cannot remove the orphaned slot.
  secure.driver.removeKey.mockRejectedValue(new Error('device locked'));
  const r = await settings(d);
  const text = await until(r, s => s.includes('Restored'));
  expect(text.indexOf('Second · gpt-6-sol')).toBeLessThan(text.indexOf('First · gpt-6-luna'));
  expect(text).toMatch(/Second · gpt-6-sol\n默认/);
  expect(text).toContain('api.openai.com · Key 无效，点此修改');
  expect(text).toContain('relay.example.com · 需要填写 Key');
  expect(text).toContain('本机 Key 待清理，解锁后返回应用会继续');
  await menu(r, 'Restored', 'onLongPress');
  expect(allText(r)).toContain('填写 Key');
  expect(allText(r)).not.toContain('测试连接');
  await choose(r, '填写 Key');
  await until(r, s => s.includes('这个服务缺少 API Key，需要重新填写。'));
  await fill(r, '模型', 'gpt-6-luna');
  await press(r, '保存');
  await until(r, s => s.includes('请填写 API Key'));
});

test('S15a sets the default and deletes the default with its successor named in D02', async () => {
  const d = await setupDb();
  await modelServices.save(draft({ name: 'First' }), temporaryKey());
  await modelServices.save(draft({ name: 'Second' }), temporaryKey());
  await modelServices.save(draft({ name: 'Third' }), temporaryKey());
  const r = await settings(d);
  await until(r, s => s.includes('Third'));
  await menu(r, 'First');
  expect(allText(r)).not.toContain('设为默认');
  await press(r, '关闭');
  await wait(400);
  await menu(r, 'Third');
  await choose(r, '设为默认');
  await until(r, s => s.includes('已将「Third」设为默认模型服务'));
  await until(r, s => s.indexOf('Third · ') < s.indexOf('First · '));
  await menu(r, 'Third');
  await choose(r, '删除');
  const text = await until(r, s => s.includes('删除模型服务「Third」？'));
  expect(text).toContain('服务配置和保存在这台手机上的 API Key 会一起删除');
  expect(text).toContain('删除后，「First」将成为默认服务。');
  await press(r, '删除服务');
  await until(r, s => s.includes('已删除') && !s.includes('Third · '));
  expect((await modelServices.getDefault())?.name).toBe('First');
});

test('deleting the last service warns that AI becomes unavailable and reports pending Key cleanup', async () => {
  const d = await setupDb();
  const { driver } = secure;
  await modelServices.save(draft({ name: 'Only' }), temporaryKey());
  const r = await settings(d);
  await until(r, s => s.includes('Only · '));
  driver.removeKey.mockRejectedValueOnce(new Error('device locked'));
  await menu(r, 'Only');
  await choose(r, '删除');
  await until(r, s => s.includes('删除后，AI 功能将不可用，直到你再连接一个模型服务。'));
  await press(r, '删除服务');
  const text = await until(r, s => s.includes('尚未连接模型服务'));
  expect(text).toContain('服务已删除，设备解锁后继续清理本机 Key');
  expect(text).toContain('本机 Key 待清理，解锁后返回应用会继续');
});

test('S15a tests in the list, shows a toast, and stays silent after leaving the page', async () => {
  const d = await setupDb();
  await modelServices.save(draft({ name: 'Main' }), temporaryKey());
  const r = await settings(d);
  await until(r, s => s.includes('Main · '));
  const first = held<TestResult>();
  testMock.mockImplementationOnce((_d, _k, o) => first.run(o.signal));
  await menu(r, 'Main');
  await choose(r, '测试连接');
  await until(r, s => s.includes('api.openai.com · 测试中…'));
  await menu(r, 'Main');
  expect(r.root.findAll(n => n.props.accessibilityLabel === '测试中…' && n.props.accessibilityState?.disabled).length).toBeGreaterThan(0);
  await press(r, '关闭');
  await wait(400);
  await first.finish(result({ latencyMs: 1200 }));
  await until(r, s => s.includes('「Main」连接正常，用时 1.2 秒') && s.includes('上次测试正常'));

  // A failure toast offers D05.
  testMock.mockImplementationOnce(async (dr) => result({ ok: false, capsPatch: {}, error: aiFailure('AI_TIMEOUT', { ...dr, serviceName: dr.name }).info }));
  await menu(r, 'Main');
  await choose(r, '测试连接');
  await until(r, s => s.includes('「Main」连不上服务') && s.includes('上次测试未通过'));
  await press(r, '查看详情');
  await until(r, s => s.includes('错误详情') && s.includes('api.openai.com 没有响应'));
  await press(r, '关闭');

  // Leaving S15 keeps the request but suppresses the toast.
  const late = held<TestResult>();
  testMock.mockImplementationOnce((_d, _k, o) => late.run(o.signal));
  await menu(r, 'Main');
  await choose(r, '测试连接');
  await until(r, s => s.includes('测试中…'));
  await press(r, '返回书架');
  await until(r, s => s.includes('写下第一句灵感') && !s.includes('写作偏好'));
  act(() => useOverlay.setState({ toast: null }));
  expect(late.signal?.aborted).toBe(false);
  await late.finish(result({ at: '2026-10-18T03:00:00.000Z' }));
  await wait(50);
  expect(useOverlay.getState().toast).toBeNull();
  expect((await modelServices.list())[0].lastTest).toMatchObject({ ok: true, at: '2026-10-18T03:00:00.000Z' });
});
