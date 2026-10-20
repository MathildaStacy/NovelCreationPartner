import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import { freshDb } from '../helpers/db';
import { allText, press, pressable, until } from '../helpers/render';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import { RootStack } from '../../src/app/navigation/RootStack';
import type { RootStackParamList } from '../../src/app/navigation/types';
import { WritingPrefsSheet } from '../../src/screens/settings/WritingPrefsSheet';
import { TrashScreen } from '../../src/screens/settings/TrashScreen';
import * as prefs from '../../src/features/prefs';
import * as works from '../../src/features/works';
import * as trash from '../../src/features/trash';
import * as chapters from '../../src/features/chapters';

beforeEach(() => { useOverlay.setState({ dialogs: [], toast: null, depth: 0 }); });
async function mount(content: React.ReactNode) {
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer>{content}<OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  return screen;
}
test('welcome stays incomplete until the author explicitly skips connecting a model', async () => {
  const db = await freshDb();
  const screen = await mount(<RootStack initialRoute="Welcome" />);
  expect(await prefs.get('onboardingDone')).toBe(false);
  await press(screen, '开始创作');
  await until(screen, text => text.includes('稍后再说'));
  expect(await prefs.get('onboardingDone')).toBe(false);
  await press(screen, '稍后再说');
  await until(screen, text => text.includes('我的书架'));
  expect(await prefs.get('onboardingDone')).toBe(true);
  await act(async () => screen.unmount()); await db.close();
});
test('writing preferences retain explicit candidates and persist changes without any model', async () => {
  const db = await freshDb(); await prefs.set('candidateCount', 3);
  const Stack = createNativeStackNavigator<RootStackParamList>();
  const screen = await mount(<Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Settings">{() => <WritingPrefsSheet visible onClose={() => {}} />}</Stack.Screen></Stack.Navigator>);
  await until(screen, text => text.includes('描写候选版本数'));
  expect(await prefs.get('candidateCount')).toBe(3);
  await press(screen, '黑体');
  expect(await prefs.get('editorFont')).toBe('sans');
  await press(screen, '1');
  expect(await prefs.get('candidateCount')).toBe(1);
  expect(allText(screen)).toContain('版本越多，等待越久、消耗的额度越多');
  await press(screen, '当前章节相关');
  expect(await prefs.get('partnerScope')).toBe('chapter');
  await act(async () => screen.unmount()); await db.close();
});
test('trash requires confirmation before permanent deletion and refreshes local rows', async () => {
  const db = await freshDb(); const work = await works.create({ title: '归潮', premise: '海边的故事' }); await works.remove(work.id);
  const Stack = createNativeStackNavigator<RootStackParamList>();
  const screen = await mount(<Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Trash" component={TrashScreen} /><Stack.Screen name="Shelf">{() => <Text>书架</Text>}</Stack.Screen></Stack.Navigator>);
  await until(screen, text => text.includes('归潮'));
  // 彻底删除 is no longer a visible row button (S15d #6): swipe or long press reveals it.
  expect(() => pressable(screen, '彻底删除')).toThrow();
  await press(screen, /^归潮，/, 'onLongPress');
  await until(screen, text => text.includes('彻底删除'));
  await press(screen, '彻底删除');
  await until(screen, text => text.includes('彻底删除「归潮」？'));
  expect(await trash.list()).toHaveLength(1);
  await press(screen, '取消');
  expect(await trash.list()).toHaveLength(1);
  // Screen readers reach the same action without the gesture.
  await act(async () => { pressable(screen, /^归潮，/, 'onLongPress').props.onAccessibilityAction({ nativeEvent: { actionName: 'purge' } }); });
  await until(screen, text => text.includes('彻底删除「归潮」？'));
  await press(screen, '彻底删除');
  await until(screen, text => text.includes('回收站是空的'));
  expect(await trash.list()).toHaveLength(0);
  await act(async () => screen.unmount()); await db.close();
});
test('trash long-press sheet restores, and the toast names the item with 查看', async () => {
  const db = await freshDb(); const work = await works.create({ title: '归潮', premise: '海边的故事' }); await works.remove(work.id);
  const Stack = createNativeStackNavigator<RootStackParamList>();
  const screen = await mount(<Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Trash" component={TrashScreen} /><Stack.Screen name="Work">{() => <Text>作品页</Text>}</Stack.Screen></Stack.Navigator>);
  await until(screen, text => text.includes('归潮'));
  await press(screen, /^归潮，/, 'onLongPress');
  await until(screen, text => text.includes('恢复\n') || text.split('恢复').length > 2);
  const sheetRestore = screen.root.findAll(n => typeof n.type !== 'string' && n.props.accessibilityLabel === '恢复' && typeof n.props.onPress === 'function');
  await act(async () => { sheetRestore[sheetRestore.length - 1].props.onPress(); });
  await until(screen, text => text.includes('已恢复「归潮」'));
  expect(await trash.list()).toHaveLength(0);
  await press(screen, '查看');
  await until(screen, text => text.includes('作品页'));
  await act(async () => screen.unmount()); await db.close();
});

test('S15d restoring a chapter whose work is also deleted restores both after confirming; 清空 is red, final, and disabled once empty', async () => {
  const db = await freshDb();
  const work = await works.create({ title: '归潮', premise: '海边的故事' });
  const group = (await chapters.list(work.id))[0];
  const chapter = await chapters.create({ workId: work.id, volumeId: group.volume.id, title: '潮声' });
  await chapters.remove(chapter.id); await works.remove(work.id);
  const other = await works.create({ title: '雾港', premise: '雾' }); await works.remove(other.id);
  const Stack = createNativeStackNavigator<RootStackParamList>();
  const screen = await mount(<Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Trash" component={TrashScreen} /><Stack.Screen name="Work">{() => <Text>作品页</Text>}</Stack.Screen></Stack.Navigator>);
  await until(screen, text => text.includes('潮声'));
  await press(screen, '恢复'); // the last 恢复 belongs to the chapter row
  await until(screen, text => text.includes('一并恢复所属作品？'));
  await press(screen, '一并恢复');
  await until(screen, text => text.includes('已恢复「第 1 章 潮声」') || text.includes('已恢复'));
  expect((await works.get(work.id)).deletedAt).toBeNull();
  expect((await chapters.get(chapter.id)).deletedAt).toBeNull();
  await press(screen, '清空');
  await until(screen, () => useOverlay.getState().dialogs.some(d => d.title === '清空回收站？'));
  const dialog = useOverlay.getState().dialogs.find(d => d.title === '清空回收站？')!;
  expect(dialog.buttons.find(b => b.key === 'empty')?.style).toBe('danger');
  await press(screen, '清空');
  await until(screen, text => text.includes('回收站是空的'));
  expect(useOverlay.getState().toast?.message).toBe('回收站已清空');
  expect(useOverlay.getState().toast?.action).toBeUndefined();
  expect(pressable(screen, '清空').props.disabled).toBe(true);
  await act(async () => screen.unmount()); await db.close();
});

test('S01 is always dark and reads the slogan as one sentence; decorations are hidden from screen readers', async () => {
  const { WelcomeScreen } = require('../../src/screens/welcome/WelcomeScreen');
  const { color } = require('../../src/theme/tokens');
  const Stack = createNativeStackNavigator<RootStackParamList>();
  const screen = await mount(<Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Welcome" component={WelcomeScreen} /></Stack.Navigator>);
  await until(screen, text => text.includes('开始创作'));
  const scroll = screen.root.findAll(n => n.props.style && JSON.stringify(n.props.style).includes(color.night) && typeof n.props.contentContainerStyle !== 'undefined');
  expect(scroll.length).toBeGreaterThan(0);
  const slogan = screen.root.findAll(n => n.props.accessible === true && n.props.accessibilityLabel === '让每一个创意，都有故事可写');
  expect(slogan.length).toBeGreaterThan(0);
  expect(screen.root.findAll(n => n.props.importantForAccessibility === 'no-hide-descendants').length).toBeGreaterThanOrEqual(2);
  await act(async () => screen.unmount());
});
