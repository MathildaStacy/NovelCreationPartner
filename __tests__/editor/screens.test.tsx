import React from 'react';
import ReactTestRenderer, {
  act,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
} from 'react-native';
import { EditorScreen } from '../../src/screens/editor/EditorScreen';
import { VersionsScreen } from '../../src/screens/editor/VersionsScreen';
import { VersionDiffScreen } from '../../src/screens/editor/VersionDiffScreen';
import type { RootStackParamList } from '../../src/app/navigation/types';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import * as chapters from '../../src/features/chapters';
import * as works from '../../src/features/works';
import * as volumes from '../../src/features/volumes';
import * as versions from '../../src/features/versions';
import { AppError } from '../../src/features/errors';
import { freshDb, tickingClock } from '../helpers/db';
import { allText, flush, press, until, wait } from '../helpers/render';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Shelf = () => <Text>已返回来源页</Text>;
async function editor(bottom = 0) {
  const w = await works.create({ premise: '少年找到一面古镜' });
  const [v] = await volumes.list(w.id);
  const chapter = await chapters.create({
    workId: w.id,
    volumeId: v.id,
    title: '海边',
  });
  await chapters.saveBody(chapter.id, '风从海上来。', 3);
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 400, height: 800 },
          insets: { top: 24, right: 0, bottom, left: 0 },
        }}
      >
        <NavigationContainer
          initialState={{
            index: 1,
            routes: [
              { name: 'Shelf' },
              {
                name: 'Editor',
                params: { workId: w.id, chapterId: chapter.id },
              },
            ],
          }}
        >
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Shelf" component={Shelf} />
            <Stack.Screen name="Editor" component={EditorScreen} />
            <Stack.Screen name="Versions" component={VersionsScreen} />
            <Stack.Screen name="VersionDiff" component={VersionDiffScreen} />
          </Stack.Navigator>
          <OverlayHost level={0} />
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  await until(r, s => s.includes('海边') && s.includes('已保存'));
  return { r, chapter };
}
const input = (r: Renderer) =>
  r.root.findAll(
    n =>
      n.props.testID === 'editor-body' &&
      typeof n.props.onChangeText === 'function',
  )[0];
const type = async (r: Renderer, display: string) => {
  await act(async () => {
    input(r).props.onChangeText(display);
  });
  await flush();
};

beforeEach(async () => {
  tickingClock();
  await freshDb();
  useOverlay.setState({ toast: null, dialogs: [], depth: 0 });
});
afterEach(() => jest.restoreAllMocks());

it('flushes the latest body and cursor before leaving, then creates an automatic version', async () => {
  const { r, chapter } = await editor();
  await type(r, '　　海潮涨起。\n　　远处有船。');
  await press(r, '返回');
  await until(r, s => s.includes('已返回来源页'));
  expect((await chapters.get(chapter.id)).body).toBe('海潮涨起。\n远处有船。');
  const saved = await versions.list(chapter.id);
  expect(saved[0].reason).toBe('auto');
  expect((await versions.get(saved[0].id)).body).toBe('海潮涨起。\n远处有船。');
  await act(async () => r.unmount());
});

it('preserves unsaved text when writes fail and blocks dependent navigation until explicit discard', async () => {
  const { r, chapter } = await editor();
  const old = (await chapters.get(chapter.id)).body;
  const save = jest
    .spyOn(chapters, 'saveBody')
    .mockRejectedValue(new AppError('DB_ERROR', 'locked'));
  await type(r, '　　没有落盘的段落');
  await press(r, '返回');
  await until(
    r,
    s =>
      s.includes('写入没有完成') ||
      s.includes('手机存储') ||
      s.includes('保存没有成功') ||
      useOverlay.getState().dialogs.length > 0,
  );
  const first = useOverlay.getState().dialogs[0];
  // The shared DB error dialog appears first, then the editor's leave guard.
  if (first.title !== '修改还没有保存') {
    await press(r, '知道了');
  }
  await until(r, s => s.includes('修改还没有保存'));
  expect(input(r).props.value).toBe('　　没有落盘的段落');
  await press(r, '留在本页');
  expect((await chapters.get(chapter.id)).body).toBe(old);
  expect(await versions.list(chapter.id)).toEqual([]);
  expect(save).toHaveBeenCalledTimes(1);
  await press(r, '返回');
  await until(r, s => s.includes('修改还没有保存'));
  await press(r, '放弃修改并离开');
  await until(r, s => s.includes('已返回来源页'));
  expect((await chapters.get(chapter.id)).body).toBe(old);
  expect(await versions.list(chapter.id)).toEqual([]);
  await act(async () => r.unmount());
});

