/** S12 / S12b / S12c / S12d / S13a acceptance gaps (2026-10-20 remaining-polish slice). */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../../src/app/navigation/types';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import * as dialogs from '../../src/app/dialogs';
import * as ai from '../../src/features/ai';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as relations from '../../src/features/relations';
import * as completion from '../../src/features/entryCompletion';
import { AiCallError } from '../../src/features/errors';
import type { ChapterListItem, EntryType, HistoryItem } from '../../src/features/types';
import { EntryDetailScreen, entryDeleteBody, showTimeline } from '../../src/screens/archive/EntryDetailScreen';
import { EntryCompletionSheet } from '../../src/screens/archive/EntryCompletionSheet';
import { historyNote } from '../../src/screens/archive/EntryHistoryScreen';
import { RelationSheet } from '../../src/screens/archive/RelationSheet';
import { chapterLabel, chapterRange } from '../../src/screens/archive/shared';
import { freshDb } from '../helpers/db';
import { allText, press, until as untilRaw } from '../helpers/render';

/** Match against text with node breaks removed ("动机 · AI 补全的提议" renders as several nodes). */
const until = (r: ReactTestRenderer.ReactTestRenderer, pred: (text: string) => boolean) => untilRaw(r, text => pred(text.replace(/\n/g, '')));

async function fixture(count = 3) {
  const db = await freshDb();
  const work = await works.create({ title: '归潮', premise: '海边的古镜' });
  const group = (await chapters.list(work.id))[0];
  const list = [];
  for (let i = 0; i < count; i++) { list.push(await chapters.create({ workId: work.id, volumeId: group.volume.id, title: ['初遇', '觉醒', '离岛'][i] ?? `第 ${i + 1} 章` })); }
  useOverlay.setState({ toast: null, dialogs: [], depth: 0 });
  return { db, work, chapters: list };
}

const Stack = createNativeStackNavigator<RootStackParamList>();
async function renderDetail(entryId: string, extra?: (seen: Record<string, unknown>[]) => React.ReactNode) {
  const seen: Record<string, unknown>[] = [];
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="EntryDetail" component={EntryDetailScreen} initialParams={{ entryId }} />
    <Stack.Screen name="EntryForm">{({ route }) => { seen.push({ screen: 'EntryForm', ...route.params }); return <Text>{`编辑页：${route.params.field ?? ''}`}</Text>; }}</Stack.Screen>
    <Stack.Screen name="Review">{({ route }) => { seen.push({ screen: 'Review', ...route.params }); return <Text>{`审核页：${route.params.proposalId ?? ''}`}</Text>; }}</Stack.Screen>
    {extra ? <Stack.Screen name="Settings">{() => extra(seen)}</Stack.Screen> : null}
  </Stack.Navigator><OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  return { screen, seen };
}

const chapterItem = (id: string, number: number | null, title: string, kind: 'main' | 'extra' = 'main') =>
  ({ id, number, title, kind } as unknown as ChapterListItem);

test('archive chapter labels never repeat a default title and ranges use chapter numbers', () => {
  const list = [chapterItem('a', 3, '第 3 章'), chapterItem('b', 4, '海边'), chapterItem('c', 10, '第10章'), chapterItem('x', null, '番外', 'extra')];
  expect(chapterLabel('a', list)).toBe('第 3 章');
  expect(chapterLabel('b', list)).toBe('第 4 章 海边');
  expect(chapterLabel('c', list)).toBe('第 10 章');
  expect(chapterLabel('x', list)).toBe('番外');
  expect(chapterRange('a', 'c', list)).toBe('第 3–10 章');
  expect(chapterRange('a', null, list)).toBe('自第 3 章');
  expect(chapterRange(null, null, list)).toBe('始终有效');
});

test('D02 entry body omits zero relations and names pending proposals and the retire hint', () => {
  expect(entryDeleteBody(0, 0)).toBe('条目会移到回收站，30 天内可以恢复。正文不会改变。提示：如果只是不再使用这个设定，可以改为"废弃"，它会保留在历史中。');
  expect(entryDeleteBody(2, 1)).toContain('条目和它的 2 条关系会移到回收站');
  expect(entryDeleteBody(2, 1)).toContain('指向它的 1 条待审核变更将无法通过。');
});

