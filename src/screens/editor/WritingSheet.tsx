import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { toast } from '../../components/overlay/store';
import { confirmAiData, confirmDiscard } from '../../app/dialogs';
import { showAiErrorDetail, showError } from '../../app/errors';
import { isAppError } from '../../features/errors';
import * as ai from '../../features/ai';
import * as entries from '../../features/entries';
import * as prefs from '../../features/prefs';
import type { EntryListItem, AiErrorInfo } from '../../features/types';
import type { ContextPlan } from '../../ai/context';
import { color as c } from '../../theme/tokens';
import { countChars } from '../../utils/text';

const TYPES = ['环境氛围', '动作细节', '人物外貌', '心理活动', '感官体验'];
const OPS: Record<ai.QuickOp, string> = { rewrite: '改写', expand: '扩写', shorten: '缩写', polish: '润色', detail: '补细节' };
interface Candidate { text: string; state: string; plan: ContextPlan; controller: AbortController; error?: AiErrorInfo | null; }

/** S08/S09 share the exact immutable plan shown in the preview. No request starts from an effect. */
export function WritingSheet({ chapterId, workId, range, op, onClose, onApplied }: {
  chapterId: string; workId: string; range: { start: number; end: number }; op?: ai.QuickOp;
  onClose(): void; onApplied(result: { body: string; cursor: number }): void;
}) {
  const [types, setTypes] = useState(['环境氛围']);
  const [style, setStyle] = useState('遵循正文');
  const [extra, setExtra] = useState('');
  const [count, setCount] = useState<1 | 2 | 3>(1);
  const [refs, setRefs] = useState<string[]>([]);
  const [available, setAvailable] = useState<EntryListItem[]>([]);
  const [plan, setPlan] = useState<ContextPlan>();
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [index, setIndex] = useState(0);
  const alive = useRef(true);
  const generation = useRef(0);
  const operation = useRef<AbortController | undefined>(undefined);
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;
  const current = candidates[index];
  useEffect(() => {
    Promise.all([prefs.get('candidateCount'), entries.list(workId), ai.suggestReferences(chapterId, range)])
      .then(([n, list, mentions]) => { if (alive.current) { setCount(n); setAvailable(list.filter(e => ['CONFIRMED', 'ESTABLISHED', 'CONFLICTED'].includes(e.state))); setRefs(mentions.slice(0, 5).map(m => m.entryId)); } })
      .catch(showError);
    return () => { alive.current = false; operation.current?.abort(); candidatesRef.current.forEach(item => item.controller.abort()); };
    // Snapshot range is fixed for the lifetime of this sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const invalidate = () => { setPlan(undefined); setPreview(false); };
  const action = (n = count): ai.WritingAction => ({ chapterId, range, task: op ? 'quickEdit' : 'describe', op,
    types, style, extra, referenceIds: refs, count: n, variantOffset: candidates.length });
  const prepare = async (n = count) => {
    setLoading(true);
    try { const next = await ai.prepareWriting(action(n)); if (alive.current) { setPlan(next); setPreview(true); } }
    catch (error) { await showError(error); }
    finally { if (alive.current) setLoading(false); }
  };
  const generate = async () => {
    if (!plan || loading) return;
    const thisPlan = plan;
    const seq = ++generation.current;
    setLoading(true);
    try {
      const host = await ai.noticeHost(thisPlan);
      if (host) {
        if (!await confirmAiData(host) || !alive.current || seq !== generation.current) return;
        await ai.acknowledgeHost(host).catch(() => {});
      }
      if (!alive.current || seq !== generation.current) return;
      const controller = new AbortController();
      operation.current = controller;
      const offset = candidatesRef.current.length;
      const added = thisPlan.requests.map(() => ({ text: '', state: '生成中', plan: thisPlan, controller: new AbortController() }));
      setCandidates(old => [...old, ...added]); setIndex(offset); setPreview(false); setPlan(undefined);
      const result = await ai.generateWriting(thisPlan, { signal: controller.signal, confirmedHost: host ?? undefined,
        candidateSignals: added.map(item => item.controller.signal), onText: (i, delta) => {
          if (alive.current && generation.current === seq) setCandidates(old => old.map((item, j) => j === offset + i ? { ...item, text: item.text + delta } : item));
        } });
      if (alive.current && generation.current === seq) setCandidates(old => old.map((item, j) => {
        const out = result.candidates[j - offset];
        return out ? { ...item, text: out.text, error: out.error, state: out.error ? out.error.code === 'AI_CANCELLED' ? '已停止' : item.text ? '生成中断' : '失败' : out.stop === 'length' ? '已达到输出上限' : '已完成' } : item;
      }));
    } catch (error) {
      if (alive.current && !isAppError(error, 'AI_CANCELLED')) { await showError(error); setPlan(undefined); setPreview(false); }
    } finally { if (alive.current) setLoading(false); }
  };
  const close = async () => {
    if (applying) return;
    if (candidatesRef.current.some(item => item.text) && !await confirmDiscard({ title: '放弃这些候选？', body: '正文不会变化，关闭后候选不再保留。', discard: '放弃候选' })) return;
    generation.current++; operation.current?.abort(); candidatesRef.current.forEach(item => item.controller.abort()); onClose();
  };
  const apply = async () => {
    if (!current?.text || current.state === '生成中') return;
    setApplying(true);
    try {
      operation.current?.abort(); candidatesRef.current.forEach(item => item.controller.abort());
      const result = await ai.applyWriting(current.plan, current.text);
      onApplied(result); onClose();
    } catch (error) { await showError(error); }
    finally { if (alive.current) setApplying(false); }
  };
  return <Sheet visible onRequestClose={() => { close(); }} locked={applying}
    title={op ? `选区${OPS[op]}` : candidates.length ? '描写候选' : '描写助手'}
    headerRight={<Button label="关闭" size="small" variant="text" disabled={applying} onPress={() => { close(); }} />}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {!candidates.length || preview ? <>
        {!op ? <>
          <Txt variant="callout">描写类型（1–2 项）</Txt>
          <View style={styles.row}>{TYPES.map(label => <Chip key={label} label={label} selected={types.includes(label)} onPress={() => { invalidate(); setTypes(old => old.includes(label) ? old.length > 1 ? old.filter(x => x !== label) : old : old.length < 2 ? [...old, label] : old); }} />)}</View>
          <TextField label="风格" value={style} onChangeText={v => { setStyle(v); invalidate(); }} max={50} />
          <TextField label="补充要求" value={extra} onChangeText={v => { setExtra(v); invalidate(); }} max={200} multiline />
          <Txt variant="callout">参考设定（最多 8 个；点击移除或添加）</Txt>
          <View style={styles.row}>{available.map(item => <Chip key={item.id} label={item.name} selected={refs.includes(item.id)} onPress={() => { invalidate(); setRefs(old => old.includes(item.id) ? old.filter(id => id !== item.id) : old.length < 8 ? [...old, item.id] : old); }} />)}</View>
        </> : null}
        {!candidates.length ? <View style={styles.row}>{([1, 2, 3] as const).map(n => <Chip key={n} label={`${n} 版`} selected={count === n} onPress={() => { setCount(n); invalidate(); }} />)}</View> : null}
        {preview && plan ? <View style={styles.preview}>
          <Txt weight="600">发送范围 · {plan.serviceSnapshot.name}</Txt>
          <Txt variant="caption">{new URL(plan.serviceSnapshot.baseUrl).host} · {plan.serviceSnapshot.model}</Txt>
          <Txt>预计输入约 {plan.estimatedInputTokens} token / 版；{plan.requests.length} 版；每次输出上限 {plan.maxOutputTokens} token。最多 {plan.requests.length + 2} 次尝试，未知费用。</Txt>
          <Txt variant="caption">近似估算包含协议开销，实际用量由服务返回。</Txt>
          <Txt selectable>{plan.requests[0].messages.map(message => message.content).join("\n\n")}</Txt>
          {plan.blocks.map((block, i) => <View key={`${block.sourceId}-${i}`}><Txt variant="caption">{block.required ? '必需参考' : '相关参考'} · {block.state}</Txt><Txt>{block.text}</Txt></View>)}
          {plan.omittedReasons.map((reason, i) => <Txt key={i} variant="caption">已省略 {reason.sourceId}：{reason.reason === 'optional_budget' ? '可选参考超过预算' : '不在所选范围'}</Txt>)}
          <Button label={`生成 ${plan.requests.length} 版`} loading={loading} onPress={() => { generate(); }} />
        </View> : <Button label="预览发送范围" loading={loading} onPress={() => { prepare(); }} />}
      </> : null}
      {candidates.length ? <>
        <View style={styles.row}>{candidates.map((item, i) => <Chip key={i} label={`版本 ${i + 1} · ${item.state}`} selected={index === i} onPress={() => setIndex(i)} />)}</View>
        <Txt selectable style={styles.prose}>{current?.text || (current?.state === '生成中' ? '正在生成…' : '没有生成内容')}</Txt>
        <Txt variant="caption">{current?.state} · {countChars(current?.text ?? '')} 字</Txt>
        {current?.error && current.error.code !== 'AI_CANCELLED' ? <>
          <Txt color={c.conf}>{current.error.message}</Txt>
          <Button label="查看详情" variant="text" onPress={() => { showAiErrorDetail(current.error!, { protocol: current.plan.serviceSnapshot.protocol, baseUrl: current.plan.serviceSnapshot.baseUrl }); }} />
        </> : null}
        <View style={styles.row}>
          <Button label="复制" variant="quiet" disabled={!current?.text} onPress={() => { Clipboard.setString(current.text); toast('已复制'); }} />
          {current?.state === '生成中' ? <Button label="停止生成" variant="quiet" onPress={() => { current.controller.abort(); setCandidates(old => old.map((item, i) => i === index ? { ...item, state: '已停止' } : item)); }} /> :
            <Button label="再写一版" variant="quiet" disabled={loading || candidates.length >= 5} onPress={() => { prepare(1); }} />}
        </View>
        <Button label={range.start === range.end ? '插入到光标处' : '替换所选文字'} loading={applying} disabled={!current?.text || current.state === '生成中'} onPress={() => { apply(); }} />
      </> : null}
    </ScrollView>
  </Sheet>;
}
const styles = StyleSheet.create({ content: { padding: 20, gap: 16 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, preview: { backgroundColor: c.brandTint, padding: 12, gap: 12, borderRadius: 12 }, prose: { fontSize: 18, lineHeight: 32 } });
