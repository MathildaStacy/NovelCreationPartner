import React, { useEffect, useState } from 'react';
import {
  Pressable,
  SectionList,
  StyleSheet,
  Vibration,
  View,
} from 'react-native';
import { ArrowDownUp, MoreHorizontal, Plus } from 'lucide-react-native';
import { showErrorDetail } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import { useWorkId } from '../../app/navigation/WorkContext';
import type { WorkTabScreenProps } from '../../app/navigation/types';
import { Badge, ChapterBadge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { NavBar } from '../../components/NavBar';
import { Txt } from '../../components/Text';
import * as chapters from '../../features/chapters';
import * as jobs from '../../features/jobs';
import type { ChapterListItem } from '../../features/types';
import { chapterText as text } from '../../locales/chapters';
import { t } from '../../locales/zh-CN';
import { color as c } from '../../theme/tokens';
import { chapterHeading, formatChars, formatTime } from '../../utils/format';
import { ChapterActionsSheet, removeChapter } from './ChapterActionsSheet';
import { ChapterFormSheet } from './ChapterFormSheet';
import { SwipeChapterRow } from './SwipeChapterRow';
import { VolumesSheet } from './VolumesSheet';

function ChapterSkeleton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(timer);
  }, []);
  return show ? (
    <View style={styles.skeletonWrap}>
      {[1, 2, 3].map(n => (
        <View key={n} style={styles.skeletonRow}>
          <View style={styles.skeletonTitle} />
          <View style={styles.skeletonMeta} />
        </View>
      ))}
    </View>
  ) : null;
}

