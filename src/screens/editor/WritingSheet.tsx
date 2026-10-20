import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { shouldCaptureSwipe } from '../../components/SwipeRow';
import { SkeletonLines } from '../../components/Skeleton';
import { Txt } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { toast } from '../../components/overlay/store';
import { confirmAiData, confirmDiscard, ensureModelService, type ConnectNavigation } from '../../app/dialogs';
import { showAiErrorDetail, showError } from '../../app/errors';
import { isAppError } from '../../features/errors';
import * as ai from '../../features/ai';
import * as entries from '../../features/entries';
import * as prefs from '../../features/prefs';
import type { AiErrorInfo } from '../../features/types';
import type { ContextPlan } from '../../ai/context';
import { color as c, radius } from '../../theme/tokens';
import { countChars } from '../../utils/text';
import { ReferencePicker } from './ReferencePicker';

/** S08 #3 / #4 preset names. */
export const DESCRIBE_TYPES = ['环境氛围', '心理活动', '动作细节', '人物外貌', '对话神态', '五感细节', '过场节奏'];
export const DESCRIBE_STYLES = ['贴合当前文风', '细腻慢镜头', '简练干脆', '压抑紧张', '空灵写意'];
const OPS: Record<ai.QuickOp, string> = { rewrite: '改写', expand: '扩写', shorten: '缩写', polish: '润色', detail: '补细节' };
const MAX_VERSIONS = 5;
const MAX_REFS = 8;
export const VALID_REF_STATES: string[] = ['CONFIRMED', 'ESTABLISHED', 'CONFLICTED'];

/** Remembered while the editor stays open (S08 §5 第 4 条); references are re-identified per opening. */
export interface DescribeMemory { types: string[]; style: string; extra: string; count: 1 | 2 | 3 }
export interface ReferenceChip { id: string; name: string }

type Status = 'idle' | 'queued' | 'waiting' | 'retrying' | 'streaming' | 'done' | 'empty' | 'stopped' | 'truncated' | 'interrupted' | 'failed';
interface Candidate {
  key: number; text: string; status: Status; retry?: number;
  /** Immutable plan that produced this text; index is the request inside it. */
  plan: ContextPlan; index: number;
  controller: AbortController; run: number; startedAt: number; error?: AiErrorInfo | null;
}
type Stage = 'form' | 'confirm' | 'candidates';
type PendingSend = { kind: 'more' | 'continue'; plan: ContextPlan; target?: number; prefix?: string };

