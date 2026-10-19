import React, { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { showError, toAppError } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import { ActionSheet } from '../../components/ActionSheet';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { BusyOverlay } from '../../components/BusyOverlay';
import { NavBar } from '../../components/NavBar';
import { Delayed, SkeletonCards } from '../../components/Skeleton';
import { SwipeRow, swipeAccessibility, useSwipeGroup, type SwipeAction } from '../../components/SwipeRow';
import { Txt } from '../../components/Text';
import { showDialog, toast } from '../../components/overlay/store';
import { ENTRY_TYPE_LABELS } from '../../features/entries';
import * as trash from '../../features/trash';
import type { TrashKind } from '../../features/types';
import { color as c, radius } from '../../theme/tokens';
import { chapterHeading, formatTime } from '../../utils/format';
import { styles } from '../archive/shared';

const KIND_NAME: Record<TrashKind, string> = { work: '作品', chapter: '章节', entry: '档案条目' };

/** S15d #4 标题: 书名；"第 N 章 标题" / "番外 标题" / "草稿 标题"；条目名称（类型另显示为标签）. */
export function trashTitle(item: trash.TrashItem): string {
  if (item.kind === 'chapter' && item.chapterKind) {
    return chapterHeading({ kind: item.chapterKind, number: item.chapterNumber ?? null, title: item.title });
  }
  return item.title;
}

/**
 * S15d irreversible operations need a concrete confirmation; restore remains local.
 * 恢复 stays visible on each row; 彻底删除 is revealed by swipe, or by the long-press
 * action sheet (恢复 / 彻底删除 / 取消). Rows work independently; 清空 covers the page.
 */
export function TrashScreen({ navigation }: RootScreenProps<'Trash'>) {
  const [filter, setFilter] = useState<TrashKind | 'all'>('all');
  const [pending, setPending] = useState<string[]>([]);
  const [emptying, setEmptying] = useState(false);
  const [menu, setMenu] = useState<trash.TrashItem | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const pendingRef = useRef(new Set<string>());
  const swipe = useSwipeGroup();
  usePreventRemove(emptying, () => {});
  const loaded = useLoad(() => trash.list(), [], { refetchOnFocus: true, events: { 'work.updated': () => true, 'work.removed': () => true, 'chapters.changed': () => true, 'entries.changed': () => true } });
  const keyOf = (item: trash.TrashItem) => `${item.kind}-${item.id}`;
  const failed = async (error: unknown) => {
    if (toAppError(error).code === 'NOT_FOUND') { toast('这一项已不在回收站'); } else { await showError(error); }
    await loaded.reload();
  };
  const decide = async (item: trash.TrashItem, purge = false) => {
    const key = keyOf(item);
    if (emptying || pendingRef.current.has(key)) { return; }
    pendingRef.current.add(key); setPending([...pendingRef.current]);
    const name = trashTitle(item);
    try {
      if (purge) {
        if (await showDialog({ title: `彻底删除「${name}」？`, message: `彻底删除后无法恢复。${item.kind === 'work' ? '作品的全部章节、档案、对话和封面都会一并删除。' : ''}`,
          buttons: [{ key: 'cancel', label: '取消' }, { key: 'delete', label: '彻底删除', style: 'primary' }], dismissKey: 'cancel' }) !== 'delete') { return; }
        await trash.purge(item.kind, item.id); toast('已彻底删除');
      } else {
        if (item.parentDeleted) {
          if (await showDialog({ title: '一并恢复所属作品？', message: `所属作品「${item.parentTitle || '未命名作品'}」也在回收站中，需要一并恢复。`, buttons: [{ key: 'cancel', label: '取消' }, { key: 'restore', label: '一并恢复', style: 'primary' }], dismissKey: 'cancel' }) !== 'restore') { return; }
          await trash.restore('work', item.workId);
        }
        const { movedToVolume } = await trash.restore(item.kind, item.id);
        toast(`已恢复「${name}」${movedToVolume !== undefined ? `（已放入「${movedToVolume}」）` : ''}`, { action: { label: '查看', onPress: () => view(item) } });
      }
      await loaded.reload();
    } catch (error) { await failed(error); } finally { pendingRef.current.delete(key); setPending([...pendingRef.current]); }
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
    if (emptying || pendingRef.current.size) { return; }
    if (await showDialog({ title: '清空回收站？', message: `回收站中的 ${loaded.data?.length ?? 0} 项将被彻底删除，无法恢复。`, buttons: [{ key: 'cancel', label: '取消' }, { key: 'empty', label: '清空', style: 'primary' }], dismissKey: 'cancel' }) !== 'empty') { return; }
    setEmptying(true);
    try { await trash.empty(); toast('回收站已清空'); await loaded.reload(); }
    catch (error) { await failed(error); } finally { setEmptying(false); }
  };
  const all = loaded.data ?? [];
  const items = all.filter(item => filter === 'all' || item.kind === filter);
  const countOf = (kind: TrashKind | 'all') => all.filter(item => kind === 'all' || item.kind === kind).length;
  const emptyView = loaded.loading ? <Delayed><SkeletonCards count={3} /></Delayed>
    : loaded.error ? <EmptyState title="回收站没有加载出来。" action={{ label: '重试', onPress: loaded.reload }} />
    : all.length ? <EmptyState title={`没有删除的${filter === 'all' ? '内容' : KIND_NAME[filter]}`} />
    : <EmptyState title="回收站是空的" message="删除的作品、章节和档案条目会在这里保留 30 天。" />;
  return <View style={styles.root}><NavBar title="回收站" onBack={() => { if (!emptying) { navigation.goBack(); } }}
    right={<Button label="清空" variant="text" disabled={emptying || !all.length} onPress={() => { empty(); }} />} />
    <FlatList data={items} keyExtractor={keyOf} contentContainerStyle={styles.content} ListHeaderComponent={<>
      <Txt color={c.ink3}>删除的内容保留 30 天，之后自动彻底删除。</Txt>
      <View style={styles.chips}>{(['all', 'work', 'chapter', 'entry'] as const).map(kind => <Chip key={kind} label={`${kind === 'all' ? '全部' : KIND_NAME[kind]} ${countOf(kind)}`}
        selected={filter === kind} disabled={kind !== 'all' && countOf(kind) === 0 && filter !== kind} onPress={() => setFilter(kind)} />)}</View>
    </>} ListEmptyComponent={emptyView}
    onScrollBeginDrag={swipe.close}
    renderItem={({ item }) => {
      const actions = rowActions(item);
      const busy = pending.includes(keyOf(item));
      const title = trashTitle(item);
      const subtitle = [item.kind === 'work' ? `${item.chapterCount ?? 0} 章` : `${item.parentTitle ?? '未命名作品'}${item.parentDeleted ? '（在回收站）' : ''}`, `删除于 ${formatTime(item.deletedAt)}`];
      return <SwipeRow rowKey={keyOf(item)} group={swipe} actions={actions.filter(a => a.key === 'purge')} disabled={busy || emptying} style={local.item}>
        <Pressable accessibilityLabel={`${title}，${subtitle.join('，')}，还剩 ${item.remainingDays} 天`} accessibilityHint="左滑或长按可彻底删除" {...swipeAccessibility(actions)}
          onPress={() => toast('恢复后才能查看')}
          onLongPress={busy || emptying ? undefined : () => { setMenu(item); setMenuVisible(true); }} delayLongPress={500} style={[styles.card, local.card]}>
          <View style={styles.flex}>
            <View style={styles.row}><Txt variant="headline" numberOfLines={1} style={local.shrink}>{title}</Txt>
              {item.kind === 'entry' && item.entryType ? <Badge label={ENTRY_TYPE_LABELS[item.entryType]} tone="neutral" /> : null}</View>
            <Txt variant="caption" color={c.ink3} numberOfLines={1}>{subtitle.join(' · ')} · <Txt variant="caption" color={item.remainingDays <= 3 ? c.pend : c.ink3}>还剩 {item.remainingDays} 天</Txt></Txt>
          </View>
          <Button label="恢复" variant="secondary" size="small" loading={busy} disabled={emptying} onPress={() => { decide(item); }} />
        </Pressable>
      </SwipeRow>;
    }} />
    <ActionSheet visible={menuVisible} title={menu ? trashTitle(menu) : undefined} items={[{ key: 'restore', label: '恢复' }, { key: 'purge', label: '彻底删除', destructive: true }]}
      onRequestClose={() => setMenuVisible(false)}
      onDone={key => { const item = menu; setMenu(null); if (item && key) { decide(item, key === 'purge'); } }} />
    {emptying ? <BusyOverlay label="正在清空…" /> : null}
  </View>;
}

const local = StyleSheet.create({
  item: { marginBottom: 12, borderRadius: radius.card },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shrink: { flexShrink: 1 },
});
