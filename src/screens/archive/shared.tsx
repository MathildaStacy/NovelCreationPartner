import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Badge, type BadgeTone } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import type { ChapterListItem, EntryListItem, MemoryState } from '../../features/types';
import { ENTRY_TYPE_LABELS } from '../../features/entries';
import { archiveText as a } from '../../locales/archive';
import { color as c, maxContentWidth, pageMargin, radius } from '../../theme/tokens';
import { formatTime } from '../../utils/format';

export const STATE_LABEL: Record<MemoryState, string> = {
  PROPOSED: '提议', CONFIRMED: '已确认', ESTABLISHED: '正文已建立', CONFLICTED: '有冲突', RETIRED: '已废弃',
};
const STATE_TONE: Record<MemoryState, BadgeTone> = {
  PROPOSED: 'proposed', CONFIRMED: 'confirmed', ESTABLISHED: 'established', CONFLICTED: 'conflict', RETIRED: 'retired',
};
export const MemoryBadge = ({ state }: { state: MemoryState }) => <Badge label={STATE_LABEL[state]} tone={STATE_TONE[state]} />;
export const chapterLabel = (id: string | null | undefined, chapters: ChapterListItem[], fallback = a.always) => {
  if (!id) { return fallback; }
  const chapter = chapters.find(ch => ch.id === id);
  return chapter ? `${chapter.number != null ? `第 ${chapter.number} 章` : chapter.kind === 'extra' ? '番外' : '草稿'} ${chapter.title}` : '（已删除的章节）';
};

export function EntryRow({ item, onPress, showType = false }: { item: EntryListItem; onPress: () => void; showType?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={onPress} style={styles.card}>
    <View style={styles.row}><Txt variant="headline" style={[styles.flex, item.state === 'RETIRED' ? styles.retiredName : null]}>{item.name}</Txt><MemoryBadge state={item.state} /></View>
    {showType ? <Txt variant="caption" color={c.ink3}>{ENTRY_TYPE_LABELS[item.type]}</Txt> : null}
    {item.summary ? <Txt color={c.ink2} numberOfLines={1}>{item.summary}</Txt> : null}
    {item.type === 'foreshadow' ? <Txt variant="caption" color={item.resolved ? c.est : c.pend}>{item.resolved ? `${a.resolved}${item.resolvedChapterNumber != null ? ` · 第 ${item.resolvedChapterNumber} 章` : ''}` : a.unresolved}</Txt> : null}
    <View style={styles.row}><Txt variant="caption" color={c.ink3}>{item.sourceLabel} · {formatTime(item.sourceAt)}</Txt>
      {item.pendingCount ? <Txt variant="caption" color={c.pend}>待审核 {item.pendingCount}</Txt> : null}</View>
  </Pressable>;
}

export function ChapterPicker({ visible, title, value, chapters, nullLabel = a.always, disabledIds = [], onPick, onClose }: {
  visible: boolean; title: string; value: string | null; chapters: ChapterListItem[]; nullLabel?: string;
  disabledIds?: string[]; onPick: (id: string | null) => void; onClose: () => void;
}) {
  return <Sheet visible={visible} title={title} onRequestClose={onClose}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.picker}>
      <Button label={`${nullLabel}${value === null ? ' ✓' : ''}`} variant="text" onPress={() => { onPick(null); onClose(); }} />
      {chapters.map(ch => <Button key={ch.id} label={`${chapterLabel(ch.id, chapters)}${value === ch.id ? ' ✓' : ''}`}
        variant="quiet" disabled={disabledIds.includes(ch.id)} onPress={() => { onPick(ch.id); onClose(); }} />)}
    </ScrollView>
  </Sheet>;
}

export const styles = StyleSheet.create({
  retiredName: { textDecorationLine: 'line-through', color: c.ink3 },
  struck: { textDecorationLine: 'line-through' },
  root: { flex: 1, backgroundColor: c.paper }, flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  content: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', padding: pageMargin, gap: 16, paddingBottom: 32 },
  card: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.card, padding: 16, gap: 8 },
  notice: { padding: 12, backgroundColor: c.brandTint, borderRadius: radius.small, gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, picker: { padding: 12, gap: 4 },
  section: { gap: 12 }, horizontal: { flexGrow: 0 }, proposed: { borderStyle: 'dashed', borderColor: c.brand },
});
