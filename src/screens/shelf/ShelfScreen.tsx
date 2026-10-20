import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Search, Settings } from 'lucide-react-native';
import { BookCover } from '../../components/BookCover';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { Delayed } from '../../components/Skeleton';
import { NavBar } from '../../components/NavBar';
import { Txt } from '../../components/Text';
import { showErrorDetail } from '../../app/errors';
import { lightHaptic } from '../../app/haptics';
import { useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import * as prefs from '../../features/prefs';
import type { WorkSummary } from '../../features/types';
import * as works from '../../features/works';
import { t } from '../../locales/zh-CN';
import { color as c, maxContentWidth, pageMargin, radius, shadow } from '../../theme/tokens';
import { WorkActionsSheet, openWork } from './WorkActionsSheet';
import { CoverProgress } from '../work/CoverSheet';
import { workMeta, workName, workTime } from './workText';

type Filter = 'all' | 'ongoing' | 'finished';

const COLS = 3;
const COL_GAP = 16;
const ROW_GAP = 24;

/** S03 书架: cover grid, status filter, long-press menu (S03a), search (S03b), new work (S04). */
export function ShelfScreen({ navigation }: RootScreenProps<'Shelf'>) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<WorkSummary>>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [menuWork, setMenuWork] = useState<WorkSummary | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    prefs
      .get('shelfFilter')
      .then(setFilter)
      .catch(() => setFilter('all'));
  }, []);

  const list = useLoad(() => works.list(), [], {
    events: { 'work.created': () => true, 'work.updated': () => true, 'work.removed': () => true },
    refetchOnFocus: true,
  });

  // Returning from a work puts it first; show it (S03 §6). Coming back from
  // search or settings with the same first work keeps the scroll (S03b #3).
  const firstId = list.data?.[0]?.id;
  const shownFirst = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (shownFirst.current !== undefined && firstId !== shownFirst.current) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
    shownFirst.current = firstId;
  }, [firstId]);

  const all = useMemo(() => list.data ?? [], [list.data]);
  const counts = useMemo(
    () => ({
      all: all.length,
      ongoing: all.filter(w => w.status === 'ongoing').length,
      finished: all.filter(w => w.status === 'finished').length,
    }),
    [all],
  );
  const shown = useMemo(() => (filter === 'all' ? all : all.filter(w => w.status === filter)), [all, filter]);

  const choose = useCallback((f: Filter) => {
    setFilter(f);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    prefs.set('shelfFilter', f).catch(() => {});
  }, []);

  const contentWidth = Math.min(width, maxContentWidth);
  const coverWidth = Math.floor((contentWidth - pageMargin * 2 - COL_GAP * (COLS - 1)) / COLS);
  const hasWorks = all.length > 0;
  const now = new Date();

  const openMenu = (w: WorkSummary) => {
    if (menuOpen) {
      return;
    }
    lightHaptic();
    setMenuWork(w);
    setMenuOpen(true);
  };

  const header = (
    <NavBar
      large
      title={t.shelf.title}
      right={
        <>
          {hasWorks ? (
            <IconButton label={t.shelf.search} onPress={() => navigation.navigate('Search')}>
              <Search size={24} color={c.ink} strokeWidth={1.75} />
            </IconButton>
          ) : null}
          <IconButton label={t.shelf.settings} onPress={() => navigation.navigate('Settings')}>
            <Settings size={24} color={c.ink} strokeWidth={1.75} />
          </IconButton>
        </>
      }
    />
  );

  let body: React.ReactNode;
  if (list.loading) {
    // S03 加载中: six grey covers after 300 ms (G01).
    body = (
      <Delayed>
        <View style={[styles.grid, styles.skeleton, { width: contentWidth }]} testID="shelf-skeleton" accessibilityLabel={t.common.loading}>
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={{ width: coverWidth }}>
              <View style={[styles.ghostCover, { width: coverWidth, height: Math.round((coverWidth * 4) / 3) }]} />
              <View style={styles.ghostLine} />
            </View>
          ))}
        </View>
      </Delayed>
    );
  } else if (list.error && !list.data) {
    body = (
      <EmptyState
        title={t.shelf.loadFailed}
        action={{ label: t.common.retry, onPress: list.reload }}
        secondary={{ label: t.common.viewDetail, onPress: () => showErrorDetail(list.error, t.shelf.loadFailed) }}
        style={styles.fill}
      />
    );
  } else if (!hasWorks) {
    body = (
      <EmptyState
        title={t.shelf.emptyTitle}
        action={{ label: t.shelf.newWork, onPress: () => navigation.navigate('NewWork') }}
        secondary={{ label: t.shelf.restore, onPress: () => navigation.navigate('Restore', { from: 'shelf' }) }}
        style={styles.fill}
      />
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        data={shown}
        key={COLS}
        numColumns={COLS}
        keyExtractor={w => w.id}
        style={styles.fill}
        contentContainerStyle={[
          styles.grid,
          { width: contentWidth, paddingBottom: insets.bottom + 96 },
          shown.length === 0 && styles.fill,
        ]}
        columnWrapperStyle={styles.row}
        ItemSeparatorComponent={RowGap}
        initialNumToRender={12}
        windowSize={7}
        ListEmptyComponent={
          <EmptyState
            title={filter === 'finished' ? t.shelf.noFinished : t.shelf.noOngoing}
            action={{ label: t.shelf.showAll, onPress: () => choose('all'), variant: 'secondary' }}
            style={styles.fill}
          />
        }
        ListFooterComponent={
          shown.length > 0 ? (
            <Txt variant="caption" color={c.ink3} style={styles.note}>
              {t.shelf.sortNote}
            </Txt>
          ) : undefined
        }
        renderItem={({ item }) => (
          <Book
            work={item}
            width={coverWidth}
            now={now}
            onPress={() => openWork(navigation, item.id)}
            onLongPress={() => openMenu(item)}
          />
        )}
      />
    );
  }

  return (
    <View style={styles.root}>
      {header}
      {hasWorks ? (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            <Chip label={t.shelf.filterAll(counts.all)} selected={filter === 'all'} onPress={() => choose('all')} />
            <Chip
              label={t.shelf.filterOngoing(counts.ongoing)}
              selected={filter === 'ongoing'}
              onPress={() => choose('ongoing')}
            />
            <Chip
              label={t.shelf.filterFinished(counts.finished)}
              selected={filter === 'finished'}
              onPress={() => choose('finished')}
            />
          </ScrollView>
        </View>
      ) : null}
      <View style={styles.center}>{body}</View>
      {hasWorks ? (
        <Pressable
          onPress={() => navigation.navigate('NewWork')}
          accessibilityRole="button"
          accessibilityLabel={t.shelf.newWork}
          style={({ pressed }) => [
            styles.fab,
            { bottom: insets.bottom + 20, backgroundColor: pressed ? c.brandPress : c.brand },
          ]}
        >
          <Plus size={20} color={c.white} strokeWidth={2} />
          <Txt variant="body" color={c.white} weight="600">
            {t.shelf.newWork}
          </Txt>
        </Pressable>
      ) : null}
      <WorkActionsSheet work={menuWork} visible={menuOpen} onRequestClose={() => setMenuOpen(false)} />
    </View>
  );
}

