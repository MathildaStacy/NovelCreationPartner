import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { showError, showErrorDetail } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { DelayedSpinner } from '../../components/Loading';
import { NavBar } from '../../components/NavBar';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import * as entries from '../../features/entries';
import * as chapters from '../../features/chapters';
import type { HistoryItem } from '../../features/types';
import { archiveText as a } from '../../locales/archive';
import { t } from '../../locales/zh-CN';
import { color as c } from '../../theme/tokens';
import { formatTime } from '../../utils/format';
import { chapterLabel, styles } from './shared';

const sources = { manual: '手动', review: '审核通过', ai_complete: 'AI 补全', partner: 'AI 伙伴', conflict: '冲突处理', revert: '恢复' };
/** S12d history is append-only; restore delegates stage preservation to entries.revertFact. */
export function EntryHistoryScreen({ navigation, route }: RootScreenProps<'EntryHistory'>) {
  const { entryId } = route.params;
  const [field, setField] = useState<string | null>(null);
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  const loaded = useLoad(async () => {
    const entry = await entries.get(entryId);
    return { entry, history: await entries.history(entryId), chapters: (await chapters.list(entry.workId)).flatMap(g => g.chapters).filter(ch => ch.kind === 'main') };
  }, [entryId], { events: { 'entries.changed': e => e.entryIds.includes(entryId), 'chapters.changed': () => true }, refetchOnFocus: true });
  const data = loaded.data;
  const history = data?.history ?? [];
  const filtered = field ? history.filter(item => item.field === field) : history;
  const fields = [...new Set(history.map(item => item.field))];
  const restore = async (factId: string) => {
    if (busy) { return; }
    setBusy(true);
    try { await entries.revertFact(factId); setSelected(null); toast(`已恢复「${entries.FIELD_LABELS[selected?.field ?? ''] ?? selected?.field}」`); await loaded.reload(); }
    catch (e) { await showError(e); await loaded.reload(); }
    finally { setBusy(false); }
  };
  const currentFact = selected ? data?.entry.facts.find(f => f.field === selected.field && f.fromChapterId === selected.fromChapterId) : undefined;
  const isCurrent = !!selected && currentFact?.value === selected.after;
  const retired = data?.entry.state === 'RETIRED';
  return <View style={styles.root}>
    <NavBar title={a.history} backLabel={data?.entry.name} onBack={() => navigation.goBack()} />
    {loaded.loading ? <DelayedSpinner /> : loaded.error ? <EmptyState title={a.entryFailed} action={{ label: t.common.retry, onPress: loaded.reload }}
      secondary={{ label: t.common.viewDetail, onPress: () => showErrorDetail(loaded.error, a.entryFailed) }} /> : <>
      {retired ? <View style={styles.notice}><Txt>条目已废弃，历史仅供查看</Txt></View> : null}
      <ScrollView horizontal style={styles.horizontal} contentContainerStyle={styles.content}>
        <Chip label={`全部 ${history.length}`} selected={!field} onPress={() => { setField(null); setLimit(50); }} />
        {fields.map(key => <Chip key={key} label={`${entries.FIELD_LABELS[key] ?? key} ${history.filter(h => h.field === key).length}`} selected={field === key} onPress={() => { setField(key); setLimit(50); }} />)}
      </ScrollView>
      <FlatList data={filtered.slice(0, limit)} keyExtractor={item => item.factId} contentContainerStyle={styles.content}
        onEndReached={() => setLimit(n => n + 50)} ListEmptyComponent={<EmptyState title={a.noHistory} />}
        renderItem={({ item }) => <Pressable onPress={() => setSelected(item)} accessibilityRole="button" accessibilityLabel={`${entries.FIELD_LABELS[item.field] ?? item.field} ${item.after ?? '已失效'}`} style={styles.card}>
          <View style={styles.row}><Txt variant="headline">{entries.FIELD_LABELS[item.field] ?? item.field}</Txt><Txt color={c.ink3}>{sources[item.sourceKind]}</Txt>
            {data?.entry.facts.some(f => f.id === item.factId) ? <Txt color={c.brand}>当前</Txt> : null}</View>
          <Txt numberOfLines={2} color={c.ink3}>{item.before ?? a.unfilled}</Txt><Txt numberOfLines={2}>→ {item.after ?? '已失效'}</Txt>
          <Txt variant="caption" color={c.ink3}>{formatTime(item.at)} · {chapterLabel(item.fromChapterId, data?.chapters ?? [])}</Txt>
        </Pressable>} />
    </>}
    <Sheet visible={!!selected} locked={busy} title={selected ? `${entries.FIELD_LABELS[selected.field] ?? selected.field} · ${formatTime(selected.at)}` : ''}
      onRequestClose={() => setSelected(null)} headerRight={<Button label={t.common.close} variant="text" disabled={busy} onPress={() => setSelected(null)} />}>
      {selected ? <ScrollView contentContainerStyle={styles.content}><Txt color={c.ink3}>来源：{sources[selected.sourceKind]} · {chapterLabel(selected.fromChapterId, data?.chapters ?? [])}</Txt>
        {selected.evidence ? <Txt selectable>{selected.evidence}</Txt> : null}
        <Txt variant="headline">这个版本</Txt><Txt selectable>{selected.after ?? '已失效'}</Txt><Txt variant="headline">修改前</Txt><Txt selectable>{selected.before ?? a.unfilled}</Txt>
        {selected.after !== null ? <Button label={isCurrent ? '已是当前值' : retired ? '先在详情页恢复这个条目' : '恢复为这个版本'} loading={busy} disabled={isCurrent || retired} onPress={() => restore(selected.factId)} /> : null}
        {selected.beforeFactId ? <Button label="恢复为修改前的值" variant="secondary" disabled={busy || retired || selected.before === currentFact?.value} onPress={() => restore(selected.beforeFactId!)} /> : null}
      </ScrollView> : null}
    </Sheet>
  </View>;
}
