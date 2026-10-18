import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import { freshDb } from '../helpers/db';
import { allText, press, until } from '../helpers/render';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import { RootStack } from '../../src/app/navigation/RootStack';
import type { RootStackParamList } from '../../src/app/navigation/types';
import { WritingPrefsSheet } from '../../src/screens/settings/WritingPrefsSheet';
import { TrashScreen } from '../../src/screens/settings/TrashScreen';
import * as prefs from '../../src/features/prefs';
import * as works from '../../src/features/works';
import * as trash from '../../src/features/trash';

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
  expect(allText(screen)).toContain('新用户默认 1 个版本');
  await act(async () => screen.unmount()); await db.close();
});
test('trash requires confirmation before permanent deletion and refreshes local rows', async () => {
  const db = await freshDb(); const work = await works.create({ title: '归潮', premise: '海边的故事' }); await works.remove(work.id);
  const Stack = createNativeStackNavigator<RootStackParamList>();
  const screen = await mount(<Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Trash" component={TrashScreen} /><Stack.Screen name="Shelf">{() => <Text>书架</Text>}</Stack.Screen></Stack.Navigator>);
  await until(screen, text => text.includes('归潮'));
  await press(screen, '彻底删除');
  await until(screen, text => text.includes('彻底删除「归潮」？'));
  expect(await trash.list()).toHaveLength(1);
  await press(screen, '取消');
  expect(await trash.list()).toHaveLength(1);
  await press(screen, '彻底删除');
  await until(screen, text => text.includes('彻底删除「归潮」？'));
  await press(screen, '彻底删除');
  await until(screen, text => text.includes('回收站是空的'));
  expect(await trash.list()).toHaveLength(0);
  await act(async () => screen.unmount()); await db.close();
});