it('opens history with flushed text, restores a version and clears undo history', async () => {
  const { r, chapter } = await editor();
  const previous = await versions.snapshot(chapter.id, 'manual');
  await type(r, '　　修改后的风与海。');
  await press(r, '更多');
  await until(r, s => s.includes('章节信息'));
  await press(r, '版本历史');
  await until(r, s => s.includes('比现在少'));
  expect((await chapters.get(chapter.id)).body).toBe('修改后的风与海。');
  // The fixture date stays fixed; selecting a version must work after that day.
  await press(r, /\d{2}:\d{2} 6 字$/);
  await until(r, s => s.includes('恢复后会消失') && s.includes('恢复这个版本'));
  await press(r, '恢复这个版本');
  await until(r, s => s.includes('正文会换成'));
  await press(r, '恢复这个版本');
  await until(r, s => s.includes('已恢复，原内容已存为版本'));
  expect(input(r).props.value).toBe('　　风从海上来。');
  expect((await chapters.get(chapter.id)).body).toBe(
    (await versions.get(previous.id)).body,
  );
  const undo = r.root.findAll(
    n => n.props.label === '撤销' && n.props.disabled === true,
  );
  expect(undo.length).toBeGreaterThan(0);
  expect(
    (await versions.list(chapter.id)).some(v => v.reason === 'before_restore'),
  ).toBe(true);
  await wait(25);
  expect(allText(r)).not.toContain('版本对比');
  await act(async () => r.unmount());
});

it('finalizes after flushing, keeps the permanent version and pauses AI without a model', async () => {
  const { r, chapter } = await editor();
  await type(r, '　　这一章写完了。');
  await press(r, '定稿本章');
  await until(r, s => s.includes('这些变化由你逐条审核后才会写入档案'));
  await press(r, '定稿本章');
  await until(r, s => s.includes('已定稿，AI 整理已暂停'));
  const finalized = await chapters.get(chapter.id);
  expect(finalized.body).toBe('这一章写完了。');
  expect(finalized.state).toBe('finalized');
  expect(
    (await versions.get(finalized.finalizedVersionId!)).version.reason,
  ).toBe('finalize');
  await act(async () => {
    await chapters.unfinalize(chapter.id);
  });
  await until(r, s => s.includes('定稿本章') && s.includes('草稿'));
  const enabled = r.root.findAll(
    n => n.props.label === '定稿本章' && n.props.disabled === false,
  );
  expect(enabled.length).toBeGreaterThan(0);
  await act(async () => r.unmount());
});

it('keeps the cursor at the join when backspace removes a paragraph indent', async () => {
  const { r } = await editor();
  await type(r, '　　风\n　　海');
  await act(async () => {
    input(r).props.onSelectionChange({
      nativeEvent: { selection: { start: 6, end: 6 } },
    });
  });
  await type(r, '　　风\n　海');
  await act(async () => {
    input(r).props.onSelectionChange({
      nativeEvent: { selection: { start: 5, end: 5 } },
    });
  });
  expect(input(r).props.value).toBe('　　风海');
  expect(input(r).props.selection).toEqual({ start: 3, end: 3 });
  await press(r, '撤销');
  expect(input(r).props.value).toBe('　　风\n　　海');
  expect(input(r).props.selection).toEqual({ start: 6, end: 6 });
  await act(async () => r.unmount());
});

it('shows deleted content when the historical paragraph is an empty line', async () => {
  const { r, chapter } = await editor();
  await act(async () => {
    await chapters.saveBody(chapter.id, '首段\n\n末段', 0);
    await versions.snapshot(chapter.id, 'manual');
  });
  await type(r, '　　首段\n　　重要内容\n　　末段');
  await press(r, '更多');
  await until(r, s => s.includes('章节信息'));
  await press(r, '版本历史');
  await until(r, s => s.includes('比现在少'));
  await press(r, /\d{2}:\d{2} 4 字$/);
  await until(r, s => s.includes('与现在相比：有改动 1 段'));
  expect(allText(r)).toContain('重要内容');
  await act(async () => r.unmount());
});

