import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { GripHorizontal } from 'lucide-react-native';
import { showError, toAppError } from '../../app/errors';
import { useDirtyGuard } from '../../app/hooks';
import { lightHaptic } from '../../app/haptics';
import type { RootScreenProps } from '../../app/navigation/types';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { DelayedSpinner } from '../../components/Loading';
import { NavBar } from '../../components/NavBar';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import * as chapters from '../../features/chapters';
import type { ChapterListItem } from '../../features/types';
import { chapterText as text } from '../../locales/chapters';
import { t } from '../../locales/zh-CN';
import { color as c, shadow } from '../../theme/tokens';
import { chapterHeading } from '../../utils/format';
import {
  layoutOf,
  moveChapter,
  previewNumbers,
  sameLayout,
  type ChapterGroup,
  type ChapterLayout,
} from './chapterLayout';

type Row = {
  key: string;
  volumeId: string;
  kind: 'header' | 'chapter' | 'empty';
  chapterId?: string;
  index: number;
  top: number;
  height: number;
};
const ROW_HEIGHT = 58;

function rowsOf(layout: ChapterLayout): Row[] {
  let top = 0;
  const rows: Row[] = [];
  layout.forEach(group => {
    rows.push({
      key: `v:${group.volumeId}`,
      volumeId: group.volumeId,
      kind: 'header',
      index: 0,
      top,
      height: 44,
    });
    top += 44;
    if (!group.chapterIds.length) {
      rows.push({
        key: `e:${group.volumeId}`,
        volumeId: group.volumeId,
        kind: 'empty',
        index: 0,
        top,
        height: 64,
      });
      top += 64;
    }
    group.chapterIds.forEach((id, index) => {
      rows.push({
        key: id,
        chapterId: id,
        volumeId: group.volumeId,
        kind: 'chapter',
        index,
        top,
        height: ROW_HEIGHT,
      });
      top += ROW_HEIGHT;
    });
  });
  return rows;
}

