import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../../src/app/navigation/types';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import { setDb, db } from '../../src/data/db';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as models from '../../src/features/modelServices';
import * as jobs from '../../src/features/jobs';
import { JobsScreen } from '../../src/screens/work/JobsScreen';
import { finalizeWithConfirm } from '../../src/screens/editor/finalize';
import { freshDb, tickingClock } from '../helpers/db';
import { allText, press, until } from '../helpers/render';

jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'fixture-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));
let screen: ReactTestRenderer.ReactTestRenderer | undefined;
beforeEach(async () => { tickingClock(); await freshDb(); useOverlay.setState({ dialogs: [], toast: null, depth: 0 }); });
afterEach(async () => {
  if (screen) { await act(async () => screen?.unmount()); screen = undefined; }
  jest.restoreAllMocks(); await db().close(); setDb(null);
});
async function fixture() {
  const work = await works.create({ title: '远海', premise: '寻找灯塔' });
  const volume = (await chapters.list(work.id))[0].volume;
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, title: '启航' });
  await chapters.saveBody(chapter.id, ['海'.repeat(8900), '风'.repeat(8900), '光'.repeat(8900)].join('\n'), 0);
  await models.save({ name: '本次服务', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'fixture', options: DEFAULT_OPTIONS }, 'fixture-key');
  const Stack = createNativeStackNavigator<RootStackParamList>();
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer>
    <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Jobs" component={JobsScreen} initialParams={{ workId: work.id }} /></Stack.Navigator>
    <OverlayHost level={0} />
  </NavigationContainer></SafeAreaProvider>); });
  return { work, chapter: await chapters.get(chapter.id) };
}

test('large finalization shows its first batch and saving alone authorizes no requests', async () => {
  const { work, chapter } = await fixture();
  let confirmed!: Promise<boolean>;
  await act(async () => { confirmed = finalizeWithConfirm({ ...chapter, number: 1 }); });
  await until(screen!, text => text.includes('保存并执行第 1–6 块'));
  expect(allText(screen!)).toContain('其余请求块保持暂停');
  expect(allText(screen!)).toContain('含重试最多 11 次');
  await press(screen!, '仅保存定稿');
  expect(await confirmed).toBe(true);
  expect((await jobs.list(work.id)).every(job => job.status === 'paused' && job.pauseReason === 'batch')).toBe(true);
  expect(await db().all('SELECT id FROM ai_attempts')).toEqual([]);
});

test('next-batch preview and cancel never authorize; confirm submits the exact displayed preview once', async () => {
  const { chapter } = await fixture();
  await act(async () => { await chapters.finalize(chapter.id, { authorizeFirstBatch: false }); });
  await until(screen!, text => text.includes('预览并授权下一批'));
  const preview = jest.spyOn(jobs, 'previewNextBatch');
  const authorize = jest.spyOn(jobs, 'authorizeBatch');
  await press(screen!, '预览并授权下一批');
  await until(screen!, text => text.includes('执行第 1–6 个请求块？'));
  await press(screen!, '查看发送内容');
  await until(screen!, text => text.includes('本批实际发送内容'));
  expect(allText(screen!)).toContain('本次服务');
  expect(authorize).not.toHaveBeenCalled();
  await press(screen!, '返回本批确认');
  await press(screen!, '取消');
  expect(authorize).not.toHaveBeenCalled();
  await press(screen!, '预览并授权下一批');
  await until(screen!, text => text.includes('执行第 1–6 个请求块？'));
  await press(screen!, '确认执行本批');
  await until(screen!, text => text.includes('本批已授权'));
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(authorize.mock.calls[0][0]).toBe(await preview.mock.results[1].value);
  expect(await db().all('SELECT id FROM ai_attempts')).toEqual([]);
});
