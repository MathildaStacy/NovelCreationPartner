import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { ContextPlan } from '../../ai/context';
import { confirmAiData, ensureModelService } from '../../app/dialogs';
import { AiCallError, isAppError } from '../../features/errors';
import { showAiErrorDetail, showErrorDetail, showError } from '../../app/errors';
import type { RootScreenProps } from '../../app/navigation/types';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Sheet } from '../../components/Sheet';
import { TextField } from '../../components/TextField';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import * as ai from '../../features/ai';
import * as completion from '../../features/entryCompletion';
import * as entries from '../../features/entries';
import type { EntryDetail } from '../../features/types';
import { PlanPreview } from '../partner/PlanPreview';
import { archiveText as a } from '../../locales/archive';
import { color as c } from '../../theme/tokens';
import { styles } from './shared';
interface Suggestion extends completion.CompletionSuggestion { status: 'pending' | 'adopted' | 'dismissed'; }
/** S12c one explicit operation for the selected fields; all results begin as proposals. */
export function EntryCompletionSheet({ entry, navigation, onClose }: { entry: EntryDetail; navigation: RootScreenProps<'EntryDetail'>['navigation']; onClose(ids: string[]): void }) {
  const allowed = entries.ENTRY_FIELDS[entry.type].filter(field => field !== 'resolved');
  const [fields, setFields] = useState(allowed.filter(field => !entry.facts.some(f => f.field === field)).slice(0, 5));
  const [extra, setExtra] = useState('');
  const [plan, setPlan] = useState<ContextPlan>();
  const [suggestions, setSuggestions] = useState<Suggestion[]>();
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { if (!busy) { setSeconds(0); return; } const timer = setInterval(() => setSeconds(value => value + 1), 1000); return () => clearInterval(timer); }, [busy]);
  const diagnosticPlan = useRef<ContextPlan | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const adoptedIds = useRef<string[]>([]);
  const alive = useRef(true);
  const closing = useRef(false);
  const active = () => alive.current && !closing.current;
  useEffect(() => { alive.current = true; closing.current = false; return () => { alive.current = false; closing.current = true; controller.current?.abort(); }; }, []);
  const close = () => { if (!saving && !closing.current) { closing.current = true; controller.current?.abort(); onClose(adoptedIds.current); } };
  const preview = async () => {
    setBusy(true); setError(undefined);
    try {
      if (await ensureModelService(active, { navigate: (name, params) => { close(); navigation.navigate(name, params); } }) !== 'ok' || !active()) { return; }
      const next = await completion.prepare(entry.id, fields, extra); if (active()) { setPlan(next); } }
    catch (e) { if (active()) { setError(e); } }
    finally { if (active()) { setBusy(false); } }
  };
  const generate = async () => {
    if (!plan || busy || controller.current || !active()) { return; }
    const exact = plan; diagnosticPlan.current = exact; const abort = new AbortController(); controller.current = abort;
    const current = () => active() && !abort.signal.aborted;
    setBusy(true); setError(undefined);
    try {
      const host = await ai.noticeHost(exact);
      if (!current()) { return; }
      if (host) {
        const confirmed = await confirmAiData(host); if (!confirmed || !current()) { return; }
        await ai.acknowledgeHost(host); if (!current()) { return; }
      }
      const result = await completion.complete(exact, { signal: abort.signal, confirmedHost: host ?? undefined });
      if (current()) { setSuggestions(result.map(value => ({ ...value, status: 'pending' }))); setPlan(undefined); }
    } catch (e) { if (current()) { setError(e); setPlan(undefined); } }
    finally { if (active()) { setBusy(false); if (abort.signal.aborted) { setPlan(undefined); } } if (controller.current === abort) { controller.current = null; } }
  };
  const decide = async (suggestion: Suggestion, action: 'adopt' | 'dismiss' | 'undo', value?: string) => {
    if (saving) { return; } setSaving(true);
    try {
      let factId = suggestion.factId;
      if (action === 'adopt') { await entries.confirmFact(factId, value === undefined ? {} : { value }); const updated = await entries.get(entry.id); const accepted = updated.facts.find(f => f.field === suggestion.field); if (accepted) { adoptedIds.current = [...new Set([...adoptedIds.current, accepted.id])]; } toast('已采纳'); }
      else if (action === 'dismiss') { await entries.dismissFact(factId); }
      else { [factId] = await entries.proposeFacts(entry.id, [{ field: suggestion.field, value: suggestion.value }], { kind: 'ai_complete', ref: null }); }
      if (alive.current) {
        setSuggestions(old => old?.map(s => s.factId === suggestion.factId ? { ...s, factId, status: action === 'adopt' ? 'adopted' : action === 'dismiss' ? 'dismissed' : 'pending' } : s));
        setEditing(null);
      }
    } catch (e) { await showError(e); }
    finally { if (alive.current) { setSaving(false); } }
  };
  return <Sheet visible title={`补全「${entry.name}」`} onRequestClose={close} locked={saving}
    headerRight={<Button label={suggestions ? '完成' : '关闭'} variant="text" onPress={close} disabled={saving} />}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {!suggestions ? <>
        <Txt>{a.completeIntro}</Txt>
        <View style={styles.chips}>{allowed.map(field => <Chip key={field} label={entries.FIELD_LABELS[field] ?? field} selected={fields.includes(field)}
          disabled={busy || !fields.includes(field) && fields.length >= 5} onPress={() => { setFields(old => old.includes(field) ? old.filter(f => f !== field) : [...old, field]); setPlan(undefined); }} />)}</View>
        {fields.map(field => <Txt key={field} variant="caption">{entries.FIELD_LABELS[field]}：{entry.facts.find(f => f.field === field)?.value || '未填写'}{entry.proposedFacts.some(f => f.field === field) ? ' · 新建议会替换已有提议' : ''}</Txt>)}
        <TextField label="补充方向（选填）" value={extra} max={200} multiline editable={!busy} onChangeText={value => { setExtra(value); setPlan(undefined); }} />
        {!plan ? <Button label="预览发送范围" loading={busy} disabled={!fields.length} onPress={() => { preview(); }} /> : <PlanPreview plan={plan} onSend={() => { generate(); }} loading={busy} label="生成建议" />}
        {busy && controller.current ? <View style={styles.section}><Txt>{a.completeGenerating} · {seconds} 秒</Txt>{seconds >= 20 ? <Txt>{a.completeWaiting}</Txt> : null}{fields.map(field => <View key={field} style={styles.card}><Txt color={c.ink3}>{entries.FIELD_LABELS[field]} · 正在整理…</Txt></View>)}</View> : null}
        {busy && controller.current ? <Button label="停止生成" variant="quiet" onPress={() => controller.current?.abort()} /> : null}
      </> : <>
        <Txt variant="headline">AI 的建议 · {suggestions.length} 条</Txt>
        {!suggestions.length ? <Txt>{a.completeEmpty}</Txt> : null}
        {suggestions.map(s => <View key={s.factId} style={[styles.card, styles.proposed]}>
          <Txt weight="600">{entries.FIELD_LABELS[s.field]}{s.status === 'adopted' ? ' · 已采纳' : s.status === 'dismissed' ? ' · 已丢弃' : ''}</Txt>
          <Txt selectable>{s.value}</Txt><Txt variant="caption">理由：{s.reason}</Txt>
          {s.status === 'pending' ? editing === s.factId ? <>
            <TextField label="建议内容" value={editValue} onChangeText={setEditValue} max={300} multiline editable={!saving} />
            <Button label="确定采纳" loading={saving} disabled={!editValue.trim()} onPress={() => { decide(s, 'adopt', editValue); }} />
          </> : <View style={styles.row}>
            <Button label="采纳" disabled={saving} onPress={() => { decide(s, 'adopt'); }} />
            <Button label="改后采纳" variant="secondary" disabled={saving} onPress={() => { setEditing(s.factId); setEditValue(s.value); }} />
            <Button label="丢弃" variant="quiet" disabled={saving} onPress={() => { decide(s, 'dismiss'); }} />
          </View> : s.status === 'dismissed' ? <Button label="撤销丢弃" variant="text" disabled={saving} onPress={() => { decide(s, 'undo'); }} /> : null}
        </View>)}
        <Txt variant="caption">未处理建议已留在档案详情，之后可以继续决定。</Txt>
        <Button label="重新选择字段" variant="text" disabled={saving} onPress={() => { setSuggestions(undefined); setPlan(undefined); }} />
      </>}
      {error ? <View style={styles.section}><Txt color={c.conf}>{error instanceof Error ? error.message : '没有生成建议，请重试'}</Txt>
        <Button label="重新预览" variant="secondary" disabled={busy} onPress={() => { preview(); }} />
        <Button label="查看详情" variant="text" onPress={() => error instanceof AiCallError ? showAiErrorDetail(error.info, diagnosticPlan.current?.serviceSnapshot) : showErrorDetail(error, '补全没有完成')} />
        {isAppError(error) && ['AI_AUTH', 'AI_PERMISSION', 'AI_NOT_FOUND', 'NO_SERVICE', 'KEY_UNAVAILABLE'].includes(error.code) ? <Button label="检查模型服务" variant="text" onPress={() => { close(); navigation.navigate('Settings'); }} /> : null}
        <Button label="手动填写" variant="text" onPress={() => { close(); navigation.navigate('EntryForm', { workId: entry.workId, entryId: entry.id, field: fields[0] }); }} />
      </View> : null}
    </ScrollView>
  </Sheet>;
}