/** S06d: only the handle starts dragging. All movement is local until 完成. */
export function ReorderScreen({
  navigation,
  route,
}: RootScreenProps<'Reorder'>) {
  const workId = route.params.workId;
  const [groups, setGroups] = useState<ChapterGroup[]>([]);
  const [layout, setLayout] = useState<ChapterLayout>([]);
  const [original, setOriginal] = useState<ChapterLayout>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const live = useRef(true);
  const load = async () => {
    setLoading(true);
    try {
      const result = await chapters.list(workId);
      if (!live.current) {
        return;
      }
      const next = layoutOf(result);
      setGroups(result);
      setLayout(next);
      setOriginal(next);
      setError(null);
    } catch (e) {
      if (live.current) {
        setError(e);
      }
    } finally {
      if (live.current) {
        setLoading(false);
      }
    }
  };
  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
    // The opening layout remains the baseline, even if chapter events arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);
  const dirty = !sameLayout(layout, original);
  usePreventRemove(busy || !!dragging, () => {});
  const leave = useDirtyGuard(dirty && !busy && !dragging, {
    title: t.reorder.discardTitle,
    body: t.reorder.discardBody,
    discard: t.reorder.discard,
  });
  const byId = useMemo(
    () => new Map(groups.flatMap(g => g.chapters).map(ch => [ch.id, ch])),
    [groups],
  );
  const numbers = useMemo(() => previewNumbers(layout, byId), [layout, byId]);
  const rows = useMemo(() => rowsOf(layout), [layout]);
  const list = useRef<FlatList<Row>>(null);
  const area = useRef<React.ComponentRef<typeof View>>(null);
  const viewport = useRef({ y: 0, height: 0 });
  const offset = useRef(0);
  const contentHeight = useRef(0);
  const finger = useRef(0);
  const dragTop = useRef(new Animated.Value(0)).current;
  const current = useRef({ layout, rows });
  current.current = { layout, rows };
  const moveAtFinger = () => {
    if (!dragRef.current) {
      return;
    }
    const y = finger.current - viewport.current.y;
    dragTop.setValue(
      Math.max(
        -ROW_HEIGHT / 2,
        Math.min(viewport.current.height - ROW_HEIGHT / 2, y - ROW_HEIGHT / 2),
      ),
    );
    const position = y + offset.current;
    const available = current.current.rows;
    const target =
      available.find(row => position < row.top + row.height) ??
      available[available.length - 1];
    if (!target) {
      return;
    }
    const insertion =
      target.kind === 'chapter'
        ? target.index + (position > target.top + target.height / 2 ? 1 : 0)
        : 0;
    const next = moveChapter(
      current.current.layout,
      dragRef.current,
      target.volumeId,
      insertion,
    );
    if (next !== current.current.layout) {
      current.current = { layout: next, rows: rowsOf(next) };
      setLayout(next);
    }
  };
  const finishDrag = () => {
    dragRef.current = null;
    setDragging(null);
  };
  const actions = useRef({ moveAtFinger, finishDrag });
  actions.current = { moveAtFinger, finishDrag };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: () => !!dragRef.current,
      onPanResponderMove: (_event, gesture) => {
        finger.current = gesture.moveY;
        actions.current.moveAtFinger();
      },
      onPanResponderRelease: () => actions.current.finishDrag(),
      onPanResponderTerminate: () => actions.current.finishDrag(),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;
  useEffect(() => {
    if (!dragging) {
      return;
    }
    const timer = setInterval(() => {
      const y = finger.current - viewport.current.y;
      const edge = 64;
      const dy =
        y < edge
          ? -Math.min(20, (edge - y) / 3)
          : y > viewport.current.height - edge
          ? Math.min(20, (y - viewport.current.height + edge) / 3)
          : 0;
      if (!dy) {
        return;
      }
      const next = Math.max(
        0,
        Math.min(
          Math.max(0, contentHeight.current - viewport.current.height),
          offset.current + dy,
        ),
      );
      if (next !== offset.current) {
        offset.current = next;
        list.current?.scrollToOffset({ offset: next, animated: false });
        actions.current.moveAtFinger();
      }
    }, 30);
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        finishDrag();
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [dragging]);
  const startDrag = (id: string, pageY: number) => {
    if (busyRef.current || dragRef.current) {
      return;
    }
    dragRef.current = id;
    finger.current = pageY;
    setDragging(id);
    lightHaptic();
    dragTop.setValue(pageY - viewport.current.y - ROW_HEIGHT / 2);
  };
  const accessibleMove = (id: string, direction: number) => {
    if (busyRef.current || dragRef.current) {
      return;
    }
    const gi = layout.findIndex(g => g.chapterIds.includes(id));
    const group = layout[gi];
    if (!group) {
      return;
    }
    const i = group.chapterIds.indexOf(id);
    if (direction < 0 && i > 0) {
      setLayout(moveChapter(layout, id, group.volumeId, i - 1));
    } else if (direction > 0 && i < group.chapterIds.length - 1) {
      setLayout(moveChapter(layout, id, group.volumeId, i + 2));
    } else {
      const neighbor = layout[gi + direction];
      if (neighbor) {
        setLayout(
          moveChapter(
            layout,
            id,
            neighbor.volumeId,
            direction < 0 ? neighbor.chapterIds.length : 0,
          ),
        );
      }
    }
  };
  const save = async () => {
    if (busyRef.current || dragRef.current) {
      return;
    }
    if (!dirty) {
      leave(() => navigation.goBack());
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await chapters.reorder(workId, layout);
      toast(t.reorder.saved);
      busyRef.current = false;
      leave(() => navigation.goBack());
    } catch (e) {
      if (
        toAppError(e).code === 'VALIDATION' ||
        toAppError(e).code === 'CONFLICT_STATE'
      ) {
        toast(t.reorder.changed);
        await load();
      } else {
        showError(e);
      }
    } finally {
      busyRef.current = false;
      if (live.current) {
        setBusy(false);
      }
    }
  };
  const heading = (ch: ChapterListItem) =>
    chapterHeading({ ...ch, number: numbers.get(ch.id) ?? null });
  return (
    <View style={styles.screen}>
      <NavBar
        title={text.reorderTitle}
        left={
          <Button
            label={t.common.cancel}
            variant="text"
            onPress={() => navigation.goBack()}
            disabled={busy || !!dragging}
          />
        }
        right={
          <Button
            label={t.common.done}
            variant="text"
            loading={busy}
            disabled={loading || !!dragging}
            onPress={save}
          />
        }
      />
      <Txt variant="caption" color={c.ink3} style={styles.note}>
        {t.reorder.note}
      </Txt>
      {loading ? (
        <DelayedSpinner />
      ) : error ? (
        <EmptyState
          title={t.chapters.loadFailed}
          action={{ label: t.common.retry, onPress: load }}
        />
      ) : (
        <View
          ref={area}
          style={styles.grow}
          {...pan.panHandlers}
          onTouchEnd={() => {
            if (dragRef.current) {
              finishDrag();
            }
          }}
          onLayout={() =>
            area.current?.measureInWindow((_x, y, _w, height) => {
              viewport.current = { y, height };
            })
          }
        >
          <FlatList
            ref={list}
            data={rows}
            keyExtractor={row => row.key}
            extraData={{ dragging, numbers, busy }}
            scrollEnabled={!dragging}
            initialNumToRender={20}
            getItemLayout={(_data, index) => ({
              length: rows[index].height,
              offset: rows[index].top,
              index,
            })}
            onScroll={e => {
              offset.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            onContentSizeChange={(_width, height) => {
              contentHeight.current = height;
            }}
            renderItem={({ item }) => {
              if (item.kind === 'header') {
                return (
                  <View style={styles.header}>
                    <Txt
                      variant="callout"
                      weight="600"
                      style={styles.grow}
                      numberOfLines={1}
                    >
                      {
                        groups.find(g => g.volume.id === item.volumeId)?.volume
                          .title
                      }
                    </Txt>
                    <Txt variant="caption" color={c.ink3}>
                      {t.reorder.volumeCount(
                        layout.find(g => g.volumeId === item.volumeId)
                          ?.chapterIds.length ?? 0,
                      )}
                    </Txt>
                  </View>
                );
              }
              if (item.kind === 'empty') {
                return (
                  <View style={styles.empty}>
                    <Txt variant="caption" color={c.ink3}>
                      {t.reorder.dropHere}
                    </Txt>
                  </View>
                );
              }
              const chapter = byId.get(item.chapterId!)!;
              const n = numbers.get(chapter.id);
              return (
                <View
                  style={[
                    styles.row,
                    dragging === chapter.id && styles.placeholder,
                  ]}
                >
                  <View style={styles.grow}>
                    <Txt variant="body" numberOfLines={1}>
                      {heading(chapter)}
                    </Txt>
                    {chapter.kind === 'main' &&
                    n !== chapter.number &&
                    chapter.number != null ? (
                      <Txt variant="caption" color={c.ink3}>
                        {t.reorder.was(chapter.number)}
                      </Txt>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityRole="adjustable"
                    accessibilityLabel={text.moveA11y(heading(chapter))}
                    accessibilityActions={[
                      { name: 'decrement', label: t.reorder.moveUp },
                      { name: 'increment', label: t.reorder.moveDown },
                    ]}
                    onAccessibilityAction={e =>
                      accessibleMove(
                        chapter.id,
                        e.nativeEvent.actionName === 'decrement' ? -1 : 1,
                      )
                    }
                    disabled={busy}
                    onPress={() => {}}
                    onLongPress={e =>
                      startDrag(chapter.id, e.nativeEvent.pageY)
                    }
                    delayLongPress={250}
                    style={styles.handle}
                  >
                    <GripHorizontal size={24} color={c.ink3} />
                  </Pressable>
                </View>
              );
            }}
          />
          {dragging && byId.has(dragging) ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.floating,
                { transform: [{ translateY: dragTop }, { scale: 1.02 }] },
              ]}
            >
              <Txt variant="body" numberOfLines={1} style={styles.grow}>
                {heading(byId.get(dragging)!)}
              </Txt>
              <GripHorizontal size={24} color={c.brand} />
            </Animated.View>
          ) : null}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper },
  grow: { flex: 1 },
  note: { padding: 16, backgroundColor: c.surface },
  header: {
    height: 44,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.paper,
  },
  row: {
    height: ROW_HEIGHT,
    backgroundColor: c.surface,
    paddingLeft: 20,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  handle: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: { opacity: 0.2, backgroundColor: c.brandTint },
  empty: {
    height: 64,
    marginHorizontal: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floating: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    height: ROW_HEIGHT,
    paddingHorizontal: 16,
    backgroundColor: c.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 8,
    ...shadow,
  },
});
