import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { confirmDelete } from '../../app/dialogs';
import { showError, showErrorDetail } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import { ActionSheet } from '../../components/ActionSheet';
import { Button } from '../../components/Button';
import { ExpandableText } from '../../components/ExpandableText';
import { EmptyState } from '../../components/EmptyState';
import { DelayedSpinner } from '../../components/Loading';
import { NavBar } from '../../components/NavBar';
import { Segmented } from '../../components/Segmented';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import * as entries from '../../features/entries';
import * as chapters from '../../features/chapters';
import * as trash from '../../features/trash';
import { isAppError } from '../../features/errors';
import type { EntryFact, Relation } from '../../features/types';
import { archiveText as a } from '../../locales/archive';
import { t } from '../../locales/zh-CN';
import { color as c } from '../../theme/tokens';
import { ChapterPicker, MemoryBadge, chapterLabel, chapterRange, chapterShort, styles } from './shared';
import { RelationSheet } from './RelationSheet';
import { EntryCompletionSheet } from './EntryCompletionSheet';
import { openConflict } from '../review/conflictText';

/** S12 renders formal chapter-scoped facts; suggestions are separate until the author confirms. */
export function EntryDetailScreen({ navigation, route }: RootScreenProps<'EntryDetail'>) {
  const { entryId } = route.params;
  const [atChapterId, setAtChapterId] = useState<string | null>(route.params.atChapterId ?? null);
  const [pickChapter, setPickChapter] = useState(false);
  const [menu, setMenu] = useState(false);
  const [complete, setComplete] = useState(false);
  const [relation, setRelation] = useState<Relation | null | undefined>(undefined);
  const [allAppearances, setAllAppearances] = useState(false);
  const [busy, setBusy] = useState(false);
  const acting = useRef(false);
  const scroll = useRef<React.ElementRef<typeof ScrollView>>(null);
  const positions = useRef<Record<string, number>>({});
  const [highlightIds, setHighlightIds] = useState(route.params.highlightFactIds ?? []);
  useEffect(() => { setHighlightIds(route.params.highlightFactIds ?? []); }, [route.params.highlightFactIds]);
  useEffect(() => { if (!highlightIds.length) { return; } const timer = setTimeout(() => setHighlightIds([]), 2000); return () => clearTimeout(timer); }, [highlightIds]);
  const loaded = useLoad(async () => {
    const entry = await entries.get(entryId, { atChapterId: atChapterId ?? undefined });
    return { entry, chapters: (await chapters.list(entry.workId)).flatMap(g => g.chapters).filter(ch => ch.kind === 'main') };
  }, [entryId, atChapterId], { events: { 'entries.changed': () => true, 'proposals.changed': () => true,
    'conflicts.changed': () => true, 'chapters.changed': () => true, 'chapter.saved': () => true }, refetchOnFocus: true });
  const entry = loaded.data?.entry;
  useEffect(() => {
    const highlighted = [...(entry?.facts ?? []), ...(entry?.proposedFacts ?? [])].find(fact => highlightIds.includes(fact.id));
    if (highlighted && positions.current[highlighted.field] !== undefined) { scroll.current?.scrollTo({ y: Math.max(0, positions.current[highlighted.field] - 16), animated: true }); }
  }, [entry, highlightIds]);
  const mainChapters = useMemo(() => loaded.data?.chapters ?? [], [loaded.data]);
  useEffect(() => {
    if (isAppError(loaded.error, 'NOT_FOUND') && !acting.current) { toast(a.gone); navigation.goBack(); }
  }, [loaded.error, navigation]);
  useEffect(() => {
    if (loaded.data && atChapterId && !mainChapters.some(ch => ch.id === atChapterId)) { setAtChapterId(null); toast('所选章节已不存在，已回到当前状态'); }
  }, [loaded.data, mainChapters, atChapterId]);
  const run = async (operation: () => Promise<unknown>, message?: string) => {
    if (acting.current) { return false; }
    acting.current = true; setBusy(true);
    try { await operation(); if (message) { toast(message); } await loaded.reload(); return true; } catch (e) { await showError(e); return false; }
    finally { acting.current = false; setBusy(false); }
  };
  const edit = (field?: string) => entry && navigation.navigate('EntryForm', { workId: entry.workId, entryId, field });
  const more = async (key: string | null) => {
    if (!entry || busy) { return; }
    if (key === 'history') { navigation.navigate('EntryHistory', { entryId }); }
    if (key === 'complete') { setComplete(true); }
    if (key === 'retire') { await run(() => entries.retire(entryId)); toast('已废弃，不再参与 AI 写作和冲突检测', { duration: 5000,
      action: { label: '撤销', onPress: () => { run(() => entries.unretire(entryId)); } } }); }
    if (key === 'restore') { await run(() => entries.unretire(entryId), '已恢复'); }
    if (key === 'remove') {
      try {
        acting.current = true;
        const deleted = await confirmDelete({ name: entry.name, body: entryDeleteBody(entry.relations.length, entry.pendingProposals.length), button: a.remove, run: () => entries.remove(entryId) });
        if (deleted) { navigation.goBack(); toast('已移到回收站', { duration: 5000, action: { label: '撤销', onPress: () => { trash.restore('entry', entryId).catch(showError); } } }); }
      } catch (e) { await showError(e); } finally { acting.current = false; }
    }
  };
  const factNode = (field: string, fact: EntryFact | undefined) => <Pressable key={field} accessibilityRole={fact ? 'text' : 'button'}
    onPress={!fact && !atChapterId && entry?.state !== 'RETIRED' ? () => edit(field) : undefined} style={styles.card}>
    <View style={styles.row}><Txt variant="headline" style={styles.flex}>{entries.FIELD_LABELS[field] ?? field}</Txt>
      {fact && fact.state !== 'CONFIRMED' ? <MemoryBadge state={fact.state} /> : null}</View>
    <ExpandableText color={fact ? c.ink : c.ink3} value={field === 'plantedIn' && fact ? chapterLabel(fact.value, mainChapters) : field === 'resolved' && fact ? fact.value === 'yes' ? a.resolved : a.unresolved : fact?.value || (atChapterId ? `（${chapterShort(atChapterId, mainChapters) ?? ''}时未填写）` : a.unfilled)} />
    {fact?.fromChapterId ? <Txt variant="caption" color={c.ink3}>自{chapterShort(fact.fromChapterId, mainChapters) ?? chapterLabel(fact.fromChapterId, mainChapters)}</Txt> : null}
    {fact?.sourceChapterId ? <Button variant="text" label={fact.sourceLabel || '查看出处'} onPress={() => entry && navigation.navigate('Editor', { workId: entry.workId, chapterId: fact.sourceChapterId!, locate: { quote: fact.evidence ?? undefined } })} /> : fact?.sourceLabel ? <Txt variant="caption" color={c.ink3}>{fact.sourceLabel}</Txt> : null}
  </Pressable>;
  return <View style={styles.root}>
    <NavBar title={entry?.name} backLabel="档案" onBack={() => navigation.goBack()} right={<View style={styles.row}>
      {entry && !atChapterId && entry.state !== 'RETIRED' ? <Button label="编辑" variant="text" onPress={() => edit()} disabled={busy} /> : null}
      <Button label="更多" variant="text" onPress={() => setMenu(true)} disabled={!entry || busy} /></View>} />
    {loaded.loading ? <DelayedSpinner /> : !entry ? <EmptyState title={a.entryFailed} action={{ label: t.common.retry, onPress: loaded.reload }}
      secondary={{ label: t.common.viewDetail, onPress: () => showErrorDetail(loaded.error, a.entryFailed) }} /> : <ScrollView ref={scroll} contentContainerStyle={styles.content}>
      <View style={styles.section}><View style={styles.row}><Txt variant="title1" style={[styles.flex, entry.state === 'RETIRED' ? styles.retiredName : null]}>{entry.name}</Txt><MemoryBadge state={entry.state} /></View>
        <Txt color={c.ink3}>{entries.ENTRY_TYPE_LABELS[entry.type]}{entry.aliases.length ? ` · 又名：${entry.aliases.join('、')}` : ''}</Txt>
        {entry.summary ? <Txt>{entry.summary}</Txt> : null}
        {mainChapters.length ? <Button label={`查看：${chapterLabel(atChapterId, mainChapters, a.current)}`} variant="secondary" onPress={() => setPickChapter(true)} /> : null}
      </View>
      {atChapterId ? <Button label={`正在查看${chapterShort(atChapterId, mainChapters) ?? ''}时的状态 · 回到当前`} variant="text" onPress={() => setAtChapterId(null)} /> : null}
      {entry.state === 'RETIRED' ? <View style={styles.notice}><Txt>{a.retiredHint}</Txt><Button label={a.unretire} variant="text" onPress={() => { run(() => entries.unretire(entryId), '已恢复'); }} /></View> : null}
      {!atChapterId && entry.conflicts.length ? <Button label={`有 ${entry.conflicts.length} 处设定冲突 · 查看`} variant="secondary" onPress={() => entry.conflicts.length === 1 ? openConflict(navigation, entry.conflicts[0].id) : navigation.navigate('Conflicts', { workId: entry.workId, entryId })} /> : null}
      {!atChapterId && entry.pendingProposals.length ? <Button label={`${entry.pendingProposals.length} 条待审核变更`} variant="secondary" onPress={() => navigation.navigate('Review', { workId: entry.workId, entryId })} /> : null}
      {[...entries.ENTRY_FIELDS[entry.type], ...otherFields(entry)].map((field, index, all) => {
        const fact = entry.facts.find(f => f.field === field);
        const proposed = !atChapterId && entry.state !== 'RETIRED' ? entry.proposedFacts.filter(f => f.field === field) : [];
        const highlighted = [fact, ...proposed].some(f => f && highlightIds.includes(f.id));
        const otherHeading = index === entries.ENTRY_FIELDS[entry.type].length && index < all.length ? <Txt key="other-heading" variant="headline" color={c.ink2}>其他</Txt> : null;
        return <React.Fragment key={field}>{otherHeading}<View style={[styles.section, highlighted ? styles.notice : null]} onLayout={event => { positions.current[field] = event.nativeEvent.layout.y; if (highlighted) { scroll.current?.scrollTo({ y: Math.max(0, event.nativeEvent.layout.y - 16), animated: true }); } }}>
          {!proposed.length ? factNode(field, fact) : null}
          {proposed.map(proposal => <View key={proposal.id} style={[styles.card, styles.proposed]}>
            <View style={styles.row}><Txt variant="headline">{entries.FIELD_LABELS[field] ?? field} · {fact ? '修改提议' : proposal.source.kind === 'ai_complete' ? 'AI 补全的提议' : proposal.source.kind === 'partner' ? 'AI 伙伴的提议' : '提议'}</Txt>{fact?.state === 'CONFLICTED' ? <MemoryBadge state={fact.state} /> : null}</View>
            {fact ? <Txt color={c.ink3} style={styles.struck}>{fact.value}</Txt> : null}
            <ExpandableText value={proposal.value} />
            <View style={styles.row}><Button label="采纳" disabled={busy} onPress={() => { run(() => entries.confirmFact(proposal.id), '已采纳'); }} />
              <Button label="丢弃" variant="quiet" disabled={busy} onPress={() => { run(() => entries.dismissFact(proposal.id)).then(ok => ok && toast('已丢弃', { duration: 5000, action: { label: '撤销', onPress: () => { run(() => entries.proposeFacts(entryId, [{ field, value: proposal.value, fromChapterId: proposal.fromChapterId }], proposal.source)); } } })); }} /></View>
          </View>)}
        </View></React.Fragment>;
      })}
      {showTimeline(entry) ? <View style={styles.section}><Txt variant="headline">{a.timeline}</Txt>{entry.timeline.map((node, i) => {
        const pending = node.kind === 'pending';
        const atNumber = atChapterId ? mainChapters.find(ch => ch.id === atChapterId)?.number ?? null : null;
        const faded = atNumber != null && node.number != null && node.number > atNumber;
        const onPress = () => {
          if (node.proposalId) { navigation.navigate('Review', { workId: entry.workId, entryId, proposalId: node.proposalId }); return; }
          if (pending) { setAtChapterId(null); if (node.factId) { setHighlightIds([node.factId]); } return; }
          if (node.chapterId) { setAtChapterId(node.chapterId); }
        };
        return <Pressable key={`${node.field}-${i}`} accessibilityRole="button" testID={`timeline-${pending ? 'pending' : 'fact'}-${i}`}
          accessibilityLabel={`第 ${node.number ?? '—'} 章 ${entries.FIELD_LABELS[node.field] ?? node.field}：${node.value}${pending ? '（待审核）' : ''}`}
          onPress={onPress} style={[local.node, faded ? local.faded : null]}>
          <View style={local.rail}><View style={[local.dot, pending ? local.dotPending : local.dotFact]} />{i < entry.timeline.length - 1 ? <View style={local.line} /> : null}</View>
          <Txt numberOfLines={1} style={styles.flex}>{`第 ${node.number ?? '—'} 章 ${entries.FIELD_LABELS[node.field] ?? node.field}：${node.value}${pending ? '（待审核）' : ''}`}</Txt>
        </Pressable>;
      })}</View> : null}
      <View style={styles.section}><Txt variant="headline">{a.relations}</Txt>
        {!atChapterId && entry.state !== 'RETIRED' ? <Button label={a.addRelation} variant="text" onPress={() => setRelation(null)} /> : null}
        {!entry.relations.length ? <Txt color={c.ink3}>{a.noRelations}</Txt> : entry.relations.map(r => <View key={r.id} style={[styles.card, r.toChapterId ? local.ended : null]} testID={r.toChapterId ? 'relation-ended' : 'relation-ongoing'}>
          <Button label={`${r.fromName} 是 ${r.toName} 的 ${r.kind}`} variant="quiet" onPress={!atChapterId ? () => setRelation(r) : undefined} />
          <Txt variant="caption" color={c.ink3}>{chapterRange(r.fromChapterId, r.toChapterId, mainChapters)}</Txt>
          <Button label={`打开${r.fromEntryId === entryId ? r.toName : r.fromName}`} variant="text" onPress={() => navigation.push('EntryDetail', { entryId: r.fromEntryId === entryId ? r.toEntryId : r.fromEntryId })} />
        </View>)}</View>
      {entry.type === 'foreshadow' && entry.resolved && entry.resolvedChapterId ? <Button label={`回收于${chapterLabel(entry.resolvedChapterId, mainChapters)} · 查看`} variant="text" onPress={() => navigation.navigate('Editor', { workId: entry.workId, chapterId: entry.resolvedChapterId! })} /> : null}
      {entry.type === 'foreshadow' && !atChapterId && entry.state !== 'RETIRED' ? <Segmented value={entry.resolved ? 'yes' : 'no'} locked={busy}
        segments={[{ key: 'no', label: a.unresolved }, { key: 'yes', label: a.resolved }]} onChange={value => { run(() => entries.update(entryId, { facts: [{ field: 'resolved', value }] }), `已标记为${value === 'yes' ? a.resolved : a.unresolved}`); }} /> : null}
      <View style={styles.section}><Txt variant="headline">{a.appearances} · {entry.appearances.length} 章</Txt>
        {entry.appearances.length ? (allAppearances ? entry.appearances : entry.appearances.slice(0, 3)).map(ch => <Button key={ch.chapterId}
          label={`${ch.number ? `第 ${ch.number} 章` : '番外'} ${ch.title} · 出现 ${ch.count} 次`} variant="quiet" onPress={() => navigation.navigate('Editor', { workId: entry.workId, chapterId: ch.chapterId, locate: { offset: ch.firstOffset, quote: undefined } })} />) : <Txt color={c.ink3}>{a.noAppearances}</Txt>}
        {entry.appearances.length > 3 ? <Button label={allAppearances ? '收起' : `查看全部 ${entry.appearances.length} 章`} variant="text" onPress={() => setAllAppearances(v => !v)} /> : null}
      </View>
    </ScrollView>}
    <ActionSheet visible={menu} onRequestClose={() => setMenu(false)} onDone={key => { more(key); }} title={entry?.name}
      items={entry ? [...(!atChapterId && entry.state !== 'RETIRED' ? [{ key: 'complete', label: a.complete }] : []), { key: 'history', label: a.history },
        { key: entry.state === 'RETIRED' ? 'restore' : 'retire', label: entry.state === 'RETIRED' ? a.unretire : a.retire }, { key: 'remove', label: a.remove, destructive: true }] : []} />
    <ChapterPicker visible={pickChapter} title="查看章节状态" value={atChapterId} chapters={mainChapters} nullLabel={a.current} onClose={() => setPickChapter(false)} onPick={setAtChapterId} />
    {entry && complete ? <EntryCompletionSheet entry={entry} navigation={navigation} onClose={result => { setComplete(false); if (result.pendingIds.length) { setHighlightIds(result.pendingIds); } else if (result.adopted) { toast(`已采纳 ${result.adopted} 条`); } loaded.reload(); }} /> : null}
    {entry ? <RelationSheet visible={relation !== undefined} entry={entry} relation={relation ?? null} chapters={mainChapters} onClose={() => setRelation(undefined)} /> : null}
  </View>;
}

