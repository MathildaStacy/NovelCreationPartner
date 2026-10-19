import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import { freshDb } from '../helpers/db';
import { allText, press, until, wait } from '../helpers/render';
import type { Db } from '../../src/data/db';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as services from '../../src/features/modelServices';
import * as prefs from '../../src/features/prefs';
import * as ai from '../../src/features/ai';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import type { AiErrorInfo } from '../../src/features/types';
import type { WritingResult } from '../../src/ai/runtime';
import type { ContextPlan } from '../../src/ai/context';
import { WritingSheet, errorActions, type DescribeMemory } from '../../src/screens/editor/WritingSheet';

jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'test-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));

const BODY = '林宇握紧古镜，踏入沉船底舱。林宇听见水声。';
let d: Db;
let screen: ReactTestRenderer.ReactTestRenderer | undefined;
beforeEach(async () => { d = await freshDb(); useOverlay.setState({ dialogs: [], toast: null, depth: 0 }); });
afterEach(async () => { if (screen) { await act(async () => screen!.unmount()); screen = undefined; } jest.restoreAllMocks(); await d.close(); });

async function fixture() {
  const work = await works.create({ premise: '海上寻镜', title: '潮汐' });
  const volume = (await chapters.list(work.id))[0].volume;
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, title: '沉船' });
  await chapters.saveBody(chapter.id, BODY, 0);
  const hero = await entries.create({ workId: work.id, type: 'character', name: '林宇', facts: [{ field: 'identity', value: '渔村少年' }] });
  const mirror = await entries.create({ workId: work.id, type: 'world', name: '古镜', facts: [] });
  const lamp = await entries.create({ workId: work.id, type: 'character', name: '林海', facts: [] });
  const retired = await entries.create({ workId: work.id, type: 'character', name: '旧名', facts: [] });
  await entries.retire(retired.id);
  await services.save({ name: 'Fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'test-model', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'test-key');
  await ai.acknowledgeHost('example.test');
  return { work, chapter, hero, mirror, lamp };
}

async function open(props: { workId: string; chapterId: string; range?: { start: number; end: number }; op?: ai.QuickOp; memory?: DescribeMemory | null }, spies: { close?: jest.Mock; remember?: jest.Mock; editService?: jest.Mock } = {}) {
  await act(async () => {
    screen = ReactTestRenderer.create(<SafeAreaProvider><WritingSheet chapterId={props.chapterId} workId={props.workId} range={props.range ?? { start: BODY.length, end: BODY.length }}
      op={props.op} body={BODY} font={{ family: 'serif', size: 20 }} memory={props.memory} onRemember={spies.remember} onEditService={spies.editService}
      onClose={spies.close ?? (() => {})} onApplied={() => {}} /><OverlayHost level={0} /></SafeAreaProvider>);
  });
  return screen!;
}

const info = (code: string, message = '出错了'): AiErrorInfo => ({ code, status: null, message, providerMessage: null, requestId: null, serviceName: 'Fixture', model: 'test-model', at: new Date().toISOString() });
type Call = { plan: ContextPlan; options: Parameters<typeof ai.generateWriting>[1]; resolve(result: WritingResult): void };
function holdGeneration() {
  const calls: Call[] = [];
  jest.spyOn(ai, 'generateWriting').mockImplementation((plan, options) => new Promise(resolve => { calls.push({ plan, options, resolve }); }));
  const result = (plan: ContextPlan, candidates: { text: string; stop?: 'end' | 'length'; error?: AiErrorInfo | null }[]): WritingResult =>
    ({ logicalRequestId: plan.planId, planId: plan.planId, capsPatch: {}, candidates: candidates.map((item, index) => ({ index, text: item.text, stop: item.stop ?? 'end', error: item.error ?? null })) });
  return { calls, result };
}

test('S08 offers 7 types (max 2, replacing the oldest), 5 single-choice styles and auto-identified references', async () => {
  const { work, chapter } = await fixture();
  const remember = jest.fn();
  const r = await open({ workId: work.id, chapterId: chapter.id }, { remember });
  let text = await until(r, t => t.includes('参考设定（已自动识别 2 项）'));
  for (const label of ['环境氛围', '心理活动', '动作细节', '人物外貌', '对话神态', '五感细节', '过场节奏', '贴合当前文风', '细腻慢镜头', '简练干脆', '压抑紧张', '空灵写意']) expect(text).toContain(label);
  expect(text).toContain('在当前光标处续写描写');
  expect(text).toContain('前文：…林宇听见水声。');
  // 林宇 is mentioned twice, so it comes first.
  expect(text.indexOf('林宇 ×')).toBeLessThan(text.indexOf('古镜 ×'));
  await press(r, '心理活动');
  await press(r, '动作细节');
  await press(r, '压抑紧张');
  expect(remember).toHaveBeenLastCalledWith({ types: ['心理活动', '动作细节'], style: '压抑紧张', extra: '', count: 1 });
  await press(r, '移除参考 古镜');
  text = await until(r, t => t.includes('将发送：') && t.includes('1 个参考条目'));
  expect(text).not.toContain('古镜 ×');
  const { calls } = holdGeneration();
  await press(r, '生成描写');
  await until(r, t => t.includes('描写候选 · 心理活动 + 动作细节'));
  expect(calls).toHaveLength(1);
  const sent = calls[0].plan.serializedRequest;
  expect(sent).toContain('心理活动、动作细节');
  expect(sent).toContain('压抑紧张');
  expect(sent).toContain('渔村少年');
  // A single version hides the segment bar and shows the first-token wait.
  expect(allText(r)).not.toContain('版本 1 ·');
  expect(allText(r)).toMatch(/正在生成… \d+ 秒/);
});

test('remembered choices are restored on the next opening and the count does not write prefs', async () => {
  const { work, chapter } = await fixture();
  await prefs.set('candidateCount', 2);
  const r = await open({ workId: work.id, chapterId: chapter.id, memory: { types: ['五感细节'], style: '空灵写意', extra: '突出水声', count: 3 } });
  await until(r, t => t.includes('参考设定'));
  const { calls } = holdGeneration();
  await press(r, '生成描写');
  await until(r, () => calls.length === 1);
  expect(calls[0].plan.requests).toHaveLength(3);
  expect(calls[0].plan.serializedRequest).toContain('空灵写意');
  expect(calls[0].plan.serializedRequest).toContain('突出水声');
  expect(await prefs.get('candidateCount')).toBe(2);
});

test('S08a lists only valid entries, limits to 8, and "完成（N/8）" appends the new choices', async () => {
  const { work, chapter } = await fixture();
  for (let i = 0; i < 7; i++) await entries.create({ workId: work.id, type: 'world', name: `参考${i}`, facts: [] });
  const r = await open({ workId: work.id, chapterId: chapter.id });
  await until(r, t => t.includes('林宇 ×'));
  await press(r, '＋ 添加参考');
  let text = await until(r, t => t.includes('完成（2/8）') && t.includes('林海'));
  expect(text).not.toContain('旧名');
  await press(r, '林海');
  await press(r, '完成（3/8）');
  text = await until(r, t => t.includes('林海 ×') && !t.includes('完成（'));
  expect(text.indexOf('古镜 ×')).toBeLessThan(text.indexOf('林海 ×'));
  await press(r, '＋ 添加参考');
  await until(r, t => t.includes('完成（3/8）'));
  await act(async () => { r.root.findAll(n => n.props.placeholder === '搜索名称、别名、摘要' && typeof n.props.onChangeText === 'function')[0].props.onChangeText('不存在的名字'); });
  await until(r, t => t.includes('没有找到匹配的条目'), 80);
  await act(async () => { r.root.findAll(n => n.props.placeholder === '搜索名称、别名、摘要' && typeof n.props.onChangeText === 'function')[0].props.onChangeText(''); });
  await until(r, t => t.includes('参考6'));
  for (let i = 0; i < 5; i++) await press(r, `参考${i}`);
  await until(r, t => t.includes('完成（8/8）') && t.includes('最多参考 8 个条目'));
  const extra = r.root.findAll(n => n.props.accessibilityRole === 'checkbox' && n.props.accessibilityLabel === '参考5')[0];
  expect(extra.props.accessibilityState.disabled).toBe(true);
  await press(r, '参考0');
  await until(r, t => t.includes('完成（7/8）'));
  expect(r.root.findAll(n => n.props.accessibilityRole === 'checkbox' && n.props.accessibilityLabel === '参考5')[0].props.accessibilityState.disabled).toBe(false);
});

test('truncated output offers 继续生成, which resends the text as the assistant turn and appends to the same version', async () => {
  const { work, chapter } = await fixture();
  const r = await open({ workId: work.id, chapterId: chapter.id });
  await until(r, t => t.includes('将发送：'));
  const { calls, result } = holdGeneration();
  await press(r, '生成描写');
  await until(r, () => calls.length === 1);
  await act(async () => { calls[0].options.onText?.(0, '海水漫过'); });
  expect(allText(r)).toContain('生成中 · 4 字');
  expect(allText(r)).toContain('停止生成');
  await act(async () => { calls[0].resolve(result(calls[0].plan, [{ text: '海水漫过脚踝，', stop: 'length', error: info('AI_TRUNCATED') }])); });
  await until(r, t => t.includes('已达到单次最大输出长度'));
  await press(r, '继续生成');
  await until(r, t => t.includes('继续生成这一版'));
  await press(r, '发送');
  await until(r, () => calls.length === 2);
  const messages = calls[1].plan.requests[0].messages;
  expect(messages.at(-2)).toEqual({ role: 'assistant', content: '海水漫过脚踝，' });
  expect(messages.at(-1)).toEqual({ role: 'user', content: ai.CONTINUE_INSTRUCTION });
  await act(async () => { calls[1].resolve(result(calls[1].plan, [{ text: '腐木的气味涌来。' }])); });
  await until(r, t => t.includes('海水漫过脚踝，腐木的气味涌来。') && t.includes('已完成 · 15 字'));
});

test('retry waiting, per-code error actions and 调整要求 keep the S08 choices', async () => {
  const { work, chapter } = await fixture();
  const editService = jest.fn();
  const close = jest.fn();
  const r = await open({ workId: work.id, chapterId: chapter.id }, { editService, close });
  await until(r, t => t.includes('将发送：'));
  await press(r, '细腻慢镜头');
  await until(r, t => t.includes('将发送：'));
  const { calls, result } = holdGeneration();
  await press(r, '生成描写');
  await until(r, () => calls.length === 1);
  await act(async () => { calls[0].options.onRetry?.(0, 1, 2); });
  expect(allText(r)).toContain('服务繁忙，正在重试（1/2）');
  await act(async () => { calls[0].resolve(result(calls[0].plan, [{ text: '', error: info('AI_SERVER', '服务暂时不可用。') }])); });
  await until(r, t => t.includes('服务暂时不可用。') && t.includes('重试') && t.includes('查看详情'));
  await press(r, '重试');
  await until(r, () => calls.length === 2);
  expect(calls[1].plan.serializedRequest).toBe(JSON.stringify(JSON.parse(calls[0].plan.serializedRequest).slice(0, 1)));
  await act(async () => { calls[1].resolve(result(calls[1].plan, [{ text: '', error: info('AI_CONTEXT_TOO_LONG', '内容太长。') }])); });
  await until(r, t => t.includes('内容太长。'));
  expect(allText(r)).not.toMatch(/^重试$/m);
  await press(r, '调整要求');
  // Nothing finished, so no D04; back in S08 with the previous style selected.
  await until(r, t => t.includes('生成描写') && t.includes('补充要求'));
  expect(useOverlay.getState().dialogs).toHaveLength(0);
  expect(r.root.findAll(n => n.props.accessibilityLabel === '细腻慢镜头' && n.props.accessibilityState?.selected).length).toBeGreaterThan(0);
  await press(r, '生成描写');
  await until(r, () => calls.length === 3);
  expect(calls[2].plan.planId).not.toBe(calls[0].plan.planId);
  await act(async () => { calls[2].resolve(result(calls[2].plan, [{ text: '', error: info('AI_AUTH', 'API Key 无效或已失效。') }])); });
  await until(r, t => t.includes('API Key 无效或已失效。') && t.includes('编辑服务'));
  await press(r, '编辑服务');
  await wait(10);
  expect(close).toHaveBeenCalled();
  expect(editService).toHaveBeenCalledWith(calls[2].plan.serviceSnapshot.id);
});

test('closing asks D04 only when a finished candidate would be lost', async () => {
  const { work, chapter } = await fixture();
  const close = jest.fn();
  const r = await open({ workId: work.id, chapterId: chapter.id }, { close });
  await until(r, t => t.includes('将发送：'));
  const { calls, result } = holdGeneration();
  await press(r, '生成描写');
  await until(r, () => calls.length === 1);
  await act(async () => { calls[0].resolve(result(calls[0].plan, [{ text: '幽暗的海水漫过脚踝。' }])); });
  await until(r, t => t.includes('已完成 · '));
  await press(r, '关闭');
  await until(r, t => t.includes('放弃这些候选？'));
  expect(close).not.toHaveBeenCalled();
});

test('quick edit shows the send scope first, then a titled candidate; "打开描写助手" switches to rewrite-selection mode', async () => {
  const { work, chapter } = await fixture();
  const r = await open({ workId: work.id, chapterId: chapter.id, range: { start: 0, end: 6 }, op: 'expand' });
  const text = await until(r, t => t.includes('选区扩写') && t.includes('将发送：'));
  expect(text).toContain('按要求扩写所选 6 字');
  await press(r, '打开描写助手');
  await until(r, t => t.includes('描写助手') && t.includes('按要求重写所选 6 字') && t.includes('生成描写'));
});

test('error codes map to the G03 §8 actions', () => {
  expect(errorActions('AI_NETWORK')).toEqual(['retry']);
  expect(errorActions('AI_TIMEOUT')).toEqual(['retry']);
  expect(errorActions('AI_AUTH')).toEqual(['service']);
  expect(errorActions('AI_PROTOCOL_MISMATCH')).toEqual(['service']);
  expect(errorActions('AI_REFUSAL')).toEqual(['adjust']);
  expect(errorActions('AI_QUOTA')).toEqual([]);
});
