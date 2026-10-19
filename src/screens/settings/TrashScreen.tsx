import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { showError } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import { ActionSheet } from '../../components/ActionSheet';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { NavBar } from '../../components/NavBar';
import { SwipeRow, swipeAccessibility, useSwipeGroup, type SwipeAction } from '../../components/SwipeRow';
import { Txt } from '../../components/Text';
import { showDialog, toast } from '../../components/overlay/store';
import * as trash from '../../features/trash';
import type { TrashKind } from '../../features/types';
import { color as c, radius } from '../../theme/tokens';
import { formatTime } from '../../utils/format';
import { styles } from '../archive/shared';

/**
 * S15d irreversible operations need a concrete confirmation; restore remains local.
 * 恢复 stays visible on each row; 彻底删除 is revealed by swipe, or by the long-press
 * action sheet (恢复 / 彻底删除 / 取消).
 */
export function TrashScreen({ navigation }: RootScreenProps<'Trash'>) {
  const [filter, setFilter] = useState<TrashKind | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<trash.TrashItem | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const swipe = useSwipeGroup();
  usePreventRemove(busy, () => {});
  const loaded = useLoad(() => trash.list(), [], { refetchOnFocus: true, events: { 'work.updated': () => true, 'work.removed': () => true, 'chapters.changed': () => true, 'entries.changed': () => true } });
  const decide = async (item: trash.TrashItem, purge = false) => {
    if (busy) { return; } setBusy(true);
    try {
      if (purge) {
        if (await showDialog({ title: `彻底删除「${item.title}」？`, message: `彻底删除后无法恢复。${item.kind === 'work' ? '作品的全部章节、档案和对话都会一并删除。' : ''}`,
          buttons: [{ key: 'cancel', label: '取消' }, { key: 'delete', label: '彻底删除', style: 'primary' }], dismissKey: 'cancel' }) !== 'delete') { return; }
        await trash.purge(item.kind, item.id); toast('已彻底删除');
      } else {
        if (item.parentDeleted) {
          if (await showDialog({ title: '一并恢复所属作品？', message: `「${item.parentTitle || '未命名作品'}」也在回收站中，需要先恢复作品。`, buttons: [{ key: 'cancel', label: '取消' }, { key: 'restore', label: '一并恢复', style: 'primary' }], dismissKey: 'cancel' }) !== 'restore') { return; }
          await trash.restore('work', item.workId);
        }
        await trash.restore(item.kind, item.id);
        toast(`已恢复「${item.title}」`, { action: { label: '查看', onPress: () => view(item) } });
      }
      await loaded.reload();
    } catch (error) { await showError(error); await loaded.reload(); } finally { setBusy(false); }
  };
  /** S15d #5: 作品 → S05, 章节 → S06, 条目 → S12. */
  const view = (item: trash.TrashItem) => {
    if (item.kind === 'entry') { navigation.push('EntryDetail', { entryId: item.id }); }
    else { navigation.push('Work', { workId: item.workId, tab: item.kind === 'work' ? 'Overview' : 'Chapters' }); }
  };
  const rowActions = (item: trash.TrashItem): SwipeAction[] => [
    { key: 'restore', label: '恢复', onPress: () => { decide(item); } },
    { key: 'purge', label: '彻底删除', tone: 'danger', onPress: () => { decide(item, true); } },
  ];
  const empty = async () => {
    if (busy) { return; } setBusy(true);
    try {
      if (await showDialog({ title: '清空回收站？', message: `回收站中的 ${loaded.data?.length ?? 0} 项将被彻底删除，无法恢复。`, buttons: [{ key: 'cancel', label: '取消' }, { key: 'empty', label: '清空', style: 'primary' }], dismissKey: 'cancel' }) !== 'empty') { return; }
      await trash.empty(); toast('回收站已清空'); await loaded.reload();
    } catch (error) { await showError(error); } finally { setBusy(false); }
  };
  const items = loaded.data?.filter(item => filter === 'all' || item.kind === filter) ?? [];
  return <View style={styles.root}><NavBar title="回收站" onBack={() => navigation.goBack()} right={<Button label="清空" variant="text" disabled={busy || !loaded.data?.length} onPress={() => { empty(); }} />} />
    <FlatList data={items} keyExtractor={item => `${item.kind}-${item.id}`} contentContainerStyle={styles.content} ListHeaderComponent={<>
      <Txt color={c.ink3}>删除的内容保留 30 天，之后自动彻底删除。</Txt>
      <View style={styles.chips}>{(['all', 'work', 'chapter', 'entry'] as const).map(kind => <Chip key={kind} label={`${{ all: '全部', work: '作品', chapter: '章节', entry: '档案条目' }[kind]} ${loaded.data?.filter(item => kind === 'all' || item.kind === kind).length ?? 0}`} selected={filter === kind} onPress={() => setFilter(kind)} />)}</View>
    </>} ListEmptyComponent={!loaded.loading ? <EmptyState title={loaded.error ? '回收站没有加载出来。' : '回收站是空的'} message="删除的作品、章节和档案条目会在这里保留 30 天。" action={loaded.error ? { label: '重试', onPress: loaded.reload } : undefined} /> : undefined}
    onScrollBeginDrag={swipe.close}
    renderItem={({ item }) => {
      const actions = rowActions(item);
      return <SwipeRow rowKey={`${item.kind}-${item.id}`} group={swipe} actions={actions.filter(a => a.key === 'purge')} disabled={busy} style={local.item}>
        <Pressable accessibilityLabel={`${item.title}，${item.parentTitle ? `${item.parentTitle}，` : ''}还剩 ${item.remainingDays} 天`} accessibilityHint="左滑或长按可彻底删除" {...swipeAccessibility(actions)}
          onLongPress={busy ? undefined : () => { setMenu(item); setMenuVisible(true); }} delayLongPress={500} style={styles.card}>
          <Txt variant="headline">{item.title}</Txt><Txt variant="caption">{item.parentTitle}{item.parentDeleted ? '（在回收站）' : ''} · 删除于 {formatTime(item.deletedAt)}</Txt>
          <Txt color={item.remainingDays <= 3 ? c.pend : c.ink3}>还剩 {item.remainingDays} 天</Txt><View style={styles.row}><Button label="恢复" disabled={busy} onPress={() => { decide(item); }} /></View>
        </Pressable>
      </SwipeRow>;
    }} />
    <ActionSheet visible={menuVisible} title={menu?.title} items={[{ key: 'restore', label: '恢复' }, { key: 'purge', label: '彻底删除', destructive: true }]}
      onRequestClose={() => setMenuVisible(false)}
      onDone={key => { const item = menu; setMenu(null); if (item && key) { decide(item, key === 'purge'); } }} />
  </View>;
}

const local = StyleSheet.create({ item: { marginBottom: 12, borderRadius: radius.card } });