it('renders an empty-body hint above the display indent without altering stored offsets', async () => {
  const { r, chapter } = await editor();
  await type(r, '　　');
  expect(input(r).props.value).toBe('　　');
  expect(input(r).props.selection).toEqual({ start: 2, end: 2 });
  expect(
    r.root.findAll(n => n.props.testID === 'editor-placeholder').length,
  ).toBeGreaterThan(0);
  await press(r, '返回');
  await until(r, s => s.includes('已返回来源页'));
  expect((await chapters.get(chapter.id)).body).toBe('');
  expect((await chapters.get(chapter.id)).lastCursor).toBe(0);
  await act(async () => r.unmount());
});

it('protects the system gesture area outside the KAV padding and removes the gap above an open keyboard', async () => {
  const listeners: Record<string, () => void> = {};
  const addListener = Keyboard.addListener.bind(Keyboard);
  jest
    .spyOn(Keyboard, 'addListener')
    .mockImplementation((event, listener, context) => {
      listeners[event] = () =>
        listener({
          endCoordinates: { screenX: 0, screenY: 500, width: 400, height: 300 },
          startCoordinates: { screenX: 0, screenY: 800, width: 400, height: 0 },
          duration: 0,
          easing: 'keyboard',
          isEventFromThisApp: true,
        });
      return addListener(event, listener, context);
    });
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  const { r } = await editor(34);
  const kav = r.root.findByType(KeyboardAvoidingView);
  const safe = () =>
    r.root.findAll(n => n.props.testID === 'editor-safe-content')[0];
  expect(StyleSheet.flatten(kav.props.style).paddingBottom).toBeUndefined();
  expect(StyleSheet.flatten(safe().props.style).paddingBottom).toBe(34);
  expect(
    kav.findAll(n => n.props.testID === 'editor-safe-content').length,
  ).toBeGreaterThan(0);
  await act(async () => {
    listeners[Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow']();
  });
  expect(StyleSheet.flatten(safe().props.style).paddingBottom ?? 0).toBe(0);
  await act(async () => {
    listeners[Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide']();
  });
  expect(StyleSheet.flatten(safe().props.style).paddingBottom).toBe(34);
  await act(async () => r.unmount());
});

async function restoreWithEditorReadFailure() {
  const { r, chapter } = await editor();
  const original = (await chapters.get(chapter.id)).body;
  await versions.snapshot(chapter.id, 'manual');
  await type(r, '　　恢复前的另一个版本');
  await press(r, '更多');
  await until(r, s => s.includes('章节信息'));
  await press(r, '版本历史');
  await until(r, s => s.includes('比现在少'));
  await press(r, /\d{2}:\d{2} 6 字$/);
  await until(r, s => s.includes('恢复这个版本'));
  await press(r, '恢复这个版本');
  await until(r, s => s.includes('正文会换成'));
  // Both the transaction and VersionDiff's own reads already succeeded; only
  // the retained editor's post-restore load is unavailable.
  const read = jest
    .spyOn(chapters, 'get')
    .mockRejectedValue(new AppError('DB_ERROR', 'post-restore read failed'));
  const write = jest.spyOn(chapters, 'saveBody');
  await press(r, '恢复这个版本');
  await until(r, s => s.includes('这一章没有加载出来。'));
  return { r, chapter, original, read, write };
}

it('cannot overwrite a restored chapter when reloading its body fails and the user leaves', async () => {
  const { r, chapter, original, read, write } =
    await restoreWithEditorReadFailure();
  expect(input(r)).toBeUndefined();
  expect(allText(r)).not.toContain('恢复前的另一个版本');
  await wait(2200);
  expect(write).not.toHaveBeenCalled();
  await press(r, '返回');
  await until(r, s => s.includes('已返回来源页'));
  expect(write).not.toHaveBeenCalled();
  read.mockRestore();
  expect((await chapters.get(chapter.id)).body).toBe(original);
  expect(
    (await versions.list(chapter.id)).filter(
      v => v.reason === 'before_restore',
    ),
  ).toHaveLength(1);
  await act(async () => r.unmount());
});

it('retries a failed post-restore load with a new session for the restored body only', async () => {
  const { r, chapter, original, read, write } =
    await restoreWithEditorReadFailure();
  expect(input(r)).toBeUndefined();
  read.mockRestore();
  await press(r, '重试');
  await until(r, s => s.includes('已恢复，原内容已存为版本'));
  expect(input(r).props.value).toBe(`　　${original}`);
  expect(input(r).props.selection).toEqual({ start: 2, end: 2 });
  await press(r, '返回');
  await until(r, s => s.includes('已返回来源页'));
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenLastCalledWith(chapter.id, original, 0);
  expect((await chapters.get(chapter.id)).body).toBe(original);
  await act(async () => r.unmount());
});
