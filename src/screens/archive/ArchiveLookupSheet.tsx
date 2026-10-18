import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { showErrorDetail } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { DelayedSpinner } from '../../components/Loading';
import { Sheet } from '../../components/Sheet';
import { TextField } from '../../components/TextField';
import { Txt } from '../../components/Text';
import * as entries from '../../features/entries';
import * as chapters from '../../features/chapters';
import type { EntryDetail } from '../../features/types';
import { archiveText as a } from '../../locales/archive';
import { t } from '../../locales/zh-CN';
import { color as c } from '../../theme/tokens';
import { MemoryBadge, styles } from './shared';

/** S07c receives the editor's in-memory storage body, never a stale database body. */
export function ArchiveLookupSheet({ visible, workId, chapterId, body, onClose, onOpen }: {
  visible: boolean; workId: string; chapterId: string; body: string; onClose: () => void; onOpen: (entryId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setQuery(''); setDebounced(''); setExpanded(null); setDetail(null); } }, [visible]);
  useEffect(() => { const timer = setTimeout(() => { setDebounced(query.trim()); setExpanded(null); }, 300); return () => clearTimeout(timer); }, [query]);
  const loaded = useLoad(async () => {
    if (!visible) { return { list: [], allCount: 0, counts: new Map<string, number>(), chapterNumber: null as number | null }; }
    const groups = await chapters.list(workId);
    const ordered = groups.flatMap(g => g.chapters);
    const index = ordered.findIndex(ch => ch.id === chapterId);
    const chapterNumber = ordered.slice(0, index + 1).filter(ch => ch.kind === 'main').at(-1)?.number ?? null;
    const all = await entries.list(workId);
    const mentions = await entries.findMentions(workId, body);
    const counts = new Map(mentions.map(m => [m.entryId, m.count]));
    const list = debounced ? (await entries.search(workId, debounced)).slice(0, 50) :
      mentions.map(m => all.find(e => e.id === m.entryId)).filter((e): e is NonNullable<typeof e> => !!e).slice(0, 50);
    return { list, allCount: all.length, counts, chapterNumber };
  }, [visible, workId, chapterId, body, debounced], { events: { 'entries.changed': e => e.workId === workId, 'chapters.changed': e => e.workId === workId } });
  useEffect(() => {
    let active = true;
    setDetail(null); setDetailError(null);
    if (visible && expanded) {
      entries.get(expanded, { atChapterId: loaded.data?.chapterNumber ? chapterId : undefined }).then(result => { if (active) { setDetail(result); } })
        .catch(error => { if (active) { setDetailError(error); } });
    }
    return () => { active = false; };
  }, [expanded, visible, chapterId, loaded.data]);
  return <Sheet visible={visible} title={a.lookup} onRequestClose={onClose} locked={busy} maxHeightRatio={0.88}
    headerRight={<Button label={t.common.close} variant="text" onPress={onClose} disabled={busy} />}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <TextField value={query} onChangeText={setQuery} max={30} clearable placeholder={a.searchPlaceholder} accessibilityLabel={a.searchPlaceholder} />
      {loaded.loading ? <DelayedSpinner /> : loaded.error ? <EmptyState title={a.loadFailed} action={{ label: t.common.retry, onPress: loaded.reload }}
        secondary={{ label: t.common.viewDetail, onPress: () => showErrorDetail(loaded.error, a.loadFailed) }} /> : <>
        <Txt variant="caption" color={c.ink3}>{debounced ? `搜索结果 ${loaded.data?.list.length ?? 0} 个` : `本章提到的 ${loaded.data?.list.length ?? 0} 个条目 · 按出现次数`}</Txt>
        {!loaded.data?.list.length ? <EmptyState title={debounced ? `没有找到「${debounced}」相关的条目。` : loaded.data?.allCount ? a.noMentions : a.emptyLookup} /> :
          loaded.data.list.map(item => <View key={item.id} style={styles.card}>
            <Button label={`${entries.ENTRY_TYPE_LABELS[item.type]} · ${item.name}${debounced ? '' : ` · ${loaded.data!.counts.get(item.id)} 次`} ${expanded === item.id ? '收起' : '展开'}`}
              variant="quiet" onPress={() => setExpanded(id => id === item.id ? null : item.id)} />
            <MemoryBadge state={item.state} />
            {expanded === item.id ? detailError ? <Txt color={c.conf}>这个条目没有加载出来，请重新展开</Txt> : !detail ? <DelayedSpinner /> : <View style={styles.section}>
              <Txt variant="caption" color={c.ink3}>{loaded.data!.chapterNumber ? `按第 ${loaded.data!.chapterNumber} 章时的状态` : '按当前状态'}{detail.aliases.length ? ` · 别名：${detail.aliases.join('、')}` : ''}</Txt>
              {detail.summary ? <Txt>{detail.summary}</Txt> : null}
              {detail.facts.map(fact => {
                const future = detail.timeline.filter(node => node.field === fact.field && node.number !== null && node.number > (loaded.data!.chapterNumber ?? Infinity)).sort((x, y) => x.number! - y.number!)[0];
                return <View key={fact.id}><Txt variant="callout" weight="600">{entries.FIELD_LABELS[fact.field] ?? fact.field}</Txt><Txt selectable>{fact.value}</Txt>
                  {future ? <Txt variant="caption" color={c.ink3}>{`（第 ${future.number} 章起有变化）`}</Txt> : null}</View>;
              })}
              {detail.relations.slice(0, 5).map(r => <Txt key={r.id} selectable>{r.fromName} 是 {r.toName} 的 {r.kind}</Txt>)}
              {detail.conflicts.length ? <Txt color={c.conf}>有 {detail.conflicts.length} 处未处理冲突</Txt> : null}
              <Button label={a.open} variant="text" loading={busy} onPress={async () => { setBusy(true); try { await onOpen(item.id); } finally { setBusy(false); } }} />
            </View> : null}
          </View>)}
      </>}
    </ScrollView>
  </Sheet>;
}
