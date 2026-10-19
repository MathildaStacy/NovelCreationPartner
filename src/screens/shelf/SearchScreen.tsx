import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleX, Search } from 'lucide-react-native';
import { BookCover } from '../../components/BookCover';
import { Txt } from '../../components/Text';
import { logError, showError } from '../../app/errors';
import { lightHaptic } from '../../app/haptics';
import type { RootScreenProps } from '../../app/navigation/types';
import { on } from '../../features/events';
import type { WorkSummary } from '../../features/types';
import * as works from '../../features/works';
import { t } from '../../locales/zh-CN';
import { color as c, hitSize, maxFontSizeMultiplier, pageMargin, radius, rowMinHeight, type } from '../../theme/tokens';
import { truncate } from '../../utils/format';
import { WorkActionsSheet } from './WorkActionsSheet';
import { searchMeta, workName } from './workText';

const MAX_QUERY = 50;
const DEBOUNCE = 300;

/** First case-insensitive match of `q` in `s` (S03b §4), in UTF-16 offsets. */
export function findMatch(s: string, q: string): { start: number; end: number } | null {
  if (!q) {
    return null;
  }
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  return i < 0 ? null : { start: i, end: i + q.length };
}

/** ~30 characters around the first premise hit, "……" where cut (S03b #6). */
export function excerptAround(s: string, m: { start: number; end: number }, width = 30) {
  const flat = s.replace(/\n+/g, ' ');
  const half = Math.max(0, Math.floor((width - (m.end - m.start)) / 2));
  const from = Math.max(0, m.start - half);
  const to = Math.min(flat.length, m.end + half);
  return {
    before: (from > 0 ? '……' : '') + flat.slice(from, m.start),
    hit: flat.slice(m.start, m.end),
    after: flat.slice(m.end, to) + (to < flat.length ? '……' : ''),
  };
}