test.each<[EntryType, string[]]>([
  ['character', ['身份', '外貌', '性格', '目标', '动机', '能力', '背景', '秘密', '成长弧']],
  ['world', ['内容', '限制', '例外']], ['rule', ['内容', '限制', '例外']],
  ['place', ['描述', '所属', '位置关系']], ['faction', ['宗旨', '成员', '据点', '实力']],
  ['foreshadow', ['内容', '计划回收', '是否已回收']],
])('S12 %s template shows every field, empty ones as 未填写, tap opens S12a on that field', async (type, labels) => {
  const { db, work } = await fixture(1);
  const entry = await entries.create({ workId: work.id, type, name: `条目${type}` });
  const { screen, seen } = await renderDetail(entry.id);
  const text = await until(screen, value => value.includes(labels[0]));
  let last = -1;
  for (const label of labels) { const at = text.indexOf(label, last + 1); expect(at).toBeGreaterThan(last); last = at; }
  expect(text).toContain('未填写');
  const first = entries.ENTRY_FIELDS[type][0];
  await press(screen, new RegExp(`^${labels[0]}未填写`));
  await until(screen, value => value.includes(`编辑页：${first}`));
  expect(seen.at(-1)).toMatchObject({ screen: 'EntryForm', workId: work.id, entryId: entry.id, field: first });
  await act(async () => screen.unmount()); db.close();
});

test('AI completion proposal is dashed with its source; adopt makes it formal and discard returns to 未填写 with undo', async () => {
  const { db, work } = await fixture(1);
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇' });
  await entries.proposeFacts(entry.id, [{ field: 'motivation', value: '想证明自己' }, { field: 'secret', value: '左手腕有胎记' }], { kind: 'ai_complete', ref: null });
  const { screen } = await renderDetail(entry.id);
  await until(screen, value => value.includes('动机 · AI 补全的提议') && value.includes('秘密 · AI 补全的提议'));
  // press() hits the last match: the 秘密 proposal is adopted, then the 动机 proposal is discarded.
  await press(screen, '采纳');
  await until(screen, value => value.includes('已采纳') && !value.includes('秘密 · AI 补全的提议') && value.includes('秘密左手腕有胎记'));
  expect((await entries.get(entry.id)).facts.find(f => f.field === 'secret')).toMatchObject({ value: '左手腕有胎记', state: 'CONFIRMED' });
  expect(screen.root.findAll(n => typeof n.type === 'string' && JSON.stringify(n.props.style ?? '').includes('dashed'))).toHaveLength(1);
  await press(screen, '丢弃');
  await until(screen, value => value.includes('已丢弃') && !value.includes('想证明自己') && value.includes('动机未填写'));
  await press(screen, '撤销');
  await until(screen, value => value.includes('动机 · AI 补全的提议') && value.includes('想证明自己'));
  await act(async () => screen.unmount()); db.close();
});

