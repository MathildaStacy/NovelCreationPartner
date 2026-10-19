import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../../src/app/navigation/types';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import { ConflictsScreen } from '../../src/screens/review/ConflictsScreen';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as conflicts from '../../src/features/conflicts';
import * as entries from '../../src/features/entries';
import { freshDb } from '../helpers/db';
import { allText, press, until } from '../helpers/render';

test('later has its own segment and removing the chapter chip exposes the whole work without clearing entry scope', async () => {
  const db = await freshDb();
  const work = await works.create({ title: '归潮', premise: '古镜' });
  const volume = (await chapters.list(work.id))[0].volume;
  const first = await chapters.create({ workId: work.id, volumeId: volume.id, title: '觉醒' });
  const second = await chapters.create({ workId: work.id, volumeId: volume.id, title: '潮声' });
  const selectedEntry = await entries.create({ workId: work.id, type: 'character', name: '林宇' });
  const otherEntry = await entries.create({ workId: work.id, type: 'character', name: '镜灵' });
  const insert = (id: string, chapterId: string, entryId: string, status: string, explanation: string) => db.run(`INSERT INTO conflicts
    (id,work_id,chapter_id,entry_id,type,severity,a_label,a_ref,a_quote,b_label,b_ref,b_quote,explanation,suggestions,status,fingerprint,created_at)
    VALUES (?,?,?,?,'setting','high','正文','chapter:fixture','原句','设定','entry:fixture','设定句',?,'[]',?,?,?)`,
  [id, work.id, chapterId, entryId, explanation, status, id, new Date().toISOString()]);
  await insert('open-first', first.id, selectedEntry.id, 'open', '本章待处理冲突');
  await insert('later-first', first.id, selectedEntry.id, 'later', '本章稍后处理冲突');
  await insert('resolved-first', first.id, selectedEntry.id, 'intentional', '本章已处理冲突');
  await insert('later-second', second.id, selectedEntry.id, 'later', '另一章稍后处理冲突');
  await insert('other-entry', second.id, otherEntry.id, 'later', '其他条目冲突');
  useOverlay.setState({ dialogs: [], toast: null, depth: 0 });
  const Stack = createNativeStackNavigator<RootStackParamList>();
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer>
    <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Conflicts" component={ConflictsScreen}
      initialParams={{ workId: work.id, chapterId: first.id, entryId: selectedEntry.id }} /></Stack.Navigator>
    <OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  await until(screen, text => text.includes('本章待处理冲突'));
  expect(allText(screen)).not.toContain('本章稍后处理冲突');
  expect((await conflicts.forChapter(first.id))).toHaveLength(2);
  await press(screen, '稍后处理 1');
  await until(screen, text => text.includes('本章稍后处理冲突'));
  expect(allText(screen)).not.toContain('本章待处理冲突');
  expect(allText(screen)).not.toContain('另一章稍后处理冲突');
  await press(screen, '移除章节筛选，查看全书冲突');
  await until(screen, text => text.includes('另一章稍后处理冲突'));
  expect(allText(screen)).toContain('稍后处理 2');
  expect(allText(screen)).not.toContain('其他条目冲突');
  expect(allText(screen)).not.toContain('筛选：第 1 章');
  await press(screen, '已处理 1');
  expect(allText(screen)).toContain('本章已处理冲突');
  expect(allText(screen)).not.toContain('本章稍后处理冲突');
  expect(await db.all('SELECT * FROM ai_attempts')).toHaveLength(0);
  await act(async () => screen.unmount()); db.close();
});

test('cards show type, entry, severity and chapter; empty open segment uses the design copy', async () => {
  const db = await freshDb();
  const work = await works.create({ title: '归潮', premise: '古镜' });
  const volume = (await chapters.list(work.id))[0].volume;
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, title: '星图残页' });
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇', facts: [{ field: 'ability', value: '只能淬体' }] });
  useOverlay.setState({ dialogs: [], toast: null, depth: 0 });
  const Stack = createNativeStackNavigator<RootStackParamList>();
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer>
    <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Conflicts" component={ConflictsScreen} initialParams={{ workId: work.id }} /></Stack.Navigator>
    <OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  await until(screen, text => text.includes('没有发现设定冲突。章节定稿后，AI 会对照档案检查'));
  const fact = (await entries.get(entry.id)).facts[0];
  await db.run(`INSERT INTO conflicts (id,work_id,chapter_id,entry_id,type,severity,a_label,a_ref,a_quote,b_label,b_ref,b_quote,explanation,suggestions,status,fingerprint,created_at)
    VALUES ('c1',?,?,?,'character','medium','正文',?,'光刃斩断铁锁','林宇的能力',?,'只能淬体','第 1 章提前外放','[]','open','fp',?)`,
  [work.id, chapter.id, entry.id, `chapter:${chapter.id}`, `fact:${fact.id}`, new Date().toISOString()]);
  const { emit } = require('../../src/features/events');
  await act(async () => { emit('conflicts.changed', { workId: work.id }); });
  const text = await until(screen, t => t.includes('人物冲突 · 林宇'));
  expect(text).toContain('中严重度');
  expect(text).toContain('第 1 章 星图残页');
  expect(text).toContain('去处理 ›');
  expect((await conflicts.list(work.id))[0]).toMatchObject({ entryName: '林宇', chapter: { number: 1, title: '星图残页' }, fact: { fieldLabel: expect.any(String), fromNumber: null } });
  await act(async () => screen.unmount()); db.close();
});