const RowGap = () => <View style={styles.rowGap} />;

function Book({
  work,
  width,
  now,
  onPress,
  onLongPress,
}: {
  work: WorkSummary;
  width: number;
  now: Date;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const name = workName(work);
  const meta = workMeta(work);
  const time = workTime(work, now);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
      accessibilityRole="button"
      accessibilityLabel={t.shelf.a11yBook(name, meta, time)}
      accessibilityActions={[{ name: 'activate' }, { name: 'longpress', label: t.common.more }]}
      onAccessibilityAction={e => (e.nativeEvent.actionName === 'longpress' ? onLongPress() : onPress())}
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
    >
      <View>
        <BookCover title={work.title} genre={work.genre} cover={work.cover} width={width} version={work.updatedAt} />
        <CoverProgress workId={work.id} />
      </View>
      <Txt variant="callout" weight="600" numberOfLines={1} style={styles.bookTitle}>
        {name}
      </Txt>
      <Txt variant="caption" color={c.ink3} numberOfLines={1}>
        {meta}
      </Txt>
      <Txt variant="caption" color={c.ink3} numberOfLines={1} numeric>
        {time}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center' },
  filters: { paddingHorizontal: pageMargin, paddingVertical: 8, gap: 8 },
  grid: { paddingHorizontal: pageMargin, paddingTop: 12 },
  row: { gap: COL_GAP },
  rowGap: { height: ROW_GAP },
  skeleton: { flexDirection: 'row', flexWrap: 'wrap', columnGap: COL_GAP, rowGap: ROW_GAP },
  ghostCover: { borderRadius: radius.cover, backgroundColor: c.sunken },
  ghostLine: { marginTop: 8, height: 12, width: '70%', borderRadius: radius.small, backgroundColor: c.sunken },
  bookTitle: { marginTop: 8 },
  pressed: { opacity: 0.75 },
  note: { marginTop: 32, textAlign: 'center' },
  fab: {
    position: 'absolute',
    right: 20,
    height: 48,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    ...shadow,
  },
});