/** S06: service-backed virtualized sections; tab mounting preserves the scroll position. */
export function ChaptersScreen({ navigation }: WorkTabScreenProps<'Chapters'>) {
  const workId = useWorkId();
  const result = useLoad(
    async () => {
      const [groups, activeJobs] = await Promise.all([
        chapters.list(workId),
        jobs.list(workId, { active: true }),
      ]);
      return { groups, activeJobs };
    },
    [workId],
    {
      events: {
        'chapters.changed': p => p.workId === workId,
        'chapter.saved': p => p.workId === workId,
        'conflicts.changed': p => p.workId === workId,
        'jobs.changed': p => p.workId === workId,
      },
      refetchOnFocus: true,
    },
  );
  const [form, setForm] = useState<{
    mode: 'create' | 'edit';
    chapterId?: string;
    volumeId?: string;
  } | null>(null);
  const [menu, setMenu] = useState<ChapterListItem | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [volumesFocus, setVolumesFocus] = useState<string | null>(null);
  const groups = result.data?.groups ?? [];
  const count = groups.reduce((n, g) => n + g.chapters.length, 0);
  const sections = groups.map(g => ({ volume: g.volume, data: g.chapters }));
  const organizing = new Set(
    result.data?.activeJobs
      .filter(j => j.status === 'queued' || j.status === 'running')
      .map(j => j.chapterId),
  );
  const openMenu = (chapter: ChapterListItem) => {
    Vibration.vibrate(8);
    setMenu(chapter);
    setMenuVisible(true);
  };
  return (
    <View style={styles.screen}>
      <NavBar
        title={text.title}
        onBack={() => navigation.popTo('Shelf')}
        backLabel={t.tabs.backToShelf}
        right={
          <View style={styles.navActions}>
            {count >= 2 ? (
              <IconButton
                label={t.chapters.reorder}
                onPress={() => navigation.navigate('Reorder', { workId })}
              >
                <ArrowDownUp size={22} color={c.brand} />
              </IconButton>
            ) : null}
            <IconButton
              label={t.chapters.newChapter}
              onPress={() => setForm({ mode: 'create' })}
            >
              <Plus size={24} color={c.brand} />
            </IconButton>
          </View>
        }
      />
      {result.loading ? (
        <ChapterSkeleton />
      ) : result.error ? (
        <EmptyState
          title={t.chapters.loadFailed}
          action={{ label: t.common.retry, onPress: result.reload }}
          secondary={{
            label: t.common.viewDetail,
            onPress: () => showErrorDetail(result.error, t.chapters.loadFailed),
          }}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          stickySectionHeadersEnabled
          initialNumToRender={15}
          renderSectionHeader={({ section }) => (
            <View style={styles.volumeHeader}>
              <Txt
                variant="callout"
                weight="600"
                style={styles.grow}
                numberOfLines={1}
              >
                {section.volume.title}
              </Txt>
              <Txt variant="caption" color={c.ink3}>
                {t.chapters.volumeMeta(
                  section.data.filter(ch => ch.kind === 'main').length,
                  formatChars(
                    section.data
                      .filter(ch => ch.kind === 'main')
                      .reduce((n, ch) => n + ch.charCount, 0),
                  ),
                )}
              </Txt>
              <IconButton
                label={text.volumeMenu(section.volume.title)}
                onPress={() => setVolumesFocus(section.volume.id)}
              >
                <MoreHorizontal size={22} color={c.ink2} />
              </IconButton>
            </View>
          )}
          renderSectionFooter={({ section }) =>
            section.data.length === 0 ? (
              count === 0 && section.volume.id === groups[0]?.volume.id ? (
                <EmptyState
                  title={t.chapters.emptyTitle}
                  action={{
                    label: t.chapters.newFirst,
                    onPress: () =>
                      setForm({ mode: 'create', volumeId: section.volume.id }),
                  }}
                />
              ) : (
                <View style={styles.emptyVolume}>
                  <Txt variant="callout" color={c.ink3}>
                    {t.chapters.emptyVolume}
                  </Txt>
                  <Button
                    label={t.chapters.createHere}
                    variant="text"
                    onPress={() =>
                      setForm({ mode: 'create', volumeId: section.volume.id })
                    }
                  />
                </View>
              )
            ) : null
          }
          renderItem={({ item }) => (
            <SwipeChapterRow
              onMore={() => openMenu(item)}
              onRemove={() => removeChapter(item)}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={chapterHeading(item)}
                accessibilityHint={text.rowHint}
                onPress={() =>
                  navigation.navigate('Editor', { workId, chapterId: item.id })
                }
                onLongPress={() => openMenu(item)}
                delayLongPress={500}
                style={({ pressed }) => [
                  styles.row,
                  (pressed || menu?.id === item.id) && styles.selected,
                ]}
              >
                <Txt variant="body" weight="600" numberOfLines={1}>
                  {chapterHeading(item)}
                </Txt>
                <View style={styles.meta}>
                  <ChapterBadge kind={item.kind} state={item.state} />
                  {item.openConflictCount > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.chapters.conflicts(
                        item.openConflictCount,
                      )}
                      onPress={() => navigation.navigate('Conflicts', { workId, chapterId: item.id })}
                    >
                      <Badge
                        tone="conflict"
                        label={t.chapters.conflicts(item.openConflictCount)}
                      />
                    </Pressable>
                  ) : null}
                  <Txt variant="caption" color={c.ink3} numeric>
                    {formatChars(item.charCount)}
                  </Txt>
                  <Txt variant="caption" color={c.ink3}>
                    {formatTime(item.updatedAt)}
                  </Txt>
                  {organizing.has(item.id) ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="查看后台任务" onPress={() => navigation.navigate('Jobs', { workId })}><Txt variant="caption" color={c.ink3}>{t.chapters.organizing} ›</Txt></Pressable>
                  ) : null}
                </View>
                {item.summary || item.kind === 'main' ? (
                  <Txt variant="callout" color={c.ink3} numberOfLines={1}>
                    {item.summary ?? t.chapters.noSummary}
                  </Txt>
                ) : null}
              </Pressable>
            </SwipeChapterRow>
          )}
        />
      )}
      {form ? (
        <ChapterFormSheet
          visible
          workId={workId}
          {...form}
          onRequestClose={() => setForm(null)}
          onGone={() => setForm(null)}
          onCreated={chapter => {
            setForm(null);
            navigation.navigate('Editor', {
              workId,
              chapterId: chapter.id,
              focusNonce: Date.now(),
            });
          }}
          onSaved={() => setForm(null)}
        />
      ) : null}
      <ChapterActionsSheet
        chapter={menu}
        groups={groups}
        visible={menuVisible}
        onRequestClose={() => setMenuVisible(false)}
        onDone={() => setMenu(null)}
        onEdit={chapterId => setForm({ mode: 'edit', chapterId })}
      />
      {volumesFocus ? (
        <VolumesSheet
          visible
          workId={workId}
          focusVolumeId={volumesFocus}
          groups={groups}
          onRequestClose={() => setVolumesFocus(null)}
        />
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper },
  navActions: { flexDirection: 'row' },
  grow: { flex: 1 },
  volumeHeader: {
    minHeight: 44,
    paddingLeft: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.paper,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
    gap: 8,
  },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 6,
    backgroundColor: c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  selected: { backgroundColor: c.brandTint },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  emptyVolume: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: c.surface,
  },
  skeletonWrap: { padding: 20, gap: 20 },
  skeletonRow: { gap: 10, paddingVertical: 12 },
  skeletonTitle: {
    width: '70%',
    height: 18,
    backgroundColor: c.sunken,
    borderRadius: 4,
  },
  skeletonMeta: {
    width: '45%',
    height: 14,
    backgroundColor: c.sunken,
    borderRadius: 4,
  },
});
