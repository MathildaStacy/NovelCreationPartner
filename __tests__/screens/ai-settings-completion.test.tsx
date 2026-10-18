import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { freshDb } from '../helpers/db';
import * as works from '../../src/features/works';
import * as entries from '../../src/features/entries';
import * as completion from '../../src/features/entryCompletion';
import { EntryCompletionSheet } from '../../src/screens/archive/EntryCompletionSheet';
import { ServiceBindingsSheet } from '../../src/screens/settings/ServiceBindingsSheet';
import { AiUsageSheet } from '../../src/screens/settings/AiUsageSheet';
import { allText, press, until } from '../helpers/render';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import type { RootStackParamList } from '../../src/app/navigation/types';

test('entry completion opens locally, selects empty fields and missing service does not generate or alter archive', async () => {
  const db = await freshDb(); const work = await works.create({ premise: '灵感' });
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇', facts: [{ field: 'identity', value: '少年' }] });
  useOverlay.setState({ dialogs: [], toast: null, depth: 0 });
  const Stack = createNativeStackNavigator<RootStackParamList>();
  const generate = jest.spyOn(completion, 'complete');
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="EntryDetail" initialParams={{ entryId: entry.id }}>{({ navigation }) => <EntryCompletionSheet entry={entry} navigation={navigation} onClose={() => {}} />}</Stack.Screen>
  </Stack.Navigator><OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  await until(renderer, text => text.includes('选择 1–5 个字段'));
  await press(renderer, '预览发送范围');
  await until(renderer, text => text.includes('先连接一个模型服务'));
  expect(generate).not.toHaveBeenCalled(); expect((await entries.get(entry.id)).proposedFacts).toEqual([]);
  await press(renderer, '不用 AI，继续写');
  await act(async () => renderer.unmount()); generate.mockRestore(); await db.close();
});

test('usage states unknown fee and binding UI offers saved-default selection without model calls', async () => {
  const db = await freshDb(); const Stack = createNativeStackNavigator();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Settings">
    {() => <><ServiceBindingsSheet visible onClose={() => {}} /><AiUsageSheet visible onClose={() => {}} /></>}
  </Stack.Screen></Stack.Navigator></NavigationContainer></SafeAreaProvider>); });
  await until(renderer, text => text.includes('费用未知') && text.includes('沿用默认服务'));
  expect(allText(renderer)).toMatch(/0\s+次物理请求/);
  expect(allText(renderer)).not.toContain('¥0');
  await act(async () => renderer.unmount()); await db.close();
});
