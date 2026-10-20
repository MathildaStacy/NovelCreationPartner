import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { RootStackParamList } from '../../src/app/navigation/types';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { setDb } from '../../src/data/db';
import { migrate } from '../../src/data/migrations';
import * as works from '../../src/features/works';
import * as volumes from '../../src/features/volumes';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import { EntryDetailScreen } from '../../src/screens/archive/EntryDetailScreen';
import { EntryFormScreen } from '../../src/screens/archive/EntryFormScreen';
import { ArchiveLookupSheet } from '../../src/screens/archive/ArchiveLookupSheet';
import { allText, press, typeInto, until, wait } from '../helpers/render';
import { useOverlay } from '../../src/components/overlay/store';

async function fixture() {
  const db = openMemoryDb(); setDb(db); await migrate(db);
  const work = await works.create({ title: '归潮', premise: '一个海边故事' });
  const [volume] = await volumes.list(work.id);
  const first = await chapters.create({ workId: work.id, volumeId: volume.id, title: '初遇' });
  const next = await chapters.create({ workId: work.id, volumeId: volume.id, title: '觉醒' });
  useOverlay.setState({ toast: null, dialogs: [], depth: 0 });
  return { db, work, first, next };
}

test('entry form persists manual fields and effective chapter without a model service', async () => {
  const { db, work, first } = await fixture();
  let r!: ReactTestRenderer.ReactTestRenderer;
  const Stack = createNativeStackNavigator<RootStackParamList>();
  await act(async () => { r = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer>
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="EntryForm" component={EntryFormScreen} initialParams={{ workId: work.id, type: 'character' }} />
      <Stack.Screen name="EntryDetail">{() => <Text>已保存条目详情</Text>}</Stack.Screen>
    </Stack.Navigator><OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  await until(r, text => text.includes('名称（必填）'));
  await typeInto(r, '给条目起个名称', '林宇');
  const input = r.root.findAll(n => n.props.accessibilityLabel === '身份' && typeof n.props.onChangeText === 'function')[0];
  await act(async () => { input.props.onChangeText('渔村少年'); });
  await press(r, '保存');
  await wait(30);
  const listed = await entries.list(work.id);
  expect(listed).toHaveLength(1);
  const detail = await entries.get(listed[0].id);
  expect(detail.facts[0]).toMatchObject({ field: 'identity', value: '渔村少年', state: 'CONFIRMED' });
  expect(allText(r)).toContain('已保存条目详情');
  expect(await chapters.get(first.id)).toMatchObject({ body: '' });
  await act(async () => r.unmount()); db.close();
});

test('lookup uses unsaved body and hides future facts while exposing later-change marker', async () => {
  const { db, work, first, next } = await fixture();
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇', aliases: ['小宇'], facts: [{ field: 'ability', value: '尚未觉醒', fromChapterId: first.id }] });
  await entries.update(entry.id, { facts: [{ field: 'ability', value: '星芒外放', fromChapterId: next.id }] });
  const open = jest.fn(async () => {});
  let r!: ReactTestRenderer.ReactTestRenderer;
  const Stack = createNativeStackNavigator<RootStackParamList>();
  await act(async () => { r = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer>
    <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Shelf">{() => <ArchiveLookupSheet visible workId={work.id} chapterId={first.id}
      body="林宇回过头。小宇听见呼唤。" onClose={() => {}} onOpen={open} />}</Stack.Screen></Stack.Navigator>
    </NavigationContainer></SafeAreaProvider>); });
  await until(r, text => text.includes('林宇') && text.includes('2 次'));
  // The persisted chapter body is empty; matches must come from editor memory.
  expect((await chapters.get(first.id)).body).toBe('');
  await press(r, '人物 · 林宇 · 2 次 展开');
  await until(r, text => text.includes('尚未觉醒'));
  expect(allText(r)).toContain('按第 1 章时的状态');
  expect(allText(r)).toContain('第 2 章起有变化');
  expect(allText(r)).not.toContain('星芒外放');
  await press(r, '在档案中打开');
  expect(open).toHaveBeenCalledWith(entry.id);
  await act(async () => r.unmount()); db.close();
});

test('proposal fields occupy their template position without an empty duplicate and historical scope hides proposals', async () => {
  const { db, work } = await fixture();
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇', summary: '渔村人物', facts: [{ field: 'background', value: '出生在渔村' }] });
  await entries.proposeFacts(entry.id, [{ field: 'motivation', value: '想弄清镜子的来历' }], { kind: 'ai_complete', ref: null });
  const Stack = createNativeStackNavigator<RootStackParamList>();
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="EntryDetail" component={EntryDetailScreen} initialParams={{ entryId: entry.id }} />
  </Stack.Navigator><OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  await until(screen, text => text.includes('想弄清镜子的来历'));
  const text = allText(screen);
  expect(text.indexOf('想弄清镜子的来历')).toBeLessThan(text.indexOf('出生在渔村'));
  expect(text.match(/动机/g)).toHaveLength(1);
  await press(screen, '查看：当前状态');
  await press(screen, '第 1 章 初遇');
  await until(screen, value => value.includes('时的状态'));
  expect(allText(screen)).not.toContain('想弄清镜子的来历');
  await act(async () => screen.unmount()); db.close();
});

test('S07c lists entries by mention count with aliases counted, highest first', async () => {
  const { db, work, first } = await fixture();
  await entries.create({ workId: work.id, type: 'character', name: '林宇', aliases: ['小宇'] });
  await entries.create({ workId: work.id, type: 'character', name: '老周' });
  await entries.create({ workId: work.id, type: 'character', name: '沈汐' });
  let r!: ReactTestRenderer.ReactTestRenderer;
  const Stack = createNativeStackNavigator<RootStackParamList>();
  await act(async () => { r = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer>
    <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Shelf">{() => <ArchiveLookupSheet visible workId={work.id} chapterId={first.id}
      body="沈汐看着林宇。老周咳了一声。小宇没有回答，沈汐又问。林宇低头。沈汐笑了，沈汐转身。" onClose={() => {}} onOpen={async () => {}} />}</Stack.Screen></Stack.Navigator>
    </NavigationContainer></SafeAreaProvider>); });
  const text = await until(r, value => value.includes('4 次') && value.includes('3 次') && value.includes('1 次'));
  expect(text.indexOf('沈汐')).toBeLessThan(text.indexOf('林宇'));
  expect(text.indexOf('林宇')).toBeLessThan(text.indexOf('老周'));
  await act(async () => r.unmount()); db.close();
});