const generating = (s: Status) => s === 'queued' || s === 'waiting' || s === 'retrying' || s === 'streaming';
/** No service or no Key: S09 opens D03 itself instead of a failed block (S09 §3 需要连接模型). */
const missingService = (error: unknown) => isAppError(error, 'NO_SERVICE') || isAppError(error, 'KEY_UNAVAILABLE');
/** Card swipe (S09 #3/#4): a clear horizontal drag or fling moves one version, clamped at both ends. */
export function pageAfterSwipe(index: number, count: number, dx: number, vx: number): number {
  const step = dx <= -48 || vx <= -0.5 ? 1 : dx >= 48 || vx >= 0.5 ? -1 : 0;
  return Math.max(0, Math.min(count - 1, index + step));
}
const adoptable = (item?: Candidate) => !!item?.text && !generating(item.status) && item.status !== 'failed';
/** Kept text worth a D04 before discarding (S09 #2). Generating or failed versions never ask. */
const losable = (item: Candidate) => !!item.text && ['done', 'stopped', 'truncated', 'interrupted'].includes(item.status);
type ErrorAction = 'retry' | 'adjust' | 'service';
export function errorActions(code: string): ErrorAction[] {
  if (['AI_AUTH', 'AI_PERMISSION', 'AI_NOT_FOUND', 'AI_PROTOCOL_MISMATCH', 'NO_SERVICE', 'KEY_UNAVAILABLE'].includes(code)) return ['service'];
  if (['AI_CONTEXT_TOO_LONG', 'AI_REFUSAL', 'AI_RESULT_STALE', 'VALIDATION'].includes(code)) return ['adjust'];
  if (code === 'AI_QUOTA') return [];
  return ['retry'];
}
function segmentLabel(item: Candidate): string {
  switch (item.status) {
    case 'idle': return '未开始';
    case 'queued': return '排队中';
    case 'failed': return '失败';
    case 'stopped': return '已停止';
    case 'truncated': return '已截断';
    case 'done': case 'interrupted': return `${countChars(item.text)}字`;
    case 'empty': return '没有内容';
    default: return '生成中…';
  }
}
function statusLine(item: Candidate): string {
  const n = countChars(item.text);
  switch (item.status) {
    case 'retrying': return `服务繁忙，正在重试（${item.retry ?? 1}/2）`;
    case 'queued': return '排队中，前面的请求完成后开始';
    case 'waiting': case 'streaming': return `生成中 · ${n} 字`;
    case 'done': return `已完成 · ${n} 字`;
    case 'stopped': return n ? `已停止 · ${n} 字` : '已停止，没有生成内容';
    case 'truncated': return '已达到单次最大输出长度';
    case 'interrupted': return '生成中断，已保留前面的内容';
    case 'empty': return '没有生成内容';
    case 'idle': return '未开始';
    default: return '';
  }
}
/** "前文：…{光标前一句}" (S08 #2). */
function previousSentence(body: string, at: number): string {
  const sentences = body.slice(0, at).trimEnd().match(/[^。！？!?\n]+[。！？!?”"」]*/g) ?? [];
  const last = sentences[sentences.length - 1]?.trim() ?? '';
  return last.length > 40 ? `…${last.slice(-40)}` : last ? `…${last}` : '';
}
const toInfo = (error: unknown, plan: ContextPlan): AiErrorInfo => {
  const e = error as { code?: string; message?: string };
  return { code: e.code ?? 'AI_NETWORK', status: null, message: e.message ?? '生成没有完成。', providerMessage: null, requestId: null,
    serviceName: plan.serviceSnapshot.name, model: plan.serviceSnapshot.model, at: new Date().toISOString() };
};

/**
 * S08 描写助手 + S08a 参考条目 + S09 候选, in one sheet so "调整要求" keeps every choice.
 * Preview and send share the exact immutable plan (G04); no model request starts from an effect.
 */
export function WritingSheet({ chapterId, workId, range, op: initialOp, body, font, memory, onRemember, onEditService, connect, onClose, onApplied }: {
  chapterId: string; workId: string; range: { start: number; end: number }; op?: ai.QuickOp;
  /** Chapter text at opening (scope card only; the plan reads the stored body). */
  body: string;
  font: { family?: string; size: number };
  memory?: DescribeMemory | null;
  onRemember?(memory: DescribeMemory): void;
  onEditService?(serviceId: string | null): void;
  /** D03 连接模型 / 填写 Key opens S02 here after the sheet closes. */
  connect?: ConnectNavigation;
  onClose(): void; onApplied(result: { body: string; cursor: number }): void;
}) {
  const [op, setOp] = useState(initialOp);
  const [stage, setStage] = useState<Stage>(initialOp ? 'confirm' : 'form');
  const [types, setTypes] = useState(memory?.types ?? [DESCRIBE_TYPES[0]]);
  const [style, setStyle] = useState(memory?.style ?? DESCRIBE_STYLES[0]);
  const [extra, setExtra] = useState(memory?.extra ?? '');
  const [count, setCount] = useState<1 | 2 | 3>(memory?.count ?? 1);
  const [refs, setRefs] = useState<ReferenceChip[]>([]);
  const [autoCount, setAutoCount] = useState(0);
  const [identifying, setIdentifying] = useState(true);
  const [hasEntries, setHasEntries] = useState(true);
  const [picker, setPicker] = useState(false);
  const [plan, setPlan] = useState<{ key: string; plan?: ContextPlan; error?: string }>();
  const [expanded, setExpanded] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState<PendingSend>();
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [, setTick] = useState(0);
  const alive = useRef(true);
  const runs = useRef(0);
  const keys = useRef(0);
  const operations = useRef(new Set<AbortController>());
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;
  const preparing = useRef<{ key: string; promise: Promise<ContextPlan> }>(undefined);
  const describe = !op;
  const selectionChars = countChars(body.slice(range.start, range.end));
  const current = candidates[index];
  const paramsKey = JSON.stringify([op ?? null, types, style, extra.trim(), refs.map(r => r.id), count]);

  useEffect(() => () => { alive.current = false; abortAll(); }, []);
  useEffect(() => {
    // Identify references once per opening; S09 → "调整要求" keeps the state instead (S08 §3).
    Promise.all([memory || initialOp ? Promise.resolve(null) : prefs.get('candidateCount'), ai.suggestReferences(chapterId, range).catch(() => []),
      entries.list(workId).then(list => list.filter(item => VALID_REF_STATES.includes(item.state))).catch(() => null)])
      .then(([n, mentions, all]) => {
        if (!alive.current) return;
        if (n) setCount(n);
        const top = [...mentions].sort((a, b) => b.count - a.count).slice(0, 5).map(m => ({ id: m.entryId, name: m.name }));
        setRefs(top); setAutoCount(top.length); setHasEntries(all === null || all.length > 0);
      })
      .finally(() => { if (alive.current) setIdentifying(false); });
    if (initialOp) prefs.get('candidateCount').then(n => { if (alive.current) setCount(n); }).catch(() => {});
    // The range is fixed for the lifetime of this sheet.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (describe) onRemember?.({ types, style, extra, count }); }, [describe, types, style, extra, count]); // eslint-disable-line react-hooks/exhaustive-deps
  // First-token timers ("正在生成… N 秒").
  const waiting = candidates.some(item => (item.status === 'waiting' || item.status === 'retrying') && !item.text);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const action = (n: 1 | 2 | 3, offset = 0): ai.WritingAction => ({ chapterId, range, task: op ? 'quickEdit' : 'describe', op,
    types, style, extra: extra.trim() || undefined, referenceIds: refs.map(r => r.id), count: n, variantOffset: offset });
  const prepareCurrent = useCallback((): Promise<ContextPlan> => {
    if (preparing.current?.key === paramsKey) return preparing.current.promise;
    const key = paramsKey;
    const promise = ai.prepareWriting(action(count));
    preparing.current = { key, promise };
    promise.then(next => { if (alive.current && preparing.current?.key === key) setPlan({ key, plan: next }); },
      error => { if (alive.current && preparing.current?.key === key) { setPlan({ key, error: isAppError(error) ? error.message : '没有生成发送预览。' }); preparing.current = undefined; } });
    return promise;
  }, [paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Local-only preview for #10; debounced so typing 补充要求 does not rebuild on every key.
  useEffect(() => {
    if (stage === 'candidates' || identifying) return;
    const timer = setTimeout(() => { prepareCurrent().catch(() => {}); }, 300);
    return () => clearTimeout(timer);
  }, [stage, identifying, prepareCurrent]);
  const shownPlan = plan?.key === paramsKey ? plan : undefined;

  function abortAll() {
    operations.current.forEach(controller => controller.abort()); operations.current.clear();
    candidatesRef.current.forEach(item => item.controller.abort());
  }
  const patch = (key: number, run: number, update: (item: Candidate) => Partial<Candidate>) =>
    setCandidates(old => old.map(item => item.key === key && item.run === run ? { ...item, ...update(item) } : item));

  /** Sends one immutable plan; request i fills `slots[i]` (new versions, a retry, or a continuation with `prefix`). */
  const launch = async (sendPlan: ContextPlan, target?: { key: number; prefix: string }) => {
    const run = ++runs.current;
    const now = Date.now();
    const slots: Candidate[] = sendPlan.requests.map((_, i) => ({ key: target?.key ?? ++keys.current, text: target?.prefix ?? '', status: 'waiting',
      plan: sendPlan, index: i, controller: new AbortController(), run, startedAt: now, error: null }));
    if (!target) setIndex(candidatesRef.current.length);
    setCandidates(old => target ? old.map(item => item.key === target.key ? slots[0] : item) : [...old, ...slots]);
    setStage('candidates'); setPending(undefined);
    const prefix = target?.prefix ?? '';
    const operation = new AbortController();
    operations.current.add(operation);
    // Stopping every version of a still queued plan withdraws it before anything is sent.
    let queued = false;
    const withdraw = () => { if (queued && slots.every(slot => slot.controller.signal.aborted)) operation.abort(); };
    slots.forEach(slot => slot.controller.signal.addEventListener('abort', withdraw, { once: true }));
    try {
      const host = await ai.noticeHost(sendPlan);
      if (host) {
        if (!await confirmAiData(host)) { slots.forEach(slot => patch(slot.key, run, () => ({ status: target ? 'interrupted' : 'idle' }))); return; }
        await ai.acknowledgeHost(host).catch(() => {});
      }
      if (!alive.current || operation.signal.aborted) return;
      const result = await ai.generateWriting(sendPlan, { signal: operation.signal, confirmedHost: host ?? undefined,
        candidateSignals: slots.map(slot => slot.controller.signal),
        onText: (i, delta) => { if (alive.current && slots[i]) patch(slots[i].key, run, item => ({ text: item.text + delta, status: item.status === 'stopped' ? 'stopped' : 'streaming', retry: undefined })); },
        onRetry: (i, retry) => { if (alive.current && slots[i]) patch(slots[i].key, run, item => item.status === 'stopped' ? {} : { status: 'retrying', retry }); },
        onQueued: () => { queued = true; if (alive.current) slots.forEach(slot => patch(slot.key, run, item => item.status === 'waiting' ? { status: 'queued' } : {})); },
        onStarted: () => { queued = false; const at = Date.now(); if (alive.current) slots.forEach(slot => patch(slot.key, run, item => item.status === 'queued' ? { status: 'waiting', startedAt: at } : {})); } });
      if (!alive.current) return;
      result.candidates.forEach((out, i) => {
        const slot = slots[i];
        if (!slot) return;
        const text = out.text ? prefix + out.text : prefix;
        const code = out.error?.code;
        const status: Status = code === 'AI_CANCELLED' ? 'stopped' : out.stop === 'length' ? 'truncated'
          : out.error ? text ? 'interrupted' : 'failed' : text ? 'done' : 'empty';
        patch(slot.key, run, () => ({ text, status, error: status === 'failed' ? out.error : null, retry: undefined }));
      });
    } catch (error) {
      if (!alive.current) return;
      if (isAppError(error, 'AI_CANCELLED')) { slots.forEach(slot => patch(slot.key, run, () => ({ status: 'stopped', retry: undefined }))); return; }
      if (missingService(error)) {
        // Nothing was sent: versions show 未开始 · 重试, and D03 opens; cancelling sends nothing.
        slots.forEach(slot => patch(slot.key, run, item => ({ status: item.text ? 'interrupted' : 'idle', retry: undefined })));
        await serviceReady();
        return;
      }
      const info = toInfo(error, sendPlan);
      slots.forEach(slot => patch(slot.key, run, item => ({ status: item.text ? 'interrupted' : 'failed', error: item.text ? null : info })));
      if (!isAppError(error)) await showError(error);
    } finally {
      operations.current.delete(operation);
      slots.forEach(slot => slot.controller.signal.removeEventListener('abort', withdraw));
    }
  };

  /** S09 内服务消失：直接打开 D03。取消不发送；选择连接时先按 #2 规则关闭本弹窗再进 S02，返回后不自动续发（D03 §3）。 */
  const serviceReady = async (): Promise<boolean> => {
    const result = await ensureModelService(() => alive.current, connect, 'writing', async () => {
      if (!await discard()) return false;
      onClose();
      return true;
    });
    return result === 'ok';
  };
  const failed = async (error: unknown) => {
    if (!alive.current) return;
    if (missingService(error)) await serviceReady(); else await showError(error);
  };

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!await serviceReady()) return;
      const next = await prepareCurrent(); if (alive.current) await launch(next);
    } catch (error) { await failed(error); }
    finally { if (alive.current) setBusy(false); }
  };
  const prepareMore = async () => {
    if (busy || candidates.length >= MAX_VERSIONS) return;
    setBusy(true);
    try {
      if (!await serviceReady()) return;
      const next = await ai.prepareWriting(action(1, candidates.length)); if (alive.current) setPending({ kind: 'more', plan: next });
    } catch (error) { await failed(error); }
    finally { if (alive.current) setBusy(false); }
  };
  const prepareContinue = async (item: Candidate) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!await serviceReady()) return;
      const next = await ai.prepareContinuation(item.plan, item.index, item.text); if (alive.current) setPending({ kind: 'continue', plan: next, target: item.key, prefix: item.text });
    } catch (error) { await failed(error); }
    finally { if (alive.current) setBusy(false); }
  };
  const retry = async (item: Candidate) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!await serviceReady()) return;
      const next = await ai.prepareRetry(item.plan, item.index); if (alive.current) await launch(next, { key: item.key, prefix: '' });
    } catch (error) { await failed(error); }
    finally { if (alive.current) setBusy(false); }
  };
  const stop = (item: Candidate) => { item.controller.abort(); patch(item.key, item.run, () => ({ status: 'stopped', retry: undefined })); };

  /** Abort and drop candidates; ask D04 only when finished text would be lost. */
  const discard = async (): Promise<boolean> => {
    if (applying) return false;
    if (candidatesRef.current.some(losable) && !await confirmDiscard({ title: '放弃这些候选？', body: '候选不会保存，关闭后无法找回。', discard: '放弃候选' })) return false;
    runs.current++; abortAll(); return true;
  };
  const close = async () => { if (await discard()) onClose(); };
  const adjust = async () => {
    if (!await discard()) return;
    // A sent plan owns a consumed logical request ID. Keep the form choices,
    // but prepare a fresh operation even when the author changes no parameter.
    preparing.current = undefined;
    setPlan(undefined);
    setCandidates([]); setIndex(0); setPending(undefined); setExpanded(false);
    if (op) { setOp(undefined); setStage('form'); return; } // 打开描写助手: "改写所选" mode on the same selection.
    setStage('form');
  };
  const editService = async () => {
    const serviceId = current?.plan.serviceSnapshot.id ?? null;
    if (await discard()) { onClose(); onEditService?.(serviceId); }
  };
  const apply = async () => {
    if (!adoptable(current) || applying) return;
    setApplying(true);
    try {
      runs.current++; abortAll();
      const result = await ai.applyWriting(current.plan, current.text);
      onApplied(result); onClose();
    } catch (error) { await showError(error); }
    finally { if (alive.current) setApplying(false); }
  };

  const toggleType = (label: string) => setTypes(old => old.includes(label)
    ? old.length > 1 ? old.filter(x => x !== label) : old
    : old.length < 2 ? [...old, label] : [old[1], label]);
  const title = stage === 'candidates' || stage === 'confirm'
    ? op ? `选区${OPS[op]}` : `描写候选 · ${types.join(' + ')}` : '描写助手';
  const scopeLine = op || range.start !== range.end ? `按要求${op ? OPS[op] : '重写'}所选 ${selectionChars} 字`
    : body.trim() ? '在当前光标处续写描写' : '本章还没有正文，将根据作品信息和参考设定写一段描写';
  const scopeQuote = range.start !== range.end ? body.slice(range.start, range.end).split('\n').find(line => line.trim()) ?? '' : previousSentence(body, range.start);
  const contextChars = Math.min(1500, range.start) + Math.min(1500, Math.max(0, body.length - range.end)) + selectionChars;

  const summary = (target: { plan?: ContextPlan; error?: string } | undefined, versions: number) => {
    if (target?.error) return <Txt variant="caption" color={c.conf}>{target.error}</Txt>;
    if (!target?.plan) return <Txt variant="caption" color={c.ink3}>正在估算发送内容…</Txt>;
    const p = target.plan;
    const refCount = new Set(p.blocks.filter(block => (block.priority ?? 4) === 4).map(block => block.sourceId)).size;
    return <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(v => !v)} style={styles.summary}>
      <Txt variant="caption" color={c.ink2}>{`将发送：${range.start === range.end ? '光标' : '所选文字及'}前后约 ${contextChars.toLocaleString('zh-CN')} 字、${refCount} 个参考条目、作品信息 · 约 ${p.estimatedInputTokens.toLocaleString('zh-CN')} token${versions > 1 ? ` × ${versions} 版` : ''} ${expanded ? '▴' : '▾'}`}</Txt>
      {expanded ? <View style={styles.preview}>
        <Txt variant="caption">{`${p.serviceSnapshot.name} · ${new URL(p.serviceSnapshot.baseUrl).host} · ${p.serviceSnapshot.model}`}</Txt>
        <Txt variant="caption">{`每次输出上限 ${p.maxOutputTokens} token；含重试最多 ${p.requests.length + 2} 次请求；费用未知。估算包含协议开销，实际用量以服务返回为准。`}</Txt>
        {p.blocks.map((block, i) => <Txt key={`${block.sourceId}-${i}`} variant="caption" color={c.ink2}>{`${block.required ? '必需参考' : '相关参考'} · ${block.state} · ${block.text.split('\n')[0]}`}</Txt>)}
        {p.omittedReasons.map((reason, i) => <Txt key={`o${i}`} variant="caption" color={c.ink3}>{`已省略 ${reason.sourceId}：${reason.reason === 'optional_budget' ? '可选参考超过预算' : '不在所选范围'}`}</Txt>)}
        <Txt selectable variant="caption" color={c.ink3}>{p.requests[0].messages.map(message => message.content).join('\n\n')}</Txt>
      </View> : null}
    </Pressable>;
  };
  const scopeCard = <View style={styles.scope}><Txt weight="600">{scopeLine}</Txt>{scopeQuote ? <Txt variant="caption" color={c.ink3} numberOfLines={1}>{range.start === range.end ? `前文：${scopeQuote}` : scopeQuote}</Txt> : null}</View>;

  const form = <>
    {scopeCard}
    <Txt variant="callout">描写类型（最多选 2 项）</Txt>
    <View style={styles.row}>{DESCRIBE_TYPES.map(label => <Chip key={label} label={label} selected={types.includes(label)}
      accessibilityLabel={types.includes(label) && types.length === 1 ? `${label}，至少保留 1 项` : label} onPress={() => toggleType(label)} />)}</View>
    <Txt variant="callout">风格与基调</Txt>
    <View style={styles.row} accessibilityRole="radiogroup">{DESCRIBE_STYLES.map(label => <Chip key={label} label={label} selected={style === label} onPress={() => setStyle(label)} />)}</View>
    <TextField label="补充要求（可选）" placeholder="例如：突出雨水冰冷、节奏加快…" value={extra} onChangeText={setExtra} max={200} counter="always" multiline
      onOverflow={() => toast('最多 200 字')} />
    <View style={styles.between}><Txt variant="callout">{`参考设定${autoCount ? `（已自动识别 ${autoCount} 项）` : ''}`}</Txt>
      <Button label="＋ 添加参考" size="small" variant="text" disabled={identifying || !hasEntries || refs.length >= MAX_REFS} onPress={() => setPicker(true)} /></View>
    {identifying ? <View style={styles.row}><View style={styles.ghostChip} /><View style={styles.ghostChip} /></View>
      : refs.length ? <View style={styles.row}>{refs.map(ref => <Chip key={ref.id} label={`${ref.name} ×`} accessibilityLabel={`移除参考 ${ref.name}`}
        onPress={() => setRefs(old => old.filter(item => item.id !== ref.id))} />)}</View>
      : <Txt variant="caption" color={c.ink3}>{hasEntries ? '没有识别到相关设定，可以手动添加' : '档案里还没有条目'}</Txt>}
    <Txt variant="callout">生成版本数</Txt>
    <Segmented segments={([1, 2, 3] as const).map(n => ({ key: String(n) as '1' | '2' | '3', label: String(n) }))} value={String(count) as '1' | '2' | '3'}
      onChange={k => setCount(Number(k) as 1 | 2 | 3)} />
    <Txt variant="caption" color={c.ink3}>版本越多，等待越久、消耗的额度越多</Txt>
    {summary(shownPlan, count)}
    <Button label="生成描写" loading={busy} onPress={() => { generate(); }} />
  </>;

  const confirm = <>
    {scopeCard}
    {summary(shownPlan, count)}
    <Button label={`生成 ${count} 版`} loading={busy} onPress={() => { generate(); }} />
    <Button label="打开描写助手" variant="text" disabled={busy} onPress={() => { adjust(); }} />
  </>;

  const errorBlock = (item: Candidate) => {
    const info = item.error;
    if (!info) return null;
    const actions = errorActions(info.code);
    return <View style={styles.error}>
      <Txt color={c.conf}>{info.message}</Txt>
      <View style={styles.row}>
        {actions.includes('retry') ? <Button label="重试" size="small" variant="secondary" disabled={busy} onPress={() => { retry(item); }} /> : null}
        {actions.includes('adjust') ? <Button label={op ? '打开描写助手' : '调整要求'} size="small" variant="secondary" onPress={() => { adjust(); }} /> : null}
        {actions.includes('service') ? <Button label="编辑服务" size="small" variant="secondary" onPress={() => { editService(); }} /> : null}
        {info.code.startsWith('AI_') ? <Button label="查看详情" size="small" variant="text" onPress={() => { showAiErrorDetail(info, { protocol: item.plan.serviceSnapshot.protocol, baseUrl: item.plan.serviceSnapshot.baseUrl }); }} /> : null}
      </View>
    </View>;
  };
  const prose = { fontFamily: font.family, fontSize: font.size, lineHeight: Math.round(font.size * 1.75) };
  const list = current ? <>
    {candidates.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segments}>
      {candidates.map((item, i) => <Chip key={item.key} label={`版本 ${i + 1} · ${segmentLabel(item)}`} selected={index === i} onPress={() => setIndex(i)} />)}
    </ScrollView> : null}
    <SwipePager index={index} count={candidates.length} onChange={setIndex}>
      {current.status === 'failed' ? errorBlock(current) : current.status === 'idle' ? <View style={styles.error}><Txt color={c.ink2}>这一版还没有发送。</Txt>
        <Button label="重试" size="small" variant="secondary" disabled={busy} onPress={() => { retry(current); }} /></View>
        : !current.text && generating(current.status) ? <View style={styles.card}><SkeletonLines />
          <Txt variant="caption" color={c.ink3}>{current.status === 'retrying' || current.status === 'queued' ? statusLine(current) : `正在生成… ${Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000))} 秒`}</Txt></View>
        : <View style={styles.card}><Txt selectable style={prose}>{`${current.text}${generating(current.status) ? '▍' : ''}`}</Txt></View>}
    </SwipePager>
    {current.status !== 'failed' && current.status !== 'idle' && (current.text || !generating(current.status)) ? <View style={styles.between}>
      <Txt variant="caption" color={current.status === 'truncated' || current.status === 'interrupted' || current.status === 'retrying' ? c.pend : c.ink3} style={styles.flex}>{statusLine(current)}</Txt>
      {(current.status === 'truncated' || current.status === 'interrupted') && current.text ? <Button label="继续生成" size="small" variant="text" disabled={busy || !!pending} onPress={() => { prepareContinue(current); }} /> : null}
      {current.status === 'empty' ? <Button label="重试" size="small" variant="text" disabled={busy} onPress={() => { retry(current); }} /> : null}
    </View> : null}
    {pending ? <View style={styles.pending}>
      <Txt weight="600">{pending.kind === 'more' ? `再写一版（第 ${candidates.length + 1} 个版本）` : '继续生成这一版'}</Txt>
      {summary({ plan: pending.plan }, 1)}
      <View style={styles.row}><Button label="发送" size="small" onPress={() => {
        const send = pending; if (send.kind === 'more') launch(send.plan); else launch(send.plan, { key: send.target!, prefix: send.prefix! }); }} />
        <Button label="取消" size="small" variant="quiet" onPress={() => setPending(undefined)} /></View>
    </View> : null}
    <View style={styles.row}>
      <Button label={op ? '打开描写助手' : '调整要求'} size="small" variant="text" disabled={applying} onPress={() => { adjust(); }} />
      <View style={styles.flex} />
      <Button label="复制" size="small" variant="quiet" disabled={!current.text} onPress={() => { Clipboard.setString(current.text); toast('已复制'); }} />
      {generating(current.status) ? <Button label="停止生成" size="small" variant="quiet" onPress={() => stop(current)} />
        : <Button label="再写一版" size="small" variant="quiet" disabled={busy || !!pending || candidates.length >= MAX_VERSIONS} onPress={() => { prepareMore(); }} />}
    </View>
    <Button label={range.start === range.end ? '插入到光标处' : '替换所选文字'} loading={applying} disabled={!adoptable(current)} onPress={() => { apply(); }} />
  </> : null;

  return <Sheet visible onRequestClose={() => { close(); }} locked={applying} title={title}
    headerRight={<Button label="关闭" size="small" variant="text" disabled={applying} onPress={() => { close(); }} />}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {stage === 'form' ? form : stage === 'confirm' ? confirm : list}
    </ScrollView>
    {picker ? <ReferencePicker workId={workId} selected={refs} max={MAX_REFS}
      onClose={() => setPicker(false)} onDone={next => { setRefs(next); setPicker(false); }} /> : null}
  </Sheet>;
}

