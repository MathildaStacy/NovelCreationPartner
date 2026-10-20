import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WorkContext } from '../../src/app/navigation/WorkContext';
import { PartnerScreen } from '../../src/screens/partner/PartnerScreen';
import { PartnerActionSheet } from '../../src/screens/partner/PartnerActionSheet';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import * as works from '../../src/features/works';
import * as conversations from '../../src/features/conversations';
import * as services from '../../src/features/modelServices';
import * as prefs from '../../src/features/prefs';
import * as runtime from '../../src/ai/runtime';
import { COMPARE_DIMENSIONS } from '../../src/ai/tasks/partner';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { freshDb } from '../helpers/db';
import { allText, press, pressable, until } from '../helpers/render';

jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'fixture-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));
afterEach(() => jest.restoreAllMocks());
const structured = { known: [], questions: [], options: ['出海', '留守'].map(title => ({ title, summary: `${title}寻找答案`, direction: '线索', risks: '代价', impact: '成长', state: 'open', entryIds: [], factIds: [] })) };
const raw = JSON.stringify({ columns: [0, 1].map(optionIndex => ({ optionIndex, cells: Object.fromEntries(COMPARE_DIMENSIONS.map(key => [key, `${optionIndex === 0 ? '出海' : '留守'}的比较结论`])), fit: 'medium' })) });
function result(options: Parameters<typeof runtime.executeTaskPlan>[0]) {
  return { logicalRequestId: options.logicalRequestId, planId: options.plan.planId, candidates: [{ index: 0, text: raw, stop: 'end' as const, error: null }], capsPatch: {} };
}
async function fixture() {
  const db = await freshDb();
  const work = await works.create({ title: '归潮', premise: '海边的古镜' });
  const conversation = await conversations.create(work.id);
  await db.run("INSERT INTO messages(id,conversation_id,role,content,status,structured,created_at) VALUES ('compare-source',?,'assistant','两种方向','done',?,?)", [conversation.id, JSON.stringify(structured), new Date().toISOString()]);
  const service = await services.save({ name: '本次对比服务', protocol: 'openai_responses', baseUrl: 'https://compare.example.test/v1', model: 'compare-fixture', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'fixture-key');
  await prefs.set('aiNoticeAcknowledged', { 'compare.example.test': new Date().toISOString() });
  useOverlay.setState({ dialogs: [], toast: null, depth: 0 });
  const Stack = createNativeStackNavigator();
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><WorkContext.Provider value={work.id}><NavigationContainer>
    <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Partner" component={PartnerScreen as never} /></Stack.Navigator>
    <OverlayHost level={0} /></NavigationContainer></WorkContext.Provider></SafeAreaProvider>); });
  await until(screen, text => text.includes('对比方案'));
  return { db, work, service, screen };
}

test('reopening unchanged comparisons reuses this page result; explicit regeneration previews before another execution', async () => {
  const run = jest.spyOn(runtime, 'executeTaskPlan').mockImplementation(async options => result(options));
  const { db, screen } = await fixture();
  await press(screen, '对比方案');
  await until(screen, text => text.includes('生成对比'));
  expect(run).not.toHaveBeenCalled();
  await press(screen, '生成对比');
  await until(screen, text => text.includes('出海的比较结论'));
  expect(run).toHaveBeenCalledTimes(1);
  await press(screen, '关闭');
  await press(screen, '对比方案');
  await until(screen, text => text.includes('已复用本页结果'));
  expect(run).toHaveBeenCalledTimes(1);
  await press(screen, '重新预览生成对比');
  await until(screen, text => text.includes('生成对比') && !text.includes('已复用本页结果'));
  expect(allText(screen)).not.toContain('出海的比较结论');
  expect(run).toHaveBeenCalledTimes(1);
  await press(screen, '生成对比');
  await until(screen, text => text.includes('出海的比较结论'));
  expect(run).toHaveBeenCalledTimes(2);
  await act(async () => screen.unmount()); db.close();
});

