import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as conversations from '../../src/features/conversations';
import * as works from '../../src/features/works';
import { useOverlay } from '../../src/components/overlay/store';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { ConversationSheet } from '../../src/screens/partner/ConversationSheet';
import { freshDb } from '../helpers/db';
import { allText, press, pressable, until } from '../helpers/render';

beforeEach(() => { useOverlay.setState({ dialogs: [], toast: null, depth: 0 }); });

async function setup() {
  const db = await freshDb();
  const work = await works.create({ title: '归潮', premise: '海边的古镜' });
  const first = await conversations.create(work.id);
  await conversations.rename(first.id, '古镜来历');
  const second = await conversations.create(work.id);
  await conversations.rename(second.id, '灯塔规则');
  const picked = jest.fn();
  const Stack = createNativeStackNavigator();
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Partner">
        {() => <ConversationSheet visible workId={work.id} currentId={first.id} onPick={picked} onClose={() => {}} />}
      </Stack.Screen></Stack.Navigator>
      <OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>);
  });
  await until(screen, text => text.includes('灯塔规则') && text.includes('古镜来历'));
  return { db, work, first, second, picked, screen };
}

test('S10b rows hide 重命名 / 删除 until swipe or long press, one row at a time', async () => {
  const { db, first, second, picked, screen } = await setup();
  expect(() => pressable(screen, '删除对话')).toThrow();
  await press(screen, '古镜来历', 'onLongPress');
  expect(pressable(screen, '删除对话')).toBeTruthy();
  // Long-pressing another row moves the revealed actions there.
  await press(screen, '灯塔规则', 'onLongPress');
  const live = screen.root.findAll(n => typeof n.type !== 'string' && n.props.accessibilityLabel === '重命名' && typeof n.props.onPress === 'function');
  expect(live).toHaveLength(1);
  await act(async () => live[0].props.onPress());
  await until(screen, text => text.includes('重命名对话'));
  const input = screen.root.findAll(n => n.props.accessibilityLabel === '对话标题' && typeof n.props.onChangeText === 'function');
  await act(async () => input[0].props.onChangeText('灯塔守则'));
  await press(screen, '保存');
  await until(screen, text => text.includes('灯塔守则'));
  expect((await conversations.get(second.id)).title).toBe('灯塔守则');
  expect(picked).not.toHaveBeenCalled();
  expect((await conversations.get(first.id)).title).toBe('古镜来历');
  await act(async () => screen.unmount()); await db.close();
});

test('S10b delete via screen reader action confirms and resets the current conversation', async () => {
  const { db, work, first, picked, screen } = await setup();
  const row = screen.root.findAll(n => typeof n.type !== 'string' && n.props.accessibilityLabel === '古镜来历' && typeof n.props.onAccessibilityAction === 'function')[0];
  expect(row.props.accessibilityActions.map((a: { label: string }) => a.label)).toEqual(['重命名', '删除对话']);
  await act(async () => row.props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } }));
  await until(screen, text => text.includes('对话会永久删除'));
  await press(screen, '删除对话');
  await until(screen, () => useOverlay.getState().toast?.message === '已删除');
  expect(picked).toHaveBeenCalledWith(null);
  expect((await conversations.list(work.id)).map(c => c.id)).not.toContain(first.id);
  expect(allText(screen)).not.toContain('古镜来历');
  await act(async () => screen.unmount()); await db.close();
});