/** Left/right swipe on the candidate card switches versions; vertical drags stay with the sheet scroll. */
function SwipePager({ index, count, onChange, children }: { index: number; count: number; onChange(next: number): void; children: React.ReactNode }) {
  const latest = useRef({ index, count, onChange });
  latest.current = { index, count, onChange };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => latest.current.count > 1 && shouldCaptureSwipe(g.dx, g.dy),
    onPanResponderTerminationRequest: () => true,
    onPanResponderRelease: (_e, g) => {
      const { index: from, count: n, onChange: change } = latest.current;
      const next = pageAfterSwipe(from, n, g.dx, g.vx);
      if (next !== from) change(next);
    },
  }), []);
  return <View testID="candidate-pager" {...pan.panHandlers}>{children}</View>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  flex: { flex: 1 },
  segments: { gap: 8 },
  scope: { backgroundColor: c.sunken, borderRadius: radius.small, padding: 12, gap: 4 },
  summary: { gap: 8 },
  preview: { backgroundColor: c.brandTint, padding: 12, gap: 8, borderRadius: radius.small },
  card: { backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: radius.card, padding: 16, gap: 10, minHeight: 120 },
  error: { backgroundColor: c.confTint, borderRadius: radius.card, padding: 16, gap: 10 },
  pending: { backgroundColor: c.brandTint, borderRadius: radius.card, padding: 12, gap: 8 },
  ghostChip: { width: 64, height: 32, borderRadius: 16, backgroundColor: c.sunken },
});
