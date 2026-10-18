import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import type { RootStackParamList } from '../../src/app/navigation/types';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import { ConflictsScreen } from '../../src/screens/review/ConflictsScreen';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as conflicts from '../../src/features/conflicts';
import * as services from '../../src/features/modelServices';
import * as prefs from '../../src/features/prefs';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { freshDb } from '../helpers/db';
import { allText, press, until } from '../helpers/render';

jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'fixture-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));
afterEach(() => jest.restoreAllMocks());

async function fixture() {
  const db = await freshDb();
  const work = await works.create({ title: '归潮', premise: '海边的古镜' });
  const volume = (await chapters.list(work.id))[0].volume;
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, title: '觉醒' });
  await chapters.saveBody(chapter.id, '林宇的双眼亮起蓝色的光。', 0);
  await chapters.finalize(chapter.id);
  const modified = await chapters.create({ workId: work.id, volumeId: volume.id, title: '潮声' });
  await chapters.saveBody(modified.id, '潮声传来。', 0);
  await chapters.finalize(modified.id);
  await chapters.saveBody(modified.id, '潮声再次传来。', 0);
  await services.save({ name: '本次审阅服务', protocol: 'openai_responses', baseUrl: 'https://review.example.test/v1', model: 'review-fixture', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'fixture-key');
  useOverlay.setState({ dialogs: [], toast: null, depth: 0 });
  const Stack = createNativeStackNavigator<RootStackParamList>();
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer>
    <Stack.Navigator initialRouteName="Conflicts" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Conflicts" component={ConflictsScreen} initialParams={{ workId: work.id, chapterId: chapter.id }} />
      <Stack.Screen name="Jobs">{() => <Text>后台任务页</Text>}</Stack.Screen>
      <Stack.Screen name="Editor">{() => <Text>章节编辑器</Text>}</Stack.Screen>
      <Stack.Screen name="ModelService">{() => <Text>配置模型服务页</Text>}</Stack.Screen>
    </Stack.Navigator><OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  await until(screen, text => text.includes('没有这类冲突记录。'));
  return { db, work, chapter, screen };
}

test('recheck preview is local, excludes modified chapters and cancels before D01 without enqueueing', async () => {
  const { db, screen } = await fixture();
  const initial = await db.all('SELECT * FROM jobs');
  await press(screen, '重新检查');
  await until(screen, text => text.includes('选择要重新检查的章节'));
  expect(allText(screen)).toContain('第 1 章 觉醒 ✓');
  expect(allText(screen)).toContain('第 2 章 潮声（正文已修改）');
  await press(screen, '预览整个检查');
  await until(screen, text => text.includes('整个检查计划 1 次请求'));
  expect(allText(screen)).toContain('含重试与格式修复最多 3 次');
  expect(allText(screen)).toContain('review.example.test');
  expect(allText(screen)).toContain('费用未知');
  await press(screen, '查看发送内容');
  await until(screen, text => text.includes('本次实际发送内容'));
  expect(allText(screen)).toContain('林宇的双眼亮起蓝色的光。');
  expect(allText(screen)).toContain('review-fixture');
  await press(screen, '返回检查确认');
  await press(screen, '确认并加入检查');
  await until(screen, text => text.includes('发送前请确认'));
  await press(screen, '取消');
  expect(await db.all('SELECT * FROM jobs')).toHaveLength(initial.length);
  expect(await db.all('SELECT * FROM ai_attempts')).toHaveLength(0);
  expect(await prefs.get('aiNoticeAcknowledged')).toEqual({});
  await act(async () => screen.unmount()); db.close();
});

test('author confirmation queues only detection using the exact preview after D01', async () => {
  const { db, chapter, screen } = await fixture();
  const prepared = jest.spyOn(conflicts, 'prepareRecheck');
  const recheck = jest.spyOn(conflicts, 'recheck');
  const initialJobs = (await db.all('SELECT * FROM jobs')).length;
  const versions = (await db.all('SELECT * FROM chapter_versions')).length;
  await press(screen, '重新检查');
  await press(screen, '预览整个检查');
  await until(screen, text => text.includes('整个检查计划 1 次请求'));
  await press(screen, '查看发送内容');
  await press(screen, '返回检查确认');
  await press(screen, '确认并加入检查');
  await until(screen, text => text.includes('发送前请确认'));
  expect(recheck).not.toHaveBeenCalled();
  await press(screen, '知道了，继续');
  await until(screen, text => text.includes('检查已加入后台任务'));
  expect(prepared).toHaveBeenCalledTimes(1);
  expect(recheck).toHaveBeenCalledTimes(1);
  expect(recheck.mock.calls[0][0]).toBe(chapter.id);
  expect(recheck.mock.calls[0][1]).toBe(await prepared.mock.results[0].value);
  expect((await db.all('SELECT * FROM jobs')).length).toBe(initialJobs + 1);
  const queued = await db.all<{ kind: string }>("SELECT kind FROM jobs WHERE chapter_id=? AND status='queued'", [chapter.id]);
  expect(queued).toEqual([{ kind: 'detect_conflicts' }]);
  expect(await db.all('SELECT * FROM chapter_versions')).toHaveLength(versions);
  expect(await db.all('SELECT * FROM ai_attempts')).toHaveLength(0);
  expect((await prefs.get('aiNoticeAcknowledged'))['review.example.test']).toEqual(expect.any(String));
  await act(async () => screen.unmount()); db.close();
});

test('body change after preview rejects the approved plan and never queues a stale check', async () => {
  const { db, chapter, screen } = await fixture();
  await prefs.set('aiNoticeAcknowledged', { 'review.example.test': new Date().toISOString() });
  const initialJobs = (await db.all('SELECT * FROM jobs')).length;
  await press(screen, '重新检查');
  await press(screen, '预览整个检查');
  await until(screen, text => text.includes('整个检查计划 1 次请求'));
  await act(async () => { await chapters.saveBody(chapter.id, '作者已经改写本章。', 0); });
  await press(screen, '确认并加入检查');
  await until(screen, text => text.includes('仅可重新检查当前定稿'));
  expect(await db.all('SELECT * FROM jobs')).toHaveLength(initialJobs);
  expect(await db.all('SELECT * FROM ai_attempts')).toHaveLength(0);
  await act(async () => screen.unmount()); db.close();
});
