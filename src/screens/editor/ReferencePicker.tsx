import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import { TextField } from '../../components/TextField';
import * as entries from '../../features/entries';
import type { EntryListItem, EntryType } from '../../features/types';
import { color as c, radius } from '../../theme/tokens';
import type { ReferenceChip } from './WritingSheet';

const FILTERS: ('all' | EntryType)[] = ['all', 'character', 'world', 'place', 'faction', 'rule', 'foreshadow'];
const VALID = ['CONFIRMED', 'ESTABLISHED', 'CONFLICTED'];

/**
 * S08a 添加参考条目: a second sheet over S08. Proposed and retired entries are never offered.
 * Closing without "完成" drops this round of changes.
 */
export function ReferencePicker({ workId, selected, max, onClose, onDone }: {
  workId: string; selected: ReferenceChip[]; max: number; onClose(): void; onDone(next: ReferenceChip[]): void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | EntryType>('all');
  const [checked, setChecked] = useState<ReferenceChip[]>(selected);
  const [items, setItems] = useState<EntryListItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      const text = query.trim();
      (text ? entries.search(workId, text) : entries.list(workId).then(list => [...list].sort((a, b) => b.sourceAt.localeCompare(a.sourceAt))))
        .then(list => { if (alive) { setItems(list.filter(item => VALID.includes(item.state))); setFailed(false); } })
        .catch(() => { if (alive) { setFailed(true); setItems([]); } });
    }, query.trim() ? 300 : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [workId, query, reload]);
  const shown = (items ?? []).filter(item => filter === 'all' || item.type === filter);
  const full = checked.length >= max;
  const toggle = (item: EntryListItem) => setChecked(old => old.some(ref => ref.id === item.id)
    ? old.filter(ref => ref.id !== item.id) : old.length < max ? [...old, { id: item.id, name: item.name }] : old);
  return <Sheet visible title="添加参考" onRequestClose={onClose}
    headerRight={<Button label={`完成（${checked.length}/${max}）`} size="small" variant="text" onPress={() => onDone(checked)} />}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextField placeholder="搜索名称、别名、摘要" value={query} onChangeText={setQuery} clearable accessibilityLabel="搜索参考条目" />
      <View style={styles.row}>{FILTERS.map(key => <Chip key={key} label={key === 'all' ? '全部' : entries.ENTRY_TYPE_LABELS[key]} selected={filter === key} onPress={() => setFilter(key)} />)}</View>
      {full ? <Txt variant="caption" color={c.pend}>{`最多参考 ${max} 个条目`}</Txt> : null}
      {failed ? <View style={styles.row}><Txt color={c.ink2}>没有加载出来</Txt><Button label="重试" size="small" variant="text" onPress={() => setReload(n => n + 1)} /></View>
        : items && !shown.length ? <Txt color={c.ink3}>没有找到匹配的条目</Txt>
        : shown.map(item => {
          const on = checked.some(ref => ref.id === item.id);
          const disabled = !on && full;
          return <Pressable key={item.id} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled }} accessibilityLabel={item.name}
            disabled={disabled} onPress={() => toggle(item)} style={[styles.item, disabled && styles.disabled]}>
            <View style={[styles.box, on && styles.boxOn]}>{on ? <Txt color={c.surface} weight="600">✓</Txt> : null}</View>
            <View style={styles.flex}>
              <Txt weight="600">{item.name}</Txt>
              <Txt variant="caption" color={c.ink3} numberOfLines={1}>{`${entries.ENTRY_TYPE_LABELS[item.type]}${item.summary ? ` · ${item.summary}` : ''}`}</Txt>
            </View>
          </Pressable>;
        })}
    </ScrollView>
  </Sheet>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomColor: c.line, borderBottomWidth: StyleSheet.hairlineWidth },
  disabled: { opacity: 0.45 },
  box: { width: 22, height: 22, borderRadius: radius.small, borderWidth: 1.5, borderColor: c.ink3, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: c.brand, borderColor: c.brand },
  flex: { flex: 1, gap: 2 },
});
