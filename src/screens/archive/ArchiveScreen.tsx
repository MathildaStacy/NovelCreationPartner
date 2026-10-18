import React, { useEffect, useState } from 'react';
import { BackHandler, FlatList, View } from 'react-native';
import { useLoad } from '../../app/hooks';
import type { WorkTabScreenProps } from '../../app/navigation/types';
import { useWorkId } from '../../app/navigation/WorkContext';
import { showErrorDetail } from '../../app/errors';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { DelayedSpinner } from '../../components/Loading';
import { NavBar } from '../../components/NavBar';
import { TextField } from '../../components/TextField';
import { Txt } from '../../components/Text';
import * as entries from '../../features/entries';
import type { EntryType, MemoryState } from '../../features/types';
import { archiveText as a } from '../../locales/archive';
import { t } from '../../locales/zh-CN';
import { EntryRow, STATE_LABEL, styles } from './shared';

const types = ['character', 'world', 'place', 'faction', 'rule', 'foreshadow'] as const;
const filters: (MemoryState | 'all')[] = ['all', 'PROPOSED', 'CONFLICTED', 'RETIRED'];

/** S11 stays mounted across work tabs so category, filter and scroll are retained. */
export function ArchiveScreen({ navigation, route }: WorkTabScreenProps<'Archive'>) {
  const workId = useWorkId();
  const [type, setType] = useState<EntryType>(route.params?.type ?? 'character');
  const [state, setState] = useState<MemoryState | 'all'>('all');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    if (route.params?.type) { setType(route.params.type); setState('all'); }
  }, [route.params?.type]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!searching) { return; }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setSearching(false); setQuery(''); return true; });
    return () => sub.remove();
  }, [searching]);
  const loaded = useLoad(async () => ({
    counts: await entries.counts(workId),
    list: searching ? debounced ? await entries.search(workId, debounced) : [] : await entries.list(workId, {
      type, states: state === 'all' ? undefined : [state], includeRetired: state === 'RETIRED',
    }),
  }), [workId, type, state, searching, debounced], {
    events: { 'entries.changed': e => e.workId === workId, 'proposals.changed': e => e.workId === workId,
      'conflicts.changed': e => e.workId === workId, 'chapters.changed': e => e.workId === workId }, refetchOnFocus: true,
  });
  const add = (name?: string) => navigation.navigate('EntryForm', { workId, type, name });
  const count = loaded.data?.counts;
  const states = count?.byState[type];
  const total = states ? Object.entries(states).reduce((n, [key, value]) => key === 'RETIRED' ? n : n + value, 0) : 0;
  return <View style={styles.root}>
    <NavBar title={a.title} backLabel={t.tabs.backToShelf} onBack={() => navigation.popTo('Shelf')}
      right={<Button label={searching ? t.common.cancel : a.search} variant="text" onPress={() => { setSearching(v => !v); setQuery(''); }} />} />
    {searching ? <View style={styles.content}><TextField value={query} onChangeText={setQuery} max={30} clearable
      autoFocus placeholder={a.searchPlaceholder} accessibilityLabel={a.searchPlaceholder} /></View> : <View style={styles.content}>
      <View style={styles.chips}>{types.map(key => <Chip key={key} label={`${entries.ENTRY_TYPE_LABELS[key]} ${count?.byType[key] ?? 0}`}
        selected={type === key} onPress={() => { setType(key); setState('all'); }} />)}</View>
      <View style={styles.chips}>{filters.map(key => <Chip key={key} label={`${key === 'all' ? a.all : STATE_LABEL[key]} ${key === 'all' ? total : states?.[key] ?? 0}`}
        selected={state === key} disabled={key !== 'all' && state !== key && !states?.[key]} onPress={() => setState(key)} />)}</View>
    </View>}
    {loaded.loading ? <DelayedSpinner /> : loaded.error ? <EmptyState title={a.loadFailed} style={styles.flex}
      action={{ label: t.common.retry, onPress: loaded.reload }} secondary={{ label: t.common.viewDetail, onPress: () => showErrorDetail(loaded.error, a.loadFailed) }} /> :
      <FlatList data={loaded.data?.list ?? []} keyExtractor={item => item.id} contentContainerStyle={styles.content}
        renderItem={({ item }) => <EntryRow item={item} showType={searching} onPress={() => navigation.navigate('EntryDetail', { entryId: item.id })} />}
        ListEmptyComponent={<EmptyState title={searching ? debounced ? `没有找到「${debounced}」相关的条目。` : '输入名称、别名或内容' : total === 0 ? `还没有${entries.ENTRY_TYPE_LABELS[type]}。` : '没有符合条件的条目。'}
          action={searching && !debounced ? undefined : { label: searching ? '添加为条目' : `添加${entries.ENTRY_TYPE_LABELS[type]}`, onPress: () => add(searching ? debounced : undefined) }} />}
        ListFooterComponent={searching && (loaded.data?.list.length ?? 0) >= 100 ? <Txt>只显示前 100 条，请输入更具体的关键词</Txt> : undefined} />}
    {!searching ? <View style={styles.picker}><Button label={a.add} onPress={() => add()} /></View> : null}
  </View>;
}