test('changed work dependencies require a new explicit comparison preview', async () => {
  const run = jest.spyOn(runtime, 'executeTaskPlan').mockImplementation(async options => result(options));
  const { db, work, screen } = await fixture();
  await press(screen, '对比方案');
  await until(screen, text => text.includes('生成对比'));
  await press(screen, '生成对比');
  await until(screen, text => text.includes('出海的比较结论'));
  await act(async () => { await works.update(work.id, { premise: '作者修改了古镜的约束' }); });
  await until(screen, text => text.includes('生成对比'));
  expect(allText(screen)).not.toContain('出海的比较结论');
  expect(allText(screen)).toContain('作者修改了古镜的约束');
  expect(run).toHaveBeenCalledTimes(1);
  await press(screen, '生成对比');
  await until(screen, text => text.includes('出海的比较结论'));
  expect(run).toHaveBeenCalledTimes(2);
  await act(async () => screen.unmount()); db.close();
});

test('service binding changed during generation rejects the late result and leaves no reusable table', async () => {
  let complete!: () => void;
  const run = jest.spyOn(runtime, 'executeTaskPlan').mockImplementation(options => new Promise(resolve => { complete = () => resolve(result(options)); }));
  const { db, screen } = await fixture();
  const second = await services.save({ name: '另一对比服务', protocol: 'openai_responses', baseUrl: 'https://other.example.test/v1', model: 'other-fixture', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'fixture-key');
  await press(screen, '对比方案');
  await until(screen, text => text.includes('生成对比'));
  await press(screen, '生成对比');
  expect(run).toHaveBeenCalledTimes(1);
  await act(async () => { await prefs.set('serviceBindings', { writing: null, utility: second.service.id, review: null }); complete(); });
  await until(screen, text => text.includes('对比依据已变化，请重新预览。'));
  expect(allText(screen)).not.toContain('出海的比较结论');
  await press(screen, '关闭');
  await press(screen, '对比方案');
  await until(screen, text => text.includes('另一对比服务') && text.includes('生成对比'));
  expect(allText(screen)).not.toContain('已复用本页结果');
  expect(run).toHaveBeenCalledTimes(1);
  await act(async () => screen.unmount()); db.close();
});

test('adoption returns to the existing comparison and updates only the selected direction state', async () => {
  const run = jest.spyOn(runtime, 'executeTaskPlan').mockImplementation(async options => options.plan.task === 'splitForAdoption'
    ? { ...result(options), candidates: [{ index: 0, text: JSON.stringify({ items: [{ type: 'world', name: '潮汐密约', summary: '约定', facts: [{ field: 'content', value: '在满月时出航' }] }] }), stop: 'end', error: null }] }
    : result(options));
  const { db, screen } = await fixture();
  await press(screen, '对比方案');
  await until(screen, text => text.includes('生成对比'));
  await press(screen, '生成对比');
  await until(screen, text => text.includes('出海的比较结论'));
  await press(screen, '采纳为设定');
  await until(screen, text => text.includes('整理为档案建议'));
  await press(screen, '整理为档案建议');
  await until(screen, text => text.includes('写入档案（1 项）'));
  await press(screen, '写入档案（1 项）');
  await until(screen, text => text.includes('出海的比较结论') && text.includes('已采纳为设定'));
  expect(allText(screen)).toContain('留守的比较结论');
  expect(run).toHaveBeenCalledTimes(2);
  expect((await conversations.message('compare-source')).structured?.options.map(option => option.state)).toEqual(['open', 'adopted']);
  await press(screen, '撤销');
  await until(screen, text => !text.includes('已采纳为设定'));
  expect(allText(screen)).toContain('出海的比较结论');
  expect(run).toHaveBeenCalledTimes(2);
  await act(async () => screen.unmount()); db.close();
});

test('S10d while generating shows direction titles with skeleton cells; closing aborts; a failure keeps headers, 重试 and 采纳 / 暂存', async () => {
  let signal!: AbortSignal;
  const run = jest.spyOn(runtime, 'executeTaskPlan').mockImplementation(options => new Promise((_, reject) => { signal = options.signal; options.signal.addEventListener('abort', () => reject(new Error('aborted'))); }));
  const { db, screen } = await fixture();
  await press(screen, '对比方案');
  await until(screen, text => text.includes('生成对比'));
  await press(screen, '生成对比');
  await until(screen, text => text.includes('正在对比 2 个方向…') && text.includes('出海') && text.includes('留守'));
  expect(screen.root.findAll(node => node.props.testID === 'compare-skeleton' && typeof node.type === 'string').length).toBe(12);
  expect(allText(screen)).toContain('采纳为设定');
  await press(screen, '关闭');
  expect(signal.aborted).toBe(true);
  const info = { code: 'AI_NETWORK', message: '连不上 compare.example.test，请检查地址或网络。', status: null, providerMessage: null, requestId: null, serviceName: 'F', model: 'm', at: new Date().toISOString() };
  run.mockImplementation(async options => ({ logicalRequestId: options.logicalRequestId, planId: options.plan.planId, candidates: [{ index: 0, text: '', stop: 'end' as const, error: info }], capsPatch: {} }));
  await press(screen, '对比方案');
  await until(screen, text => text.includes('生成对比'));
  await press(screen, '生成对比');
  await until(screen, text => text.includes('连不上 compare.example.test'));
  const text = allText(screen);
  expect(text).toContain('重试'); expect(text).toContain('出海'); expect(text).toContain('留守');
  expect(text).toContain('采纳为设定'); expect(text).toContain('暂存');
  expect(pressable(screen, '重试')).toBeTruthy();
  await act(async () => screen.unmount()); db.close();
});

test('S10c split failure offers 重试 and 手动整理 prefilled from the direction', async () => {
  const info = { code: 'AI_NETWORK', message: '连不上 compare.example.test，请检查地址或网络。', status: null, providerMessage: null, requestId: null, serviceName: 'F', model: 'm', at: new Date().toISOString() };
  jest.spyOn(runtime, 'executeTaskPlan').mockImplementation(async options => ({ logicalRequestId: options.logicalRequestId, planId: options.plan.planId, candidates: [{ index: 0, text: '', stop: 'end' as const, error: info }], capsPatch: {} }));
  const db = await freshDb();
  const work = await works.create({ title: '归潮', premise: '海边的古镜' });
  const conversation = await conversations.create(work.id);
  await db.run("INSERT INTO messages(id,conversation_id,role,content,status,structured,created_at) VALUES ('m',?,'assistant','两种方向','done',?,?)", [conversation.id, JSON.stringify(structured), new Date().toISOString()]);
  await services.save({ name: '服务', protocol: 'openai_responses', baseUrl: 'https://compare.example.test/v1', model: 'm', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'fixture-key');
  await prefs.set('aiNoticeAcknowledged', { 'compare.example.test': new Date().toISOString() });
  useOverlay.setState({ dialogs: [], toast: null, depth: 0 });
  const manual = jest.fn();
  const message = await conversations.message('m');
  let screen!: ReactTestRenderer.ReactTestRenderer;
  const Stack = createNativeStackNavigator();
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Partner">{() => <PartnerActionSheet action={{ kind: 'adopt', message, index: 0 }} workId={work.id} comparisonCache={new Map()} onClose={() => {}} onOpenEntry={() => {}} onManual={manual} onAction={() => {}} />}</Stack.Screen>
  </Stack.Navigator><OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  await until(screen, text => text.includes('整理为档案建议'));
  await press(screen, '整理为档案建议');
  await until(screen, text => text.includes('连不上 compare.example.test') && text.includes('重试') && text.includes('手动整理'));
  await press(screen, '手动整理');
  expect(manual).toHaveBeenCalledWith('world', '出海', { summary: '出海寻找答案', note: '走向：线索\n风险：代价\n影响：成长' });
  await act(async () => screen.unmount()); db.close();
});