/** S03b 搜索作品: matches title, premise and genre name; same order as the shelf. */
export function SearchScreen({ navigation }: RootScreenProps<'Search'>) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [results, setResults] = useState<WorkSummary[] | null>(null);
  const [menuWork, setMenuWork] = useState<WorkSummary | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [slow, setSlow] = useState(false);
  const seq = useRef(0);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const query = text.trim();
  const queryRef = useRef(query);
  queryRef.current = query;

  const run = useRef(async (q: string) => {
    const my = ++seq.current;
    if (slowTimer.current) { clearTimeout(slowTimer.current); }
    setSlow(false);
    if (!q) {
      setResults(null);
      return;
    }
    // S03b 搜索中: keep the last results; a small indicator only after 300 ms.
    slowTimer.current = setTimeout(() => { if (my === seq.current) { setSlow(true); } }, 300);
    try {
      const r = await works.list({ query: q });
      if (my === seq.current) {
        setResults(r);
      }
    } catch (e) {
      if (my === seq.current) {
        showError(e);
      }
    } finally {
      if (my === seq.current) {
        if (slowTimer.current) { clearTimeout(slowTimer.current); }
        setSlow(false);
      }
    }
  }).current;

  useEffect(() => () => { if (slowTimer.current) { clearTimeout(slowTimer.current); } }, []);

  // 读屏: announce each finished search (S03b, G01 无障碍).
  useEffect(() => {
    if (results) {
      AccessibilityInfo.announceForAccessibility(results.length ? t.search.found(results.length) : t.search.noneA11y);
    }
  }, [results]);

  useEffect(() => {
    if (!query) {
      ++seq.current;
      setResults(null);
      return;
    }
    const timer = setTimeout(() => run(query), DEBOUNCE);
    return () => clearTimeout(timer);
  }, [query, run]);

  useEffect(() => {
    const again = () => queryRef.current && run(queryRef.current);
    const offs = [on('work.created', again), on('work.updated', again), on('work.removed', again)];
    return () => offs.forEach(off => off());
  }, [run]);

  const change = (v: string) => setText(Array.from(v).slice(0, MAX_QUERY).join(''));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <View style={styles.inputBox}>
          <Search size={18} color={c.ink3} />
          <TextInput
            autoFocus
            value={text}
            onChangeText={change}
            placeholder={t.search.placeholder}
            placeholderTextColor={c.ink3}
            returnKeyType="search"
            onSubmitEditing={() => {
              run(query);
              Keyboard.dismiss();
            }}
            maxFontSizeMultiplier={maxFontSizeMultiplier}
            selectionColor={c.brand}
            style={styles.input}
            accessibilityLabel={t.search.placeholder}
          />
          {text ? (
            <Pressable onPress={() => setText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="清除">
              <CircleX size={18} color={c.ink3} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          hitSlop={6}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
        >
          <Txt variant="body" color={c.brand}>
            {t.common.cancel}
          </Txt>
        </Pressable>
      </View>

      {slow && (results == null || results.length === 0) ? (
        <View style={styles.count}><ActivityIndicator size="small" color={c.ink3} accessibilityLabel={t.search.searching} /></View>
      ) : null}
      {results == null ? null : results.length === 0 ? (
        <View style={styles.none} accessibilityLiveRegion="polite">
          <Txt variant="body" weight="600" align="center">
            {t.search.none(truncate(query, 10))}
          </Txt>
          <Txt variant="callout" color={c.ink3} align="center">
            {t.search.noneHint}
          </Txt>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={w => w.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={
            <View style={[styles.count, styles.countRow]}>
              <Txt variant="caption" color={c.ink3} accessibilityLiveRegion="polite">
                {t.search.found(results.length)}
              </Txt>
              {slow ? <ActivityIndicator size="small" color={c.ink3} accessibilityLabel={t.search.searching} /> : null}
            </View>
          }
          renderItem={({ item }) => (
            <ResultRow
              work={item}
              query={query}
              onPress={() => {
                Keyboard.dismiss();
                // Replace the search page so returning from the work lands on the shelf (S03b #5).
                works.touch(item.id).catch(logError('works.touch'));
                navigation.replace('Work', { workId: item.id });
              }}
              onLongPress={() => {
                if (!menuOpen) {
                  lightHaptic();
                  setMenuWork(item);
                  setMenuOpen(true);
                }
              }}
            />
          )}
        />
      )}
      <WorkActionsSheet work={menuWork} visible={menuOpen} onRequestClose={() => setMenuOpen(false)} />
    </View>
  );
}

function Highlighted({ before, hit, after, serif }: { before: string; hit: string; after: string; serif?: boolean }) {
  return (
    <Txt variant="callout" color={c.ink2} numberOfLines={1} style={serif ? styles.serif : null}>
      {before}
      <Txt variant="callout" color={c.ink} weight="600" style={styles.mark}>
        {hit}
      </Txt>
      {after}
    </Txt>
  );
}

function ResultRow({
  work,
  query,
  onPress,
  onLongPress,
}: {
  work: WorkSummary;
  query: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const name = workName(work);
  const meta = searchMeta(work);
  const titleHit = work.title ? findMatch(work.title, query) : null;
  const premiseHit = titleHit ? null : findMatch(work.premise, query);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
      accessibilityRole="button"
      accessibilityLabel={`${name}，${meta.replace(/ · /g, '，')}`}
      accessibilityActions={[{ name: 'activate' }, { name: 'longpress', label: t.common.more }]}
      onAccessibilityAction={e => (e.nativeEvent.actionName === 'longpress' ? onLongPress() : onPress())}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <BookCover title={work.title} genre={work.genre} cover={work.cover} width={30} version={work.updatedAt} />
      <View style={styles.rowText}>
        {titleHit && work.title ? (
          <Txt variant="body" weight="600" numberOfLines={1}>
            {work.title.slice(0, titleHit.start)}
            <Txt variant="body" weight="600" style={styles.mark}>
              {work.title.slice(titleHit.start, titleHit.end)}
            </Txt>
            {work.title.slice(titleHit.end)}
          </Txt>
        ) : (
          <Txt variant="body" weight="600" numberOfLines={1}>
            {name}
          </Txt>
        )}
        <Txt variant="caption" color={c.ink3} numberOfLines={1}>
          {meta}
        </Txt>
        {premiseHit ? <Highlighted {...excerptAround(work.premise, premiseHit)} serif /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  bar: { flexDirection: 'row', alignItems: 'center', paddingLeft: pageMargin, paddingRight: 8, paddingVertical: 6, gap: 4 },
  inputBox: {
    flex: 1,
    height: 40,
    borderRadius: radius.field,
    backgroundColor: c.sunken,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  input: { flex: 1, padding: 0, fontSize: type.body.fontSize, color: c.ink },
  cancel: { minHeight: hitSize, paddingHorizontal: 10, justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  count: { paddingHorizontal: pageMargin, paddingTop: 12, paddingBottom: 4 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mark: { backgroundColor: c.mark },
  none: { paddingHorizontal: 32, paddingTop: 80, gap: 8 },
  row: {
    minHeight: rowMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: pageMargin,
    paddingVertical: 10,
  },
  rowPressed: { backgroundColor: c.sunken },
  rowText: { flex: 1, gap: 2 },
  serif: { fontFamily: type.prose.fontFamily },
});
