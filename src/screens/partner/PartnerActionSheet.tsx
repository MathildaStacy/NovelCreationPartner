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
import type { AdoptItem, CompareTable, EntryType, Message } from '../../features/types';
import type { ContextPlan } from '../../ai/context';
import { styles } from '../archive/shared';
import { PlanPreview } from './PlanPreview';

export interface PartnerAction { kind: 'compare' | 'adopt' | 'stash'; message: Message; index?: number }
const dimensions: Record<string, string> = { conflict: '核心冲突', characters: '人物影响', pacing: '节奏', risks: '风险', followups: '后续展开', fit: '与已有设定的契合度' };
interface DraftItem { item: AdoptItem; checked: boolean }

/** S10c/d only prepare locally on mount. A second explicit button authorizes each physical model operation. */
export function PartnerActionSheet({ action, workId: _workId, onClose, onOpenEntry, onManual, onAction }: {
  action: PartnerAction; workId: string; onClose: () => void; onOpenEntry: (id: string) => void;
  onManual: (type: EntryType, name: string) => void; onAction: (action: PartnerAction) => void;
}) {
  const [plan, setPlan] = useState<ContextPlan>();
  const [table, setTable] = useState<CompareTable>();
  const [draft, setDraft] = useState<DraftItem[]>();
  const original = useRef('');
  const [preparing, setPreparing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [editing, setEditing] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const option = action.index == null ? null : action.message.structured?.options[action.index];
  const prepare = async () => {
    setPreparing(true); setError(undefined); setPlan(undefined);
    try {
      const next = action.kind === 'compare' ? await partner.prepareCompare(action.message.id) : await partner.prepareAdoption(action.message.id, action.index!);
      if (alive.current) { setPlan(next); }
    } catch (e) { if (alive.current) { setError(e); } }
    finally { if (alive.current) { setPreparing(false); } }
  };
  useEffect(() => { prepare(); return () => { alive.current = false; controller.current?.abort(); }; // Explicit author action opened this local preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const close = async () => {
    if (saving) { return; }
    if (draft && JSON.stringify(draft) !== original.current && !await confirmDiscard()) { return; }
    controller.current?.abort(); onClose();
  };
  const execute = async () => {
    if (!plan || busy) { return; }
    const capturedPlan = plan;
    setBusy(true); setError(undefined);
    try {
      const host = await ai.noticeHost(capturedPlan);
      if (host && !await confirmAiData(host) || !alive.current) { return; }
      if (host) { await ai.acknowledgeHost(host); }
      const request = new AbortController(); controller.current = request;
      if (action.kind === 'compare') {
        const result = await partner.compare(capturedPlan, { signal: request.signal, confirmedHost: host ?? undefined });
        if (alive.current) { setTable(result); setPlan(undefined); }
      } else {
        const items = await partner.split(capturedPlan, { signal: request.signal, confirmedHost: host ?? undefined });
        if (alive.current) { const next = items.map(item => ({ item, checked: true })); original.current = JSON.stringify(next); setDraft(next); setPlan(undefined); }
      }
    } catch (e) { if (alive.current) { setError(e); } }
    finally { if (alive.current) { setBusy(false); } }
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
        <Txt variant="caption">方向并排显示，左右滑动查看。比较结果仍只是建议。</Txt>
        <ScrollView horizontal><View style={styles.row}>{table.columns.map(column => {
          const candidate = action.message.structured?.options[column.optionIndex];
          return <View key={column.optionIndex} style={[styles.card, local.column]}>
            <Txt variant="headline">{candidate?.title}</Txt>
            {table.dimensions.map(dimension => <View key={dimension} style={styles.section}><Txt weight="600">{dimensions[dimension]}</Txt><Txt selectable>{column.cells[dimension] || '—'}</Txt></View>)}
            <Button label="采纳为设定" onPress={() => onAction({ kind: 'adopt', message: action.message, index: column.optionIndex })} />
            <Button label="暂存" variant="secondary" onPress={() => onAction({ kind: 'stash', message: action.message, index: column.optionIndex })} />
          </View>;
        })}</View></ScrollView>
        <Button label="重新预览对比" variant="text" onPress={() => { prepare(); }} />
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

const local = StyleSheet.create({ column: { width: 240 }, unchecked: { opacity: 0.5 } });
