import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import {
  CommonActions,
  usePreventRemove,
  type NavigationAction,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavBar } from '../../components/NavBar';
import { Txt } from '../../components/Text';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ReasonBadge } from '../../components/Badge';
import { DelayedSpinner } from '../../components/Loading';
import { showDialog, toast } from '../../components/overlay/store';
import { logError, showError, showErrorDetail } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import * as chapters from '../../features/chapters';
import * as versions from '../../features/versions';
import * as prefs from '../../features/prefs';
import { isAppError } from '../../features/errors';
import { t } from '../../locales/zh-CN';
import { color as c, font, maxContentWidth } from '../../theme/tokens';
import { formatChars, formatDateTime } from '../../utils/format';
import { groupDiff, type DiffRow } from './diffRows';

export function VersionDiffScreen({
  navigation,
  route,
}: RootScreenProps<'VersionDiff'>) {
  const { chapterId, versionId, from } = route.params;
  const insets = useSafeAreaInsets();
  const [restoring, setRestoring] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const listRef = useRef<FlatList<DiffRow>>(null);
  const initialScrollDone = useRef(false);
  const [pendingReset, setPendingReset] = useState<NavigationAction | null>(
    null,
  );
  useEffect(() => {
    if (!restoring && pendingReset) {
      // Let usePreventRemove detach its native guard before removing this screen.
      const timer = setTimeout(() => {
        setPendingReset(null);
        navigation.dispatch(pendingReset);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [restoring, pendingReset, navigation]);
  const loaded = useLoad(
    async () => {
      const [chapter, selected, blocks, fontSize] = await Promise.all([
        chapters.get(chapterId),
        versions.get(versionId),
        versions.diff('current', versionId),
        prefs.get('editorFontSize'),
      ]);
      if (selected.version.chapterId !== chapterId) {
        throw new Error('Version chapter mismatch');
      }
      let finalizedBody: string | null = null;
      if (chapter.finalizedVersionId) {
        finalizedBody = (await versions.get(chapter.finalizedVersionId)).body;
      }
      return { chapter, selected, blocks, fontSize, finalizedBody };
    },
    [chapterId, versionId],
    {
      events: { 'chapter.saved': e => e.chapterId === chapterId },
      refetchOnFocus: true,
    },
  );
  useEffect(() => {
    if (isAppError(loaded.error, 'NOT_FOUND')) {
      toast(t.diff.versionGone);
      navigation.goBack();
    }
  }, [loaded.error, navigation]);
  usePreventRemove(restoring, () => {});
  const rows = useMemo(
    () => groupDiff(loaded.data?.blocks ?? []),
    [loaded.data?.blocks],
  );
  const foldable = rows.filter(row => row.foldable);
  const allExpanded =
    foldable.length > 0 && foldable.every(row => expanded.has(row.key));
  const changed = rows.some(row =>
    row.blocks.some(block => block.type !== 'same'),
  );
  const data = loaded.data;
  const restore = async () => {
    if (!data || restoring || !changed) {
      return;
    }
    const notes: string[] = [];
    if (
      data.chapter.state !== 'draft' &&
      data.finalizedBody !== data.selected.body
    ) {
      notes.push(t.diff.noteModified);
    } else if (
      data.chapter.state === 'modified' &&
      data.finalizedBody === data.selected.body
    ) {
      notes.push(t.diff.noteFinalized);
    }
    if (!data.selected.body) {
      notes.push(t.diff.noteEmpty);
    }
    try {
      const key = await showDialog({
        title: t.diff.confirmTitle,
        message: t.diff.confirmBody(
          formatDateTime(data.selected.version.createdAt),
          data.selected.version.charCount,
          data.chapter.charCount,
        ),
        notes,
        buttons: [
          { key: 'cancel', label: t.common.cancel },
          {
            key: 'restore',
            label: t.diff.restore,
            style: 'primary',
            run: async () => {
              setRestoring(true);
              await versions.restore(chapterId, versionId);
            },
          },
        ],
        dismissKey: 'cancel',
      });
      if (key !== 'restore') {
        return;
      }
      // Remove both history pages. When restoring from a list, create an editor above that list.
      const state = navigation.getState();
      const editorIndex =
        from === 'editor'
          ? state.routes.findIndex(
              r =>
                r.name === 'Editor' &&
                (r.params as { chapterId?: string } | undefined)?.chapterId ===
                  chapterId,
            )
          : -1;
      const nextRoutes =
        editorIndex >= 0
          ? state.routes.slice(0, editorIndex + 1)
          : state.routes.filter(
              r => r.name !== 'Versions' && r.name !== 'VersionDiff',
            );
      const params = {
        chapterId,
        workId: data.chapter.workId,
        restored: true,
        focusNonce: Date.now(),
      };
      if (editorIndex >= 0) {
        nextRoutes[editorIndex] = { ...nextRoutes[editorIndex], params };
      } else {
        nextRoutes.push({
          key: `Editor-${chapterId}-${Date.now()}`,
          name: 'Editor',
          params,
        });
      }
      setPendingReset(
        CommonActions.reset({
          ...state,
          routes: nextRoutes,
          index: nextRoutes.length - 1,
        }),
      );
      setRestoring(false);
    } catch (e) {
      setRestoring(false);
      if (isAppError(e, 'NOT_FOUND')) {
        toast(t.diff.versionGone);
        navigation.goBack();
      } else if (isAppError(e, 'STORAGE_FULL')) {
        await showDialog({
          title: t.diff.confirmTitle,
          message: t.diff.storageFull,
          buttons: [{ key: 'ok', label: t.common.gotIt, style: 'primary' }],
          dismissKey: 'ok',
        });
      } else {
        await showError(e, { title: t.diff.loadFailed });
      }
    }
  };
  const statistics = data
    ? {
        added: data.blocks.filter(b => b.type === 'added').length,
        removed: data.blocks.filter(b => b.type === 'removed').length,
        changed: data.blocks.filter(b => b.type === 'changed').length,
      }
    : null;
  const size = data?.fontSize === 16 ? 15 : data?.fontSize === 20 ? 18 : 16;
  return (
    <View style={styles.root}>
      <NavBar
        title={t.diff.title}
        onBack={() => navigation.goBack()}
        right={
          foldable.length ? (
            <Button
              label={allExpanded ? t.diff.collapseAll : t.diff.expandAll}
              variant="text"
              onPress={() =>
                setExpanded(
                  allExpanded ? new Set() : new Set(foldable.map(r => r.key)),
                )
              }
            />
          ) : undefined
        }
      />
      {!data ? (
        loaded.loading ? (
          <DelayedSpinner delay={150} />
        ) : (
          <EmptyState
            title={t.diff.loadFailed}
            action={{ label: t.common.retry, onPress: loaded.reload }}
            secondary={{
              label: t.common.viewDetail,
              onPress: () => showErrorDetail(loaded.error, t.diff.loadFailed),
            }}
            style={styles.fill}
          />
        )
      ) : (
        <View style={styles.content}>
          <View style={styles.info}>
            <View style={styles.meta}>
              <ReasonBadge reason={data.selected.version.reason} />
              <Txt variant="caption" color={c.ink3}>
                {formatDateTime(data.selected.version.createdAt)} ·{' '}
                {formatChars(data.selected.version.charCount)}
              </Txt>
            </View>
            {changed && statistics ? (
              <Txt variant="callout" color={c.ink2}>
                {data.chapter.body
                  ? t.diff.stats(
                      statistics.added,
                      statistics.removed,
                      statistics.changed,
                    )
                  : t.diff.nowEmpty}
              </Txt>
            ) : null}
          </View>
          {changed ? (
            <View style={styles.legend}>
              <Txt variant="caption" style={styles.added}>
                {t.diff.legendBack}
              </Txt>
              <Txt variant="caption" style={styles.removedLegend}>
                {t.diff.legendGone}
              </Txt>
              <Txt variant="caption" color={c.ink2}>
                {t.diff.legendChanged}
              </Txt>
            </View>
          ) : null}
          {changed ? (
            <FlatList
              ref={listRef}
              data={rows}
              keyExtractor={row => row.key}
              initialNumToRender={15}
              contentContainerStyle={styles.blocks}
              onContentSizeChange={() => {
                if (initialScrollDone.current) {
                  return;
                }
                const index = rows.findIndex(row => row.firstChange);
                if (index >= 0) {
                  initialScrollDone.current = true;
                  listRef.current?.scrollToIndex({
                    index,
                    animated: false,
                    viewOffset: 12,
                  });
                }
              }}
              onScrollToIndexFailed={info => {
                listRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: false,
                });
              }}
              renderItem={({ item }) =>
                item.foldable && !expanded.has(item.key) ? (
                  <Pressable
                    style={styles.fold}
                    accessibilityRole="button"
                    onPress={() =>
                      setExpanded(prev => new Set([...prev, item.key]))
                    }
                  >
                    <Txt variant="callout" color={c.ink3} align="center">
                      {t.diff.folded(item.blocks.length)}
                    </Txt>
                  </Pressable>
                ) : (
                  <View>
                    {item.blocks.map((block, i) => (
                      <DiffParagraph key={i} block={block} size={size} />
                    ))}
                  </View>
                )
              }
            />
          ) : (
            <EmptyState title={t.diff.identical} style={styles.fill} />
          )}
          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            {!changed ? (
              <Txt variant="caption" color={c.ink3} align="center">
                {t.diff.sameAsNow}
              </Txt>
            ) : null}
            <Button
              label={t.diff.restore}
              disabled={!changed || restoring}
              loading={restoring}
              onPress={() => restore().catch(logError('editor.restore'))}
            />
          </View>
        </View>
      )}
    </View>
  );
}
function DiffParagraph({
  block,
  size,
}: {
  block: versions.DiffBlock;
  size: number;
}) {
  const text = block.type === 'removed' ? block.a : block.b;
  if (block.type !== 'changed' && !text) {
    return <View style={{ height: size * 1.9 }} />;
  }
  return (
    <Txt
      selectable
      variant="prose"
      style={[
        styles.paragraph,
        { fontSize: size, lineHeight: size * 1.9, fontFamily: font.serif },
        block.type === 'added' && styles.added,
        block.type === 'removed' && styles.removed,
      ]}
    >
      {'　　'}
      {block.type === 'changed'
        ? block.inline.map((part, i) => (
            <Txt
              key={i}
              variant="prose"
              style={[
                { fontSize: size, lineHeight: size * 1.9 },
                part.type === 'added' && styles.added,
                part.type === 'removed' && styles.removed,
              ]}
            >
              {part.text}
            </Txt>
          ))
        : text}
    </Txt>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.surface },
  fill: { flex: 1 },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  info: { padding: 20, gap: 12 },
  meta: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  legend: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  added: { backgroundColor: c.estTint },
  removed: {
    backgroundColor: c.confTint,
    color: c.ink2,
    textDecorationLine: 'line-through',
  },
  removedLegend: { backgroundColor: c.confTint },
  blocks: { padding: 20 },
  paragraph: { marginBottom: 8 },
  fold: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: c.line,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
    marginVertical: 12,
    padding: 8,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    padding: 20,
    gap: 8,
  },
});