/** D02 entry row. */
export function entryDeleteBody(relationCount: number, pendingCount: number): string {
  return `条目${relationCount ? `和它的 ${relationCount} 条关系` : ''}会移到回收站，30 天内可以恢复。正文不会改变。`
    + (pendingCount ? `指向它的 ${pendingCount} 条待审核变更将无法通过。` : '')
    + '提示：如果只是不再使用这个设定，可以改为"废弃"，它会保留在历史中。';
}

/** Fields outside the type template (custom / partner-split) shown in the "其他" group (S12 §3). */
function otherFields(entry: { type: keyof typeof entries.ENTRY_FIELDS; facts: EntryFact[]; proposedFacts: EntryFact[] }): string[] {
  const template = new Set(entries.ENTRY_FIELDS[entry.type]);
  return [...new Set([...entry.facts, ...entry.proposedFacts].map(f => f.field))].filter(field => !template.has(field));
}

/** S12 #11: shown when a field has ≥ 2 dated phases, or a dated pending node exists. */
export function showTimeline(entry: { timeline: { field: string; kind: 'fact' | 'pending' }[] }): boolean {
  if (entry.timeline.some(node => node.kind === 'pending')) { return true; }
  const perField = new Map<string, number>();
  for (const node of entry.timeline) { perField.set(node.field, (perField.get(node.field) ?? 0) + 1); }
  return [...perField.values()].some(n => n >= 2);
}

const local = StyleSheet.create({
  node: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 36 },
  faded: { opacity: 0.4 },
  ended: { opacity: 0.6 },
  rail: { width: 12, alignItems: 'center', alignSelf: 'stretch' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  dotFact: { backgroundColor: c.est },
  dotPending: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.pend, backgroundColor: 'transparent' },
  line: { flex: 1, width: 1, backgroundColor: c.line, marginTop: 2 },
});