test('timeline appears with two phases, past chapter view shows the earlier value, and ended relations read 第 1–2 章', async () => {
  const { db, work, chapters: [ch1, ch2, ch3] } = await fixture(3);
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇', facts: [{ field: 'ability', value: '星辰之力 Lv.2', fromChapterId: ch1.id }] });
  const other = await entries.create({ workId: work.id, type: 'character', name: '老周' });
  expect(showTimeline(await entries.get(entry.id))).toBe(false);
  await entries.update(entry.id, { facts: [{ field: 'ability', value: '星辰之力 Lv.3', fromChapterId: ch3.id }] });
  await relations.upsert({ fromEntryId: entry.id, toEntryId: other.id, kind: '徒弟', fromChapterId: ch1.id, toChapterId: ch2.id });
  await relations.upsert({ fromEntryId: other.id, toEntryId: entry.id, kind: '师父', fromChapterId: ch1.id, toChapterId: null });
  const { screen } = await renderDetail(entry.id);
  await until(screen, value => value.includes('按章节的状态') && value.includes('星辰之力 Lv.3'));
  const text = allText(screen);
  expect(text).toContain('第 1–2 章');
  expect(text).toContain('自第 1 章');
  expect(text.indexOf('老周 是 林宇 的 师父')).toBeLessThan(text.indexOf('林宇 是 老周 的 徒弟'));
  expect(screen.root.findAll(n => n.props.testID === 'relation-ended' && typeof n.type === 'string')).toHaveLength(1);
  await press(screen, /^查看：/);
  await press(screen, '第 2 章 觉醒');
  await until(screen, value => value.includes('正在查看第 2 章时的状态 · 回到当前'));
  expect(allText(screen)).toContain('星辰之力 Lv.2');
  expect(allText(screen)).not.toContain('星辰之力 Lv.3：');
  expect(allText(screen)).toContain('（第 2 章时未填写）');
  await act(async () => screen.unmount()); db.close();
});

test('pending timeline node is a dashed dot that opens S13 on that proposal', async () => {
  const { db, work, chapters: [ch1] } = await fixture(1);
  await chapters.saveBody(ch1.id, '林宇的双眼亮起蓝色的光。', 0);
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇', facts: [{ field: 'ability', value: '尚未觉醒' }] });
  const finalized = await chapters.finalize(ch1.id);
  await db.run("UPDATE jobs SET status='done' WHERE id=?", [finalized.jobIds[1]]);
  await db.run(`INSERT INTO memory_proposals (id,work_id,chapter_id,kind,target_type,target_entry_id,target_name,field,before_value,after_value,evidence,evidence_offset,confidence,status,created_at,source_job_id)
    VALUES ('p-12',?,?,'update','character',?,'林宇','ability','尚未觉醒','蓝光觉醒','林宇的双眼亮起蓝色的光。',0,'high','pending',?,?)`, [work.id, ch1.id, entry.id, new Date().toISOString(), finalized.jobIds[1]]);
  const { screen, seen } = await renderDetail(entry.id);
  await until(screen, value => value.includes('蓝光觉醒（待审核）'));
  const node = screen.root.findAll(n => n.props.testID?.startsWith('timeline-pending') && typeof n.props.onPress === 'function')[0];
  const dot = node.findAll(n => typeof n.type === 'string' && JSON.stringify(n.props.style ?? '').includes('dashed'));
  expect(dot.length).toBeGreaterThan(0);
  await act(async () => { node.props.onPress(); });
  await until(screen, value => value.includes('审核页：p-12'));
  expect(seen.at(-1)).toMatchObject({ screen: 'Review', proposalId: 'p-12', entryId: entry.id });
  await act(async () => screen.unmount()); db.close();
});

test('S12b save stays disabled with a visible reason until target and kind are filled', async () => {
  const { db, work } = await fixture(1);
  await entries.create({ workId: work.id, type: 'character', name: '老周' });
  const entry = await entries.get((await entries.create({ workId: work.id, type: 'character', name: '林宇' })).id);
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="EntryDetail">{() => <RelationSheet visible entry={entry} relation={null} chapters={[]} onClose={() => {}} />}</Stack.Screen>
  </Stack.Navigator><OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  await until(screen, value => value.includes('保存关系'));
  const save = () => screen.root.findAll(n => n.props.accessibilityLabel === '保存关系' || (n.props.label === '保存关系'))[0];
  expect(save().props.disabled).toBe(true);
  await press(screen, '师徒');
  await until(screen, value => value.includes('请选择关联条目'));
  expect(save().props.disabled).toBe(true);
  await press(screen, '关联条目：选择条目');
  await press(screen, '人物 · 老周');
  await press(screen, '自定义…');
  await until(screen, value => value.includes('请填写 1–10 字的关系称谓') && !value.includes('请选择关联条目'));
  expect(save().props.disabled).toBe(true);
  await press(screen, '师徒');
  await until(screen, value => !value.includes('请填写 1–10 字的关系称谓'));
  expect(save().props.disabled).toBeFalsy();
  await act(async () => screen.unmount()); db.close();
});

