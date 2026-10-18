import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { confirmAiData, confirmDiscard } from '../../app/dialogs';
import { showError } from '../../app/errors';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { DelayedSpinner } from '../../components/Loading';
import { Sheet } from '../../components/Sheet';
import { TextField } from '../../components/TextField';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import * as ai from '../../features/ai';
import * as entries from '../../features/entries';
import * as partner from '../../features/partner';
import { AppError } from '../../features/errors';
import { on } from '../../features/events';
import type { AdoptItem, CompareTable, EntryType, Message } from '../../features/types';
import type { ContextPlan } from '../../ai/context';
import { color as c } from '../../theme/tokens';
import { styles } from '../archive/shared';
import { PlanPreview } from './PlanPreview';

export interface PartnerAction { kind: 'compare' | 'adopt' | 'stash'; message: Message; index?: number }
const dimensions: Record<string, string> = { conflict: '核心冲突', characters: '人物影响', pacing: '节奏', risks: '风险', followups: '后续展开', fit: '与已有设定的契合度' };
interface DraftItem { item: AdoptItem; checked: boolean }

/** S10c/d only prepare locally on mount. A second explicit button authorizes each physical model operation. */
export function PartnerActionSheet({ action, workId, comparisonCache, onClose, onOpenEntry, onManual, onAction }: {
  action: PartnerAction; workId: string; comparisonCache: Map<string, CompareTable>; onClose: () => void; onOpenEntry: (id: string) => void;
  onManual: (type: EntryType, name: string) => void; onAction: (action: PartnerAction) => void;
}) {
  const [plan, setPlan] = useState<ContextPlan>();
  const [table, setTable] = useState<CompareTable>();
  const [reused, setReused] = useState(false);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<DraftItem[]>();
  const original = useRef('');
  const [preparing, setPreparing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [editing, setEditing] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const executing = useRef(false);
  const prepareSequence = useRef(0);
  const alive = useRef(true);
  const closing = useRef(false);
  const active = () => alive.current && !closing.current;
  const option = action.index == null ? null : action.message.structured?.options[action.index];
  const prepare = async (bypassCache = false) => {
    if (!active()) { return; }
    const sequence = ++prepareSequence.current;
    setPreparing(true); setError(undefined); setPlan(undefined);
    if (action.kind === 'compare') { setTable(undefined); setReused(false); }
    try {
      const next = action.kind === 'compare' ? await partner.prepareCompare(action.message.id) : await partner.prepareAdoption(action.message.id, action.index!);
      if (active() && sequence === prepareSequence.current) {
        // Rebuild the full local dependency snapshot before consulting this page's cache.
        const cached = action.kind === 'compare' && !bypassCache ? comparisonCache.get(next.dependencyFingerprint) : undefined;
        if (cached) { setTable(cached); setReused(true); }
        else { setPlan(next); }
      }
    } catch (e) { if (active() && sequence === prepareSequence.current) { setError(e); } }
    finally { if (active() && sequence === prepareSequence.current) { setPreparing(false); } }
  };
  useEffect(() => { alive.current = true; closing.current = false; prepare(); return () => { alive.current = false; closing.current = true; controller.current?.abort(); }; // Explicit author action opened this local preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (action.kind !== 'compare') { return; }
    // Revalidate locally when dependencies change while the table is still open.
    const refresh = () => { if (!executing.current) { prepare(); } };
    const off = [on('work.updated', event => { if (event.workId === workId) { refresh(); } }),
      on('chapters.changed', event => { if (event.workId === workId) { refresh(); } }),
      on('chapter.saved', event => { if (event.workId === workId) { refresh(); } }),
      on('entries.changed', event => { if (event.workId === workId) { refresh(); } }),
      on('messages.changed', event => { if (event.conversationId === action.message.conversationId) { refresh(); } }),
      on('conversations.changed', event => { if (event.workId === workId) { refresh(); } }),
      on('services.changed', refresh), on('prefs.changed', event => { if (event.key === 'serviceBindings') { refresh(); } })];
    return () => off.forEach(unsubscribe => unsubscribe());
    // The keyed sheet has a fixed action and work; revalidation must not send a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const close = async () => {
    if (saving || closing.current) { return; }
    if (draft && JSON.stringify(draft) !== original.current && !await confirmDiscard()) { return; }
    if (!active()) { return; }
    closing.current = true; controller.current?.abort(); onClose();
  };
  const execute = async () => {
    if (!plan || executing.current || !active()) { return; }
    executing.current = true;
    const capturedPlan = plan;
    const request = new AbortController(); controller.current = request;
    const currentOperation = () => active() && !request.signal.aborted;
    setBusy(true); setError(undefined);
    try {
      const host = await ai.noticeHost(capturedPlan);
      if (!currentOperation()) { return; }
      if (host) {
        const confirmed = await confirmAiData(host); if (!confirmed || !currentOperation()) { return; }
        await ai.acknowledgeHost(host); if (!currentOperation()) { return; }
      }
      if (action.kind === 'compare') {
        const result = await partner.compare(capturedPlan, { signal: request.signal, confirmedHost: host ?? undefined });
        if (!currentOperation()) { return; }
        // Include route/service/policy changes during generation in the final validation.
        const current = await partner.prepareCompare(action.message.id);
        if (!currentOperation()) { return; }
        if (current.dependencyFingerprint !== capturedPlan.dependencyFingerprint) { throw new AppError('AI_RESULT_STALE', '对比依据已变化，请重新预览。'); }
        if (currentOperation()) {
          // Page-local, bounded and never exported. Failed or stale results never enter the cache.
          if (comparisonCache.size >= 8) { comparisonCache.delete(comparisonCache.keys().next().value!); }
          comparisonCache.set(capturedPlan.dependencyFingerprint, result);
          setReused(false); setTable(result); setPlan(undefined);
        }
      } else {
        const items = await partner.split(capturedPlan, { signal: request.signal, confirmedHost: host ?? undefined });
        if (currentOperation()) { const next = items.map(item => ({ item, checked: true })); original.current = JSON.stringify(next); setDraft(next); setPlan(undefined); }
      }
    } catch (e) { if (currentOperation()) { setError(e); setPlan(undefined); } }
    finally { executing.current = false; if (active()) { setBusy(false); if (request.signal.aborted) { setPlan(undefined); setError(new AppError('AI_CANCELLED', '已停止，请重新预览。')); } } if (controller.current === request) { controller.current = null; } }
  };
  const write = async () => {
    if (!draft || saving) { return; }
    setSaving(true);
    try {
      const selected = draft.filter(item => item.checked).map(item => item.item);
      const result = await partner.adopt(action.message.id, action.index!, selected, { proposed: action.kind === 'stash' });
      toast(action.kind === 'stash' ? '已暂存到档案，状态为提议' : `已写入档案（${selected.length} 项）`, { action: result.entryIds.length === 1 ? { label: '查看', onPress: () => onOpenEntry(result.entryIds[0]) } : undefined });
      onClose();
    } catch (e) { await showError(e); } finally { if (alive.current) { setSaving(false); } }
  };
  const editItem = (index: number, patch: Partial<AdoptItem>) => setDraft(old => old?.map((item, i) => i === index ? { ...item, item: { ...item.item, ...patch } } : item));
  const measureRow = (key: string, height: number) => setRowHeights(previous => height > (previous[key] ?? 0) + 1 ? { ...previous, [key]: height } : previous);
  const selected = draft?.filter(item => item.checked) ?? [];
  const invalid = selected.some(({ item }) => !item.name.trim() || item.facts.some(fact => !fact.field.trim() || !fact.value.trim()) || new Set(item.facts.map(fact => fact.field)).size !== item.facts.length) || new Set(selected.map(({ item }) => `${item.type}:${item.name.trim()}`)).size !== selected.length;
  return <Sheet visible title={action.kind === 'compare' ? '对比方案' : action.kind === 'stash' ? '暂存为提议' : '采纳为设定'} locked={saving}
    onRequestClose={() => { close(); }} headerRight={<Button label="关闭" variant="text" disabled={saving} onPress={() => { close(); }} />}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {option ? <Txt>{`来自方向「${option.title}」 · 写入前由你逐项确认`}</Txt> : null}
      {preparing ? <DelayedSpinner /> : null}
      {plan ? <PlanPreview plan={plan} onSend={() => { execute(); }} loading={busy} label={action.kind === 'compare' ? '生成对比' : '整理为档案建议'} /> : null}
      {busy ? <Button label="停止生成" variant="quiet" onPress={() => controller.current?.abort()} /> : null}
      {error ? <EmptyState title="这次操作没有完成。" message={error instanceof Error ? error.message : undefined} action={{ label: '重新预览', onPress: () => { prepare(); } }}
        secondary={option ? { label: '手动整理', onPress: () => { onClose(); onManual('world', option.title); } } : undefined} /> : null}
      {table ? <>
        {reused ? <Txt variant="caption">已复用本页结果：选项和全部上下文依赖未变化，没有新增模型请求。</Txt> : null}
        <Txt variant="caption">方向并排显示，左右滑动查看。比较结果仍只是建议。</Txt>
        <View style={local.comparison} accessibilityLabel="方案对比表">
          <View style={local.dimensions} accessibilityLabel="固定维度列">
            <View style={[local.cell, local.heading, { minHeight: rowHeights.heading ?? 64 }]}><Txt variant="caption" weight="600">维度</Txt></View>
            {table.dimensions.map(dimension => <View key={dimension} style={[local.cell, { minHeight: rowHeights[dimension] ?? 96 }]} onLayout={event => measureRow(dimension, event.nativeEvent.layout.height)}><Txt variant="caption" weight="600">{dimensions[dimension]}</Txt></View>)}
          </View>
          <ScrollView horizontal style={local.columns} accessibilityLabel="横向滚动方案列">{table.columns.map(column => {
          const candidate = action.message.structured?.options[column.optionIndex];
          return <View key={column.optionIndex} style={local.column}>
            <View style={[local.cell, local.heading, { minHeight: rowHeights.heading ?? 64 }]} onLayout={event => measureRow('heading', event.nativeEvent.layout.height)}><Txt variant="callout" weight="600">{candidate?.title}</Txt></View>
            {table.dimensions.map(dimension => <View key={dimension} style={[local.cell, { minHeight: rowHeights[dimension] ?? 96 }]} onLayout={event => measureRow(dimension, event.nativeEvent.layout.height)}><Txt variant="callout" selectable>{dimension === 'fit' ? `${column.fit === 'high' ? '高' : column.fit === 'low' ? '低' : '中'} · ` : ''}{column.cells[dimension] || '—'}</Txt></View>)}
            <View style={local.actions}><Button label="采纳为设定" onPress={() => onAction({ kind: 'adopt', message: action.message, index: column.optionIndex })} />
              <Button label="暂存" variant="secondary" onPress={() => onAction({ kind: 'stash', message: action.message, index: column.optionIndex })} /></View>
          </View>;
        })}</ScrollView></View>
        <Button label="重新预览生成对比" variant="text" onPress={() => { prepare(true); }} />
      </> : null}
      {draft ? draft.length ? <>
        {draft.map(({ item, checked }, index) => <View key={index} style={[styles.card, !checked && local.unchecked]}>
          <Button label={`${checked ? '已选择' : '未选择'} · ${item.action === 'update' ? '更新' : '新建'} ${entries.ENTRY_TYPE_LABELS[item.type]}「${item.name}」`}
            variant="quiet" disabled={saving} onPress={() => setDraft(old => old?.map((d, i) => i === index ? { ...d, checked: !d.checked } : d))} />
          {checked ? <>
            <Button label={editing === index ? '完成编辑' : '编辑'} variant="text" disabled={saving} onPress={() => setEditing(i => i === index ? null : index)} />
            {editing === index ? <>
              <TextField label="条目名称" value={item.name} onChangeText={name => editItem(index, { name })} max={30} editable={!saving} />
              <View style={styles.chips}>{(Object.keys(entries.ENTRY_TYPE_LABELS) as EntryType[]).map(type => <Chip key={type} label={entries.ENTRY_TYPE_LABELS[type]} selected={item.type === type}
                disabled={saving} onPress={() => editItem(index, { type, action: 'create', targetEntryId: null })} />)}</View>
              {item.action === 'create' ? <TextField label="一句话摘要" value={item.summary} onChangeText={summary => editItem(index, { summary })} max={100} editable={!saving} /> : null}
              {item.facts.map((fact, i) => <View key={i} style={styles.card}>
                <TextField label="字段名" value={fact.field} onChangeText={field => editItem(index, { facts: item.facts.map((f, j) => j === i ? { ...f, field } : f) })} max={20} editable={!saving} />
                <TextField label="字段值" value={fact.value} onChangeText={value => editItem(index, { facts: item.facts.map((f, j) => j === i ? { ...f, value } : f) })} max={500} multiline editable={!saving} />
                <Button label="移除字段" variant="quiet" disabled={saving} onPress={() => editItem(index, { facts: item.facts.filter((_, j) => i !== j) })} />
              </View>)}
              {item.facts.length < 20 ? <Button label="添加字段" variant="text" disabled={saving} onPress={() => editItem(index, { facts: [...item.facts, { field: '', value: '', before: null }] })} /> : null}
            </> : item.facts.map((fact, i) => <Txt key={i} selectable>{`${entries.FIELD_LABELS[fact.field] ?? fact.field}：${fact.before ? `${fact.before} → ` : ''}${fact.value}`}</Txt>)}
          </> : null}
        </View>)}
        <Button label={`${action.kind === 'stash' ? '暂存到档案' : '写入档案'}（${selected.length} 项）`} loading={saving} disabled={!selected.length || invalid || busy} onPress={write} />
      </> : <EmptyState title="这个方向里没有可以直接写入档案的设定。" action={{ label: '手动整理', onPress: () => { onClose(); onManual('world', option?.title ?? ''); } }} /> : null}
    </ScrollView>
  </Sheet>;
}

const local = StyleSheet.create({
  comparison: { flexDirection: 'row', borderWidth: 1, borderColor: c.line, borderRadius: 12, overflow: 'hidden' },
  dimensions: { width: 66, flexShrink: 0, backgroundColor: c.paper },
  columns: { flex: 1 }, column: { width: 150 },
  cell: { padding: 8, borderBottomWidth: 1, borderRightWidth: 1, borderColor: c.line, justifyContent: 'center' },
  heading: { backgroundColor: c.surface }, actions: { padding: 8, gap: 8 }, unchecked: { opacity: 0.5 },
});
