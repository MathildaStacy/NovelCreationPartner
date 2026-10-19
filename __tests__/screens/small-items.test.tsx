/** Group 6 small items that ride along with the S15 slice (2026-10-19 gap audit). */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AccessibilityInfo, Text } from 'react-native';
import { freshDb, tickingClock } from '../helpers/db';
import { allText, press, until, wait } from '../helpers/render';
import { db, setDb } from '../../src/data/db';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import type { RootStackParamList } from '../../src/app/navigation/types';
import { ensureModelService } from '../../src/app/dialogs';
import { EditorScreen } from '../../src/screens/editor/EditorScreen';
import { SearchScreen } from '../../src/screens/shelf/SearchScreen';
import { ShelfScreen } from '../../src/screens/shelf/ShelfScreen';
import { ChapterFormSheet } from '../../src/screens/work/ChapterFormSheet';
import { removeChapter } from '../../src/screens/work/ChapterActionsSheet';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import { color } from '../../src/theme/tokens';

beforeEach(async () => { tickingClock(); await freshDb(); useOverlay.setState({ dialogs: [], toast: null, depth: 0 }); });
afterEach(async () => { jest.restoreAllMocks(); await db().close(); setDb(null); });

const Stack = createNativeStackNavigator<RootStackParamList>();
async function mount(content: React.ReactNode, ref?: ReturnType<typeof createNavigationContainerRef<RootStackParamList>>, initialState?: object) {
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer ref={ref} initialState={initialState as never}>{content}<OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  return screen;
}
async function story(title = '开端', kind: 'main' | 'draft' = 'main', body = '风从海上来。') {
  const work = await works.create({ title: '归潮', premise: '海边的故事' });
  const volume = (await chapters.list(work.id))[0].volume;
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, title, kind });
  if (body) { await chapters.saveBody(chapter.id, body, 0); }
  return { work, volume, chapter };
}
async function editor(kind: 'main' | 'draft' = 'main', body = '风从海上来。') {
  const s = await story('海边', kind, body);
  const navigation = createNavigationContainerRef<RootStackParamList>();
  const screen = await mount(<Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Shelf">{() => <Text>书架</Text>}</Stack.Screen>
    <Stack.Screen name="Editor" component={EditorScreen} />
    <Stack.Screen name="Export">{({ route }) => <Text>{`导出页 ${JSON.stringify(route.params)}`}</Text>}</Stack.Screen>
  </Stack.Navigator>, navigation, { index: 1, routes: [{ name: 'Shelf' }, { name: 'Editor', params: { workId: s.work.id, chapterId: s.chapter.id } }] });
  await until(screen, text => text.includes('海边'));
  return { ...s, screen, navigation };
}

test('S07a 导出本章 saves first and opens S15b on this chapter', async () => {
  const { screen, chapter, work } = await editor();
  await press(screen, '更多'); await until(screen, text => text.includes('导出本章'));
  await press(screen, '导出本章');
  await until(screen, text => text.includes('导出页'));
  expect(allText(screen)).toContain(JSON.stringify({ mode: 'text', workId: work.id, chapterId: chapter.id, from: 'editor' }));
  await act(async () => screen.unmount());
});

test('S07a hides 导出本章 for drafts and explains greyed items on an empty chapter', async () => {
  const draft = await editor('draft');
  await press(draft.screen, '更多'); await until(draft.screen, text => text.includes('存为版本'));
  expect(allText(draft.screen)).not.toContain('导出本章');
  await act(async () => draft.screen.unmount());
  await db().close(); setDb(null); await freshDb();
  const empty = await editor('main', '');
  await press(empty.screen, '更多'); await until(empty.screen, text => text.includes('导出本章'));
  await press(empty.screen, '导出本章');
  expect(useOverlay.getState().toast?.message).toBe('正文为空，没有可导出的内容');
  await press(empty.screen, '存为版本');
  expect(useOverlay.getState().toast?.message).toBe('正文为空，没有可保存的版本');
  await act(async () => empty.screen.unmount());
});

test('S03b highlights hits on a yellow mark and announces the result count', async () => {
  await works.create({ title: '星图残页', premise: '一面古镜' });
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  const screen = await mount(<Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Search" component={SearchScreen} /></Stack.Navigator>);
  const input = screen.root.findAll(node => node.props.placeholder === '搜索书名、简介或题材' && typeof node.props.onChangeText === 'function')[0];
  await act(async () => input.props.onChangeText('星图'));
  await wait(350);
  await until(screen, text => text.includes('找到 1 部作品'));
  const hit = screen.root.findAll(node => node.props.children === '星图' && typeof node.type !== 'string')[0];
  expect(JSON.stringify(hit.props.style)).toContain(color.mark);
  expect(announce).toHaveBeenLastCalledWith('找到 1 部作品');
  await act(async () => input.props.onChangeText('没有这个'));
  await wait(350);
  await until(screen, text => text.includes('没有找到与「没有这个」相关的作品'));
  expect(announce).toHaveBeenLastCalledWith('没有找到相关作品');
  await act(async () => screen.unmount());
});

test('D02 names a chapter by its title only', async () => {
  const { chapter } = await story('海边的相遇');
  const listed = (await chapters.list(chapter.workId))[0].chapters[0];
  const screen = await mount(<Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Shelf">{() => <Text>页</Text>}</Stack.Screen></Stack.Navigator>);
  let done!: Promise<boolean>;
  await act(async () => { done = removeChapter(listed); });
  await until(screen, text => text.includes('删除「海边的相遇」？'));
  expect(allText(screen)).not.toContain('第 1 章 海边的相遇」');
  await press(screen, '取消'); expect(await done).toBe(false);
  await act(async () => screen.unmount());
});

test('S06a uses the service numbering at submit for an untouched 第 N 章', async () => {
  const { work } = await story();
  let created: { title: string } | null = null;
  const screen = await mount(<Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Shelf">{() =>
    <ChapterFormSheet visible workId={work.id} mode="create" onRequestClose={() => {}} onCreated={chapter => { created = chapter; }} />}</Stack.Screen></Stack.Navigator>);
  await until(screen, text => text.includes('正文（第 2 章）'));
  // Another chapter lands meanwhile (e.g. restored from the trash elsewhere).
  const volume = (await chapters.list(work.id))[0].volume;
  await act(async () => { await chapters.create({ workId: work.id, volumeId: volume.id, title: '插入' }); });
  await press(screen, '创建并开始写');
  for (let i = 0; i < 20 && !created; i++) { await wait(25); }
  expect(created!.title).toBe('第 3 章');
  await act(async () => screen.unmount());
});

test('D03 is presented as a bottom sheet', async () => {
  const pending = ensureModelService();
  await act(async () => {});
  const dialog = useOverlay.getState().dialogs[0];
  expect(dialog.sheet).toBe(true);
  dialog.resolve('skip'); useOverlay.setState({ dialogs: [] });
  expect(await pending).toBe('skip');
});

test('S03 shows six grey covers only when the shelf read takes over 300 ms', async () => {
  jest.spyOn(works, 'list').mockReturnValue(new Promise(() => {}));
  const screen = await mount(<Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Shelf" component={ShelfScreen} /></Stack.Navigator>);
  expect(screen.root.findAll(node => node.props.testID === 'shelf-skeleton')).toHaveLength(0);
  await wait(350);
  const skeleton = screen.root.findAll(node => node.props.testID === 'shelf-skeleton' && typeof node.type === 'string')[0];
  expect(skeleton.children).toHaveLength(6);
  await act(async () => screen.unmount());
});