const fakePlan = { serviceSnapshot: { id: 'svc-1', name: '测试服务', baseUrl: 'https://api.example.com/v1', model: 'm' },
  estimatedInputTokens: 10, maxOutputTokens: 100, requests: [{}], blocks: [], omittedReasons: [] } as never;

test('S12c "完成" with unhandled suggestions returns their ids for highlight; all handled reports the adopted count', async () => {
  const { db, work } = await fixture(1);
  const created = await entries.create({ workId: work.id, type: 'character', name: '林宇' });
  const spies: { mockRestore(): void }[] = [jest.spyOn(dialogs, 'ensureModelService').mockResolvedValue('ok'), jest.spyOn(completion, 'prepare').mockResolvedValue(fakePlan),
    jest.spyOn(ai, 'noticeHost').mockResolvedValue(null)];
  const ids = await entries.proposeFacts(created.id, [{ field: 'motivation', value: '想证明自己' }, { field: 'secret', value: '胎记' }], { kind: 'ai_complete', ref: null });
  spies.push(jest.spyOn(completion, 'complete').mockResolvedValue([
    { factId: ids[0], field: 'motivation', value: '想证明自己', reason: '补全动机' }, { factId: ids[1], field: 'secret', value: '胎记', reason: '补全秘密' }] as never));
  const closes: unknown[] = [];
  const entry = await entries.get(created.id);
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="EntryDetail">{({ navigation }) => <EntryCompletionSheet entry={entry} navigation={navigation} onClose={result => closes.push(result)} />}</Stack.Screen>
  </Stack.Navigator><OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  await press(screen, '预览发送范围');
  await press(screen, '生成建议');
  await until(screen, value => value.includes('AI 的建议 · 2 条'));
  await press(screen, '采纳');
  await until(screen, value => value.includes('秘密 · 已采纳'));
  await press(screen, '完成');
  expect(closes).toEqual([{ pendingIds: [ids[0]], adopted: 1 }]);
  await act(async () => screen.unmount()); spies.forEach(spy => spy.mockRestore()); db.close();
});

test('S12c invalid key shows the auth copy, 重试 / 查看详情 / 编辑服务 and keeps field choices and direction', async () => {
  const { db, work } = await fixture(1);
  const entry = await entries.get((await entries.create({ workId: work.id, type: 'character', name: '林宇' })).id);
  const info = { code: 'AI_AUTH', status: 401, message: 'API Key 无效或已失效。', providerMessage: null, requestId: 'req-1', serviceName: '测试服务', model: 'm', at: new Date().toISOString() };
  const spies: { mockRestore(): void }[] = [jest.spyOn(dialogs, 'ensureModelService').mockResolvedValue('ok'), jest.spyOn(completion, 'prepare').mockResolvedValue(fakePlan),
    jest.spyOn(ai, 'noticeHost').mockResolvedValue(null), jest.spyOn(completion, 'complete').mockRejectedValue(new AiCallError(info as never))];
  let screen!: ReactTestRenderer.ReactTestRenderer;
  const seen: Record<string, unknown>[] = [];
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="EntryDetail">{({ navigation }) => <EntryCompletionSheet entry={entry} navigation={navigation} onClose={() => {}} />}</Stack.Screen>
    <Stack.Screen name="ModelService">{({ route }) => { seen.push(route.params as never); return <Text>服务编辑页</Text>; }}</Stack.Screen>
  </Stack.Navigator><OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  await act(async () => { screen.root.findAll(n => n.props.label === '补充方向（选填）' && typeof n.props.onChangeText === 'function')[0].props.onChangeText('更阴郁一些'); });
  await press(screen, '预览发送范围');
  await press(screen, '生成建议');
  await until(screen, value => value.includes('API Key 无效或已失效。'));
  const text = allText(screen);
  expect(text).toContain('重试'); expect(text).toContain('查看详情'); expect(text).toContain('编辑服务');
  expect(text).not.toContain('重新预览');
  expect(screen.root.findAll(n => n.props.label === '补充方向（选填）')[0].props.value).toBe('更阴郁一些');
  expect(screen.root.findAll(n => n.props.label === '身份' && n.props.selected === true).length).toBeGreaterThan(0);
  await press(screen, '编辑服务');
  await until(screen, value => value.includes('服务编辑页'));
  expect(seen.at(-1)).toMatchObject({ mode: 'edit', serviceId: 'svc-1', focus: 'key' });
  await act(async () => screen.unmount()); spies.forEach(spy => spy.mockRestore()); db.close();
});

