import React, { useEffect, useRef, useState } from 'react';
import { usePreventRemove } from '@react-navigation/native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { showError } from '../../app/errors';
import { useDirtyGuard, useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { NavBar } from '../../components/NavBar';
import { SkeletonCards } from '../../components/Skeleton';
import { TextField } from '../../components/TextField';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import * as conflicts from '../../features/conflicts';
import { isAppError } from '../../features/errors';
import type { ConflictView, MemoryState } from '../../features/types';
import { color as c, radius } from '../../theme/tokens';
import { formatTime } from '../../utils/format';
import { STATE_LABEL, styles } from '../archive/shared';
import { chapterHeading, conflictTitle, factInterval, resolutionLabel, SEVERITY_LABEL } from './conflictText';

type Choice = 'text' | 'entry' | 'intentional' | 'later';

/** Options available for this conflict, in display order (S14a #6–#9). */
export function conflictChoices(conflict: ConflictView): Choice[] {
  return [
    ...(conflict.chapterId ? ['text' as const] : []),
    ...(conflict.entryId ? ['entry' as const] : []),
    'intentional' as const,
    ...(conflict.status === 'later' ? [] : ['later' as const]),
  ];
}

/** S14a: one choice + one primary button. Only explicit author decisions are saved; nothing calls a model. */
export function ConflictDetailScreen({ navigation, route }: RootScreenProps<'ConflictDetail'>) {
  const { conflictId } = route.params;
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [backFromEditor, setBackFromEditor] = useState(false);
  const visitedEditor = useRef(false);
  const sentToForm = useRef(false);
  const loaded = useLoad(() => conflicts.get(conflictId), [conflictId],
    { events: { 'conflicts.changed': () => true, 'entries.changed': () => true, 'chapters.changed': () => true }, refetchOnFocus: true });
  const conflict = loaded.data;
  const pending = !!conflict && ['open', 'later'].includes(conflict.status);
  const choices = conflict && pending ? conflictChoices(conflict) : [];
  const selected = choice && choices.includes(choice) ? choice : choices[0] ?? null;
  usePreventRemove(busy, () => {});
  const leave = useDirtyGuard(pending && selected === 'intentional' && note.trim() !== '' && !busy);
  useEffect(() => navigation.addListener('focus', () => { if (visitedEditor.current) { setBackFromEditor(true); } }), [navigation]);
  // S12a saved the archive and marked this conflict: the decision is done, go back like the other choices.
  useEffect(() => {
    if (sentToForm.current && conflict?.status === 'updated_entry') { sentToForm.current = false; leave(() => navigation.goBack()); }
  }, [conflict?.status, leave, navigation]);

  const resolveAndLeave = async (status: 'fixed_text' | 'intentional' | 'later', message: string) => {
    if (busy || !conflict) { return; }
    setBusy(true);
    try {
      await conflicts.resolve(conflictId, { status, note: status === 'intentional' ? note.trim() || undefined : undefined });
      toast(message);
      setBusy(false);
      leave(() => navigation.goBack());
    } catch (error) { await showError(error); setBusy(false); }
  };
  const reopen = async () => {
    if (busy) { return; } setBusy(true);
    try { await conflicts.reopen(conflictId); setNote(''); setChoice(null); visitedEditor.current = false; setBackFromEditor(false); await loaded.reload(); }
    catch (error) { await showError(error); } finally { setBusy(false); }
  };
  const openEditor = () => {
    if (!conflict?.chapterId) { return; }
    visitedEditor.current = true;
    const side = prose(conflict);
    navigation.navigate('Editor', { workId: conflict.workId, chapterId: conflict.chapterId, locate: { quote: side?.quote, offset: side?.offset ?? undefined } });
  };
  /** History prose lives in an earlier chapter; a changed body is located by quote only. */
  const openHistory = () => {
    if (!conflict?.history) { return; }
    const { history } = conflict;
    navigation.navigate('Editor', { workId: conflict.workId, chapterId: history.chapterId,
      locate: { quote: conflict.b.quote, offset: history.changed ? undefined : history.offset ?? undefined } });
  };
  const primary = () => {
    if (!conflict || !selected) { return; }
    if (selected === 'text') { openEditor(); }
    else if (selected === 'entry') { sentToForm.current = true; navigation.navigate('EntryForm', { workId: conflict.workId, entryId: conflict.entryId!, conflictId, field: conflict.fact?.field }); }
    else if (selected === 'intentional') { resolveAndLeave('intentional', '已标记为有意为之'); }
    else { resolveAndLeave('later', '已放到稍后处理'); }
  };

  if (!conflict) {
    return <View style={styles.root}><NavBar title="冲突处理" onBack={() => navigation.goBack()} />
      {loaded.error ? isAppError(loaded.error, 'NOT_FOUND')
        ? <EmptyState title="这处冲突已不存在" message="所在章节或条目可能已被删除。" action={{ label: '返回', onPress: () => navigation.goBack() }} />
        : <EmptyState title="冲突没有加载出来。" action={{ label: '重试', onPress: loaded.reload }} />
        : <View style={styles.content}><SkeletonCards count={2} /></View>}
    </View>;
  }
  const chapterNo = conflict.chapter?.number ? `第 ${conflict.chapter.number} 章` : '本章';
  const proseSide = prose(conflict);
  const historySide = conflict.history ? conflict.b : null;
  const archiveSides = [conflict.a, conflict.b].filter(side => side !== proseSide && side !== historySide);
  const labels: Record<Choice, [string, string]> = {
    text: ['去改正文', `打开${chapterNo}并选中这句，改完回来标记已解决`],
    entry: ['以正文为准 · 更新档案', `去修改「${conflict.entryName ?? '条目'}」的${conflict.fact?.fieldLabel ?? '设定'}和生效章节`],
    intentional: ['标记为有意为之', '伏笔或特例，以后不再提示这一处'],
    later: ['稍后处理', '先放一放，章节上的提醒保留'],
  };
  const primaryLabel: Record<Choice, string> = { text: `打开${chapterNo}`, entry: '去更新档案', intentional: '标记为有意为之', later: '稍后处理' };
  return <View style={styles.root}><NavBar title="冲突处理" onBack={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={local.row}><Txt variant="title2" style={local.flex}>{conflictTitle(conflict)}</Txt>
        <Badge label={SEVERITY_LABEL[conflict.severity]} tone={conflict.severity === 'low' ? 'neutral' : conflict.severity === 'high' ? 'conflict' : 'pending'} /></View>
      {conflict.status === 'later' ? <Txt variant="caption" color={c.ink3}>已标记稍后处理</Txt> : null}
      {proseSide ? <View style={[styles.card, local.prose]}>
        <Txt variant="caption" color={c.ink3}>{`正文原句 · ${chapterHeading(conflict.chapter) ?? '已删除的章节'}`}</Txt>
        <Txt selectable>{`“${proseSide.quote}”`}</Txt>
        <Button label="在正文中查看 ›" variant="text" size="small" disabled={busy} onPress={openEditor} />
      </View> : null}
      {historySide && conflict.history ? <View style={styles.card}>
        <Txt variant="caption" color={c.ink3}>{`历史正文 · ${chapterHeading({ id: conflict.history.chapterId, number: conflict.history.number, title: conflict.history.title })}`}</Txt>
        <Txt selectable>{`“${historySide.quote}”`}</Txt>
        {conflict.history.changed ? <Txt variant="caption" color={c.ink3}>这一章的正文在检查后修改过，原句可能已改动或不在原处。</Txt> : null}
        <Button label="查看这段原文 ›" variant="text" size="small" disabled={busy} onPress={openHistory} />
      </View> : null}
      {archiveSides.map((side, index) => {
        const isFact = side === conflict.b && !!conflict.fact;
        return <View key={index} style={styles.card}>
          <Txt variant="caption" color={c.ink3}>{`档案记录 · ${isFact ? `${conflict.entryName ?? side.label} · ${conflict.fact!.fieldLabel} · ${factInterval(conflict.fact!)}` : conflict.entryName && !side.label.includes(conflict.entryName) ? `${conflict.entryName} · ${side.label}` : side.label}`}</Txt>
          <Txt selectable>{isFact && conflict.fact!.currentValue ? conflict.fact!.currentValue : side.quote}</Txt>
          {isFact && STATE_LABEL[conflict.fact!.state as MemoryState] ? <Txt variant="caption" color={c.ink3}>{STATE_LABEL[conflict.fact!.state as MemoryState]}</Txt> : null}
          {isFact && conflict.fact!.currentValue && pending ? <Txt variant="caption" color={c.ink3}>档案已改动，确认无误后可选择“以正文为准”标记解决</Txt> : null}
          {conflict.entryId && (isFact || !conflict.fact) ? <Button label="查看条目 ›" variant="text" size="small" disabled={busy}
            onPress={() => navigation.navigate('EntryDetail', { entryId: conflict.entryId!, atChapterId: conflict.chapterId ?? undefined })} /> : null}
        </View>;
      })}
      <View style={local.explain}>
        <Txt color={c.ink2}>{`AI 说明：${conflict.explanation}`}</Txt>
        {conflict.suggestions.slice(0, 2).map((suggestion, index) => <Txt key={index} color={c.ink2}>{`建议：${suggestion}`}</Txt>)}
      </View>
      {!pending ? <View style={styles.notice}>
        <Txt weight="600">{resolutionLabel(conflict)}</Txt>
        {conflict.status !== 'intentional' && conflict.note ? <Txt>{conflict.note}</Txt> : null}
        {conflict.resolvedAt ? <Txt variant="caption" color={c.ink3}>{`${formatTime(conflict.resolvedAt)}处理`}</Txt> : null}
        {conflict.status === 'superseded' ? <Txt>这份记录只供查看，请以当前定稿的新检查结果为准。</Txt>
          : <Button label="重新打开" variant="secondary" loading={busy} onPress={() => { reopen(); }} />}
      </View> : <>
        <Txt variant="headline">以哪边为准？</Txt>
        <View accessibilityRole="radiogroup" style={local.options}>
          {choices.map(key => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: selected === key, disabled: busy }}
            accessibilityLabel={`${labels[key][0]}，${labels[key][1]}`} disabled={busy} onPress={() => setChoice(key)} style={[local.option, selected === key && local.optionOn]}>
            <View style={[local.dot, selected === key && local.dotOn]} />
            <View style={local.flex}><Txt weight="600">{labels[key][0]}</Txt><Txt variant="caption" color={c.ink3}>{labels[key][1]}</Txt></View>
          </Pressable>)}
        </View>
        {selected === 'intentional' ? <TextField label="原因" placeholder="写一句原因（可不填）" value={note} onChangeText={setNote} max={200} counter="always" multiline editable={!busy} /> : null}
        {backFromEditor && conflict.chapterId ? <Button label="我已改好，标记已解决" variant="secondary" disabled={busy} onPress={() => { resolveAndLeave('fixed_text', '冲突已解决'); }} /> : null}
        {selected ? <Button label={primaryLabel[selected]} loading={busy} onPress={primary} /> : null}
        <Txt variant="caption" color={c.ink3}>处理只改本机记录，不会自动修改正文或设定，也不调用 AI。</Txt>
      </>}
    </ScrollView>
  </View>;
}

/** The chapter-side quote; null when two archive records conflict (chapterId 为空). */
function prose(conflict: ConflictView) {
  if (!conflict.chapterId) { return null; }
  return [conflict.a, conflict.b].find(side => side.ref === `chapter:${conflict.chapterId}`) ?? conflict.a;
}

const local = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1, gap: 2 },
  prose: { borderColor: c.conf },
  explain: { backgroundColor: c.sunken, borderRadius: radius.small, padding: 12, gap: 6 },
  options: { gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.small, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface },
  optionOn: { borderColor: c.brand, backgroundColor: c.brandTint },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: c.ink3 },
  dotOn: { borderColor: c.brand, borderWidth: 6 },
});
