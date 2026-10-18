import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import { NavBar } from '../../components/NavBar';
import { Txt } from '../../components/Text';
import { EmptyState } from '../../components/EmptyState';
import { DelayedSpinner } from '../../components/Loading';
import { Button } from '../../components/Button';
import { ReasonBadge } from '../../components/Badge';
import { toast } from '../../components/overlay/store';
import { logError, showError, showErrorDetail } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import * as chapters from '../../features/chapters';
import * as versions from '../../features/versions';
import { isAppError } from '../../features/errors';
import type { ChapterVersion } from '../../features/types';
import { t } from '../../locales/zh-CN';
import { color as c, maxContentWidth } from '../../theme/tokens';
import {
  chapterHeading,
  formatChars,
  formatClock,
  formatDay,
} from '../../utils/format';

export function VersionsScreen({
  navigation,
  route,
}: RootScreenProps<'Versions'>) {
  const { chapterId, from } = route.params;
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const loaded = useLoad(
    async () => {
      const [chapter, list] = await Promise.all([
        chapters.get(chapterId),
        versions.list(chapterId),
      ]);
      return { chapter, list };
    },
    [chapterId],
    {
      events: {
        'versions.changed': e => e.chapterId === chapterId,
        'chapter.saved': e => e.chapterId === chapterId,
        'chapters.changed': () => true,
      },
    },
  );
  useEffect(() => {
    if (isAppError(loaded.error, 'NOT_FOUND')) {
      toast(loaded.error.message);
      navigation.goBack();
    }
  }, [loaded.error, navigation]);
  const sections = useMemo(() => {
    const groups: { title: string; data: ChapterVersion[] }[] = [];
    for (const version of loaded.data?.list ?? []) {
      const day = formatDay(version.createdAt);
      const last = groups[groups.length - 1];
      if (last?.title === day) {
        last.data.push(version);
      } else {
        groups.push({ title: day, data: [version] });
      }
    }
    return groups;
  }, [loaded.data?.list]);
  const snapshot = async () => {
    setSaving(true);
    try {
      await versions.snapshot(chapterId, 'manual');
      await loaded.reload();
      toast(t.versions.snapshotDone);
    } catch (e) {
      await showError(e);
    } finally {
      setSaving(false);
    }
  };
  const data = loaded.data;
  return (
    <View style={styles.root}>
      <NavBar title={t.versions.title} onBack={() => navigation.goBack()} />
      {!data ? (
        loaded.loading ? (
          <DelayedSpinner delay={150} />
        ) : (
          <EmptyState
            title={t.versions.loadFailed}
            action={{ label: t.common.retry, onPress: loaded.reload }}
            secondary={{
              label: t.common.viewDetail,
              onPress: () =>
                showErrorDetail(loaded.error, t.versions.loadFailed),
            }}
            style={styles.fill}
          />
        )
      ) : (
        <View style={styles.content}>
          <Txt variant="callout" color={c.ink2} style={styles.summary}>
            {chapterHeading(data.chapter)} ·{' '}
            {t.versions.now(formatChars(data.chapter.charCount))}
          </Txt>
          {sections.length === 0 ? (
            <View style={styles.empty}>
              <EmptyState
                title={t.versions.emptyTitle}
                message={t.versions.emptyBody}
              />
              {data.chapter.charCount > 0 ? (
                <Button
                  label={t.versions.saveNow}
                  onPress={() => snapshot().catch(logError('editor.snapshot'))}
                  variant="secondary"
                  loading={saving}
                />
              ) : null}
            </View>
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={v => v.id}
              stickySectionHeadersEnabled
              renderSectionHeader={({ section }) => (
                <Txt variant="callout" color={c.ink3} style={styles.day}>
                  {section.title}
                </Txt>
              )}
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
              renderItem={({ item }) => {
                const delta = item.charCount - data.chapter.charCount;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${formatDay(
                      item.createdAt,
                    )} ${formatClock(item.createdAt)} ${formatChars(
                      item.charCount,
                    )}`}
                    onPress={() =>
                      navigation.navigate('VersionDiff', {
                        chapterId,
                        versionId: item.id,
                        from,
                      })
                    }
                    style={styles.row}
                  >
                    <View style={styles.fill}>
                      <View style={styles.meta}>
                        <ReasonBadge reason={item.reason} />
                        <Txt variant="caption" color={c.ink3} numeric>
                          {formatClock(item.createdAt)}
                        </Txt>
                        {item.id === data.chapter.finalizedVersionId ? (
                          <Txt variant="caption" color={c.est}>
                            {t.versions.current}
                          </Txt>
                        ) : null}
                      </View>
                      <Txt variant="callout" color={c.ink3}>
                        {delta > 0
                          ? t.versions.more(formatChars(delta))
                          : delta < 0
                          ? t.versions.less(formatChars(-delta))
                          : t.versions.same}
                      </Txt>
                    </View>
                    <Txt variant="callout" color={c.ink2} numeric>
                      {formatChars(item.charCount)}
                    </Txt>
                    <ChevronRight size={18} color={c.ink3} />
                  </Pressable>
                );
              }}
              ListFooterComponent={
                <Txt variant="caption" color={c.ink3} style={styles.retention}>
                  {t.versions.retention}
                </Txt>
              }
            />
          )}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  fill: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  summary: { padding: 20 },
  day: { backgroundColor: c.paper, paddingHorizontal: 20, paddingVertical: 10 },
  row: {
    backgroundColor: c.surface,
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 76,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  retention: { padding: 20 },
});
