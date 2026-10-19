import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import type { RootStackParamList } from '../../src/app/navigation/types';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import { freshDb } from '../helpers/db';
import { allText, press, until } from '../helpers/render';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as proposals from '../../src/features/proposals';
import * as conflicts from '../../src/features/conflicts';
import { ReviewScreen } from '../../src/screens/review/ReviewScreen';
import { ConflictDetailScreen } from '../../src/screens/review/ConflictDetailScreen';
import { JobsScreen } from '../../src/screens/work/JobsScreen';

async function fixture() {
  const db = await freshDb();
  const work = await works.create({ title: '归潮', premise: '海边的古镜' });
  const group = (await chapters.list(work.id))[0];
  const chapter = await chapters.create({ workId: work.id, volumeId: group.volume.id, title: '觉醒' });
  await chapters.saveBody(chapter.id, '林宇的双眼亮起蓝色的光。', 0);
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇', facts: [{ field: 'ability', value: '尚未觉醒' }] });
  const finalized = await chapters.finalize(chapter.id);
  await db.run("UPDATE jobs SET status='done' WHERE id=?", [finalized.jobIds[1]]);
  await db.run(`INSERT INTO memory_proposals (id,work_id,chapter_id,kind,target_type,target_entry_id,target_name,field,before_value,after_value,evidence,evidence_offset,confidence,status,created_at,source_job_id)
    VALUES ('proposal',?,?,'update','character',?,'林宇','ability','尚未觉醒','蓝光觉醒','林宇的双眼亮起蓝色的光。',0,'high','pending',?,?)`, [work.id, chapter.id, entry.id, new Date().toISOString(), finalized.jobIds[1]]);
  await db.run('UPDATE memory_proposals SET evidence_version_id=(SELECT source_version_id FROM jobs WHERE id=?)', [finalized.jobIds[1]]);
  await db.run(`INSERT INTO conflicts (id,work_id,chapter_id,entry_id,type,severity,a_label,a_ref,a_quote,b_label,b_ref,b_quote,explanation,suggestions,status,fingerprint,created_at)
    VALUES ('conflict',?,?,?,'setting','high','正文',?,'林宇的双眼亮起蓝色的光。','能力',?,'尚未觉醒','能力与正文不一致','["可以作为伏笔"]','open','fixture-fingerprint',?)`, [work.id, chapter.id, entry.id, `chapter:${chapter.id}`, `entry:${entry.id}`, new Date().toISOString()]);
  useOverlay.setState({ dialogs: [], toast: null, depth: 0 });
  return { db, work, chapter, entry };
}
async function render(initial: 'Review' | 'ConflictDetail' | 'Jobs', params: object) {
  const Stack = createNativeStackNavigator<RootStackParamList>();
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer>
    <Stack.Navigator initialRouteName={initial} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Review" component={ReviewScreen} initialParams={initial === 'Review' ? params : { workId: 'unused' }} />
      <Stack.Screen name="ConflictDetail" component={ConflictDetailScreen} initialParams={{ conflictId: 'conflict' }} />
      <Stack.Screen name="Jobs" component={JobsScreen} initialParams={initial === 'Jobs' ? params : { workId: 'unused' }} />
      <Stack.Screen name="Editor">{({ route }) => <Text>{`原文定位：${route.params.locate?.quote}`}</Text>}</Stack.Screen>
    </Stack.Navigator><OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  return screen;
}

test('review exposes source evidence and edited acceptance writes only after author action', async () => {
  const { db, work, entry } = await fixture();
  const screen = await render('Review', { workId: work.id });
  await until(screen, text => text.includes('蓝光觉醒'));
  expect((await entries.get(entry.id)).facts[0].value).toBe('尚未觉醒');
  expect(allText(screen)).toContain('林宇的双眼亮起蓝色的光。');
  await press(screen, '修改后通过');
  await act(async () => { screen.root.findAll(node => node.props.accessibilityLabel === '审核新值' && typeof node.props.onChangeText === 'function')[0].props.onChangeText('可以放出蓝光'); });
  await press(screen, '保存并通过');
  await until(screen, text => text.includes('已写入档案'));
  expect((await entries.get(entry.id)).facts[0]).toMatchObject({ value: '可以放出蓝光', state: 'ESTABLISHED' });
  expect((await proposals.list(work.id))[0]).toMatchObject({ edited: true, acceptedValue: '可以放出蓝光', after: '蓝光觉醒' });
  await press(screen, '已通过 1');
  await press(screen, '撤销决定');
  await until(screen, text => text.includes('已撤销决定'));
  expect((await entries.get(entry.id)).facts[0].value).toBe('尚未觉醒');
  expect((await proposals.list(work.id))[0]).toMatchObject({ status: 'pending', edited: false, acceptedValue: null });
  await act(async () => screen.unmount()); db.close();
});

test('conflict author decision persists intentional status and can reopen locally', async () => {
  const { db } = await fixture();
  const screen = await render('ConflictDetail', { conflictId: 'conflict' });
  await until(screen, text => text.includes('能力与正文不一致'));
  await press(screen, '有意为之');
  await until(screen, text => text.includes('重新打开这个冲突'));
  expect((await conflicts.get('conflict')).status).toBe('intentional');
  await press(screen, '重新打开这个冲突');
  await until(screen, text => text.includes('正文已修改，标记已处理'));
  expect((await conflicts.get('conflict')).status).toBe('open');
  await press(screen, '跳到原文修改');
  await until(screen, text => text.includes('原文定位：林宇的双眼亮起蓝色的光。'));
  await act(async () => screen.unmount()); db.close();
});

test('jobs show parent budget and legacy input requires re-finalization without a request', async () => {
  const { db, work } = await fixture();
  await db.run("UPDATE jobs SET status='paused',pause_reason='legacy_input'");
  const screen = await render('Jobs', { workId: work.id });
  await until(screen, text => text.includes('已尝试 0 / 2 次'));
  expect(allText(screen)).toContain('旧任务未绑定输入，请重新确认定稿');
  expect(allText(screen)).toContain('费用未知');
  expect(await db.all('SELECT * FROM ai_attempts')).toHaveLength(0);
  await act(async () => screen.unmount()); db.close();
});


test('deletion review points to old version evidence and never locates the removed quote in current prose', async () => {
  const { db, work } = await fixture();
  await db.run("UPDATE memory_proposals SET origin='deletion',kind='retire',after_value='' WHERE id='proposal'");
  const screen = await render('Review', { workId: work.id });
  await until(screen, text => text.includes('旧定稿证据已从当前正文移除'));
  expect(allText(screen)).toContain('查看旧定稿证据');
  expect(allText(screen)).not.toContain('跳到原文');
  expect(allText(screen)).not.toContain('修改后通过');
  await act(async () => screen.unmount()); db.close();
});

test('superseded conflict is read-only and cannot be reopened from the UI', async () => {
  const { db } = await fixture();
  await db.run("UPDATE conflicts SET status='superseded' WHERE id='conflict'");
  const screen = await render('ConflictDetail', { conflictId: 'conflict' });
  await until(screen, text => text.includes('已被后续定稿取代'));
  expect(allText(screen)).not.toContain('重新打开这个冲突');
  expect(allText(screen)).not.toContain('有意为之');
  await expect(conflicts.reopen('conflict')).rejects.toMatchObject({code:'AI_RESULT_STALE'});
  await expect(conflicts.resolve('conflict',{status:'intentional'})).rejects.toMatchObject({code:'AI_RESULT_STALE'});
  expect((await conflicts.get('conflict')).status).toBe('superseded');
  await act(async () => screen.unmount()); db.close();
});