test('S12d note names the review chapter and closed intervals; conflict history uses the S14 title', async () => {
  const list = [chapterItem('c5', 5, '第 5 章'), chapterItem('c11', 11, '决裂'), chapterItem('c12', 12, '归来')];
  const base = { factId: 'f', field: 'ability', beforeFactId: null, before: null, after: 'x', sourceRef: null, evidence: null, at: new Date().toISOString(), conflictTitle: null } as const;
  expect(historyNote({ ...base, sourceKind: 'review', sourceChapterId: 'c12', fromChapterId: 'c12', toChapterId: null } as HistoryItem, list)).toBe('来自第 12 章记忆审核 · 自第 12 章起');
  expect(historyNote({ ...base, sourceKind: 'manual', sourceChapterId: null, fromChapterId: 'c5', toChapterId: 'c11' } as HistoryItem, list)).toBe('第 5–11 章');
  expect(historyNote({ ...base, sourceKind: 'manual', sourceChapterId: null, fromChapterId: null, toChapterId: null } as HistoryItem, list)).toBe('');

  const { db, work, chapters: [ch1] } = await fixture(1);
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇', facts: [{ field: 'ability', value: '尚未觉醒' }] });
  await db.run(`INSERT INTO conflicts (id,work_id,chapter_id,entry_id,type,severity,a_label,a_ref,a_quote,b_label,b_ref,b_quote,explanation,suggestions,status,fingerprint,created_at)
    VALUES ('cf',?,?,?,'character','high','正文',?,'亮起蓝光','能力',?,'尚未觉醒','能力与正文不一致','[]','open','fp',?)`, [work.id, ch1.id, entry.id, `chapter:${ch1.id}`, `entry:${entry.id}`, new Date().toISOString()]);
  await db.run("UPDATE entry_facts SET source_kind='manual', source_ref='conflict:cf' WHERE entry_id=?", [entry.id]);
  const [item] = await entries.history(entry.id);
  expect(item).toMatchObject({ sourceKind: 'conflict', conflictTitle: '人物冲突 · 林宇' });
  db.close();
});

test('S10c 手动整理 prefill reaches S12a: name, summary and a 备注 field are saved as a manual entry', async () => {
  const { db, work } = await fixture(1);
  const { EntryFormScreen } = require('../../src/screens/archive/EntryFormScreen');
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="EntryForm" component={EntryFormScreen} initialParams={{ workId: work.id, type: 'world', name: '出海', summary: '出海寻找答案', note: '走向：线索\n风险：代价\n影响：成长' }} />
    <Stack.Screen name="EntryDetail">{() => <Text>已保存</Text>}</Stack.Screen>
  </Stack.Navigator><OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  await until(screen, value => value.includes('备注'));
  expect(screen.root.findAll(n => n.props.value === '出海寻找答案').length).toBeGreaterThan(0);
  await press(screen, '保存');
  await until(screen, value => value.includes('已保存'));
  const [listed] = await entries.list(work.id);
  const detail = await entries.get(listed.id);
  expect(detail).toMatchObject({ name: '出海', type: 'world', summary: '出海寻找答案', source: { kind: 'manual' } });
  expect(detail.facts.find(f => f.field === '备注')?.value).toBe('走向：线索\n风险：代价\n影响：成长');
  await act(async () => screen.unmount()); db.close();
});
