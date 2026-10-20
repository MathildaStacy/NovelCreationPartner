import React, { useEffect, useState } from 'react';
import { FlatList, SectionList, StyleSheet, Switch, View } from 'react-native';
import { useLoad } from '../../app/hooks';
import { showError } from '../../app/errors';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import * as chapters from '../../features/chapters';
import * as partner from '../../features/partner';
import { estimateTokens } from '../../ai/context';
import type { PartnerScope } from '../../features/types';
import { color as c } from '../../theme/tokens';
import { STATE_LABEL, styles } from '../archive/shared';

/** S10a edits scope locally. The exact token/source preview appears before each paid action. */
export function ScopeSheet({ visible, workId, scope, query, onSave, onClose, onWritingPrefs, conversationId }: {
  visible: boolean; workId: string; scope: PartnerScope; query: string; onSave: (scope: PartnerScope) => Promise<void>; onClose: () => void; onWritingPrefs?: () => void; conversationId?: string | null;
}) {
  const [draft, setDraft] = useState(scope);
  const [busy, setBusy] = useState(false);
  const [choosingChapter, setChoosingChapter] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [removedChapter, setRemovedChapter] = useState(false);
  useEffect(() => { if (visible) { setDraft(scope); setChoosingChapter(false); setExpanded(false); setRemovedChapter(false); } }, [visible, scope]);
  const loaded = useLoad(async () => {
    if (!visible) { return { chapters: [], blocks: [], removedId: null }; }
    const groups = await chapters.list(workId);
    const allChapters = groups.flatMap(g => g.chapters);
    const removedId = draft.kind === 'chapter' && draft.chapterId && !allChapters.some(ch => ch.id === draft.chapterId) ? draft.chapterId : null;
    const effective = removedId ? { ...draft, kind: 'confirmed' as const, chapterId: null } : draft;
    const overview = effective.kind === 'chapter' && !effective.chapterId ? null : await partner.inspectScope(workId, effective, query, conversationId ?? null);
    return { overview, chapters: allChapters.map(ch => ({ ...ch, volumeTitle: (groups.find(group => group.chapters.some(item => item.id === ch.id))?.volume.title ?? '') })), removedId,
      blocks: [...(overview?.blocks ?? []).map(block => ({ block, included: true })), ...(overview?.omittedBlocks ?? []).map(block => ({ block, included: false }))] };
  }, [visible, workId, draft, query, conversationId], { events: { 'entries.changed': e => e.workId === workId, 'chapters.changed': e => e.workId === workId } });
  useEffect(() => {
    if (loaded.data?.removedId && loaded.data.removedId === draft.chapterId) {
      setDraft(prev => ({ ...prev, kind: 'confirmed', chapterId: null })); setRemovedChapter(true); setChoosingChapter(false);
    }
  }, [loaded.data?.removedId, draft.chapterId]);
  const save = async () => {
    if (busy) { return; } setBusy(true);
    try { await onSave(draft); onClose(); } catch (error) { await showError(error); } finally { setBusy(false); }
  };
  const selected = loaded.data?.chapters.find(ch => ch.id === draft.chapterId);
  return <Sheet visible={visible} title={choosingChapter ? '选择章节' : '参考范围'} locked={busy} onRequestClose={() => choosingChapter ? setChoosingChapter(false) : onClose()}
    headerLeft={choosingChapter ? <Button label="参考范围" variant="text" onPress={() => setChoosingChapter(false)} /> : undefined}
    headerRight={<Button label="关闭" variant="text" onPress={onClose} disabled={busy} />}>
    {choosingChapter ? <SectionList sections={[...new Set((loaded.data?.chapters ?? []).map(ch => ch.volumeId))].map(id => ({ title: loaded.data?.chapters.find(ch => ch.volumeId === id)?.volumeTitle ?? '', data: (loaded.data?.chapters ?? []).filter(ch => ch.volumeId === id) }))} renderSectionHeader={({ section }) => <Txt variant="headline">{section.title}</Txt>} keyExtractor={item => item.id} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" renderItem={({ item: ch }) => <Button
        label={`${ch.number ? `第 ${ch.number} 章` : ch.kind === 'extra' ? '番外' : '草稿'} ${ch.title}${draft.chapterId === ch.id ? ' ✓' : ''}`}
        variant="quiet" onPress={() => { setDraft(prev => ({ ...prev, chapterId: ch.id })); setChoosingChapter(false); setRemovedChapter(false); }} />} /> :
    <FlatList data={expanded ? loaded.data?.blocks ?? [] : loaded.data?.blocks.slice(0, 20) ?? []} keyExtractor={row => row.block.sourceId}
      keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.section}>
      <View style={styles.chips}><Chip label="相关已确认设定" selected={draft.kind === 'confirmed'} disabled={busy}
        onPress={() => setDraft(prev => ({ ...prev, kind: 'confirmed', chapterId: null }))} />
        <Chip label="仅某章相关" selected={draft.kind === 'chapter'} disabled={busy || !loaded.data?.chapters.length}
          onPress={() => setDraft(prev => ({ ...prev, kind: 'chapter', chapterId: prev.chapterId ?? [...(loaded.data?.chapters ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? null }))} /></View>
      {onWritingPrefs ? <Button label="写作偏好 ›" variant="text" onPress={onWritingPrefs} /> : null}
      {draft.kind === 'chapter' && !draft.chapterId ? <Txt color={c.pend}>{loaded.data?.chapters.length ? '先选择要参考的章节。' : '还没有可参考章节，可先使用相关已确认设定。'}</Txt> : null}
      {draft.kind === 'chapter' ? <Button label={selected ? `${selected.number ? `第 ${selected.number} 章` : selected.kind === 'extra' ? '番外' : '草稿'} ${selected.title} ›` : '选择参考章节'}
        variant="quiet" disabled={busy || loaded.loading} onPress={() => setChoosingChapter(true)} /> : null}
      {removedChapter ? <Txt color={c.pend}>所选章节已删除，已改回相关已确认设定。</Txt> : null}
      <View style={styles.row}><Txt style={styles.flex}>带入提议状态的条目（未确认）</Txt><Switch value={draft.includeProposed} disabled={busy}
        onValueChange={includeProposed => setDraft(prev => ({ ...prev, includeProposed }))} trackColor={{ true: c.brand }} /></View>
      <Txt variant="headline">本地参考预览</Txt>
      {loaded.data?.overview?.estimatedInputTokens != null ? <View style={styles.section}>
        <Txt variant="caption">{loaded.data.overview.omitted ? '已按预算截取' : `约 ${loaded.data.overview.estimatedInputTokens.toLocaleString()} / ${loaded.data.overview.budget?.toLocaleString()} token`}</Txt>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: loaded.data.overview.budget ?? 1, now: loaded.data.overview.estimatedInputTokens }} style={local.track}><View style={[local.fill, { width: `${Math.min(100, loaded.data.overview.estimatedInputTokens / (loaded.data.overview.budget ?? 1) * 100)}%` }]} /></View>
      </View> : null}
      {loaded.data?.overview?.omitted ? <View style={local.warn}><Txt>{`可选参考超出软目标，有 ${loaded.data.overview.omitted} 项没有带入。必要事实、作者所选正文与最近两轮对话不会因此裁掉；必要内容超出服务硬上限时拒绝发送并要求缩小范围。`}</Txt></View> : null}
      <Txt variant="caption" color={c.ink3}>实际入选来源、被省略内容与预计消耗，在发送前预览。这里只修改之后消息的参考范围。</Txt>
      </View>}
      renderItem={({ item: { block, included } }) => <View style={styles.card} testID={included ? 'scope-row' : 'scope-row-omitted'}>
        <Txt variant="caption" color={included ? undefined : c.ink3}>{scopeRowLabel(block)} · {included ? `约 ${estimateTokens(block.text)} token` : '未带入'}</Txt>
        <Txt selectable color={included ? undefined : c.ink3}>{block.text}</Txt>
      </View>}
      ListFooterComponent={<View style={styles.section}>
      {!expanded && (loaded.data?.blocks.length ?? 0) > 20 ? <Button label={`显示全部（${loaded.data!.blocks.length}）`} variant="text" onPress={() => setExpanded(true)} /> : null}
      {loaded.error ? <Button label="范围没有加载出来 · 重试" variant="text" onPress={loaded.reload} /> : null}
      <Button label="保存范围" disabled={loaded.loading || JSON.stringify(scope) === JSON.stringify(draft) || !!loaded.error || draft.kind === 'chapter' && !draft.chapterId} loading={busy} onPress={save} />
      </View>} />}
  </Sheet>;
}

/** S10a #5 row label: category, plus the state badge for archive entries ("提议·未确认" for proposals). */
export function scopeRowLabel(block: { sourceId: string; state: string; required: boolean }): string {
  const [prefix] = block.sourceId.split(':');
  const category = block.sourceId.includes(':') ? ({ work: '作品', chapter: '章节', summary: '摘要', message: '对话', conflict: '冲突', relation: '关系', proposed: '条目' } as Record<string, string>)[prefix] ?? '参考'
    : block.sourceId === 'entry-names' ? '条目名称' : '条目';
  const badge = prefix === 'proposed' || block.state === 'PROPOSED' ? '提议·未确认'
    : category === '条目' || category === '关系' ? STATE_LABEL[block.state as keyof typeof STATE_LABEL] ?? null : null;
  return [block.required ? '必需' : null, category, badge].filter(Boolean).join(' · ');
}

const local = StyleSheet.create({ warn: { padding: 12, borderRadius: 8, backgroundColor: c.pendTint }, track: { height: 4, backgroundColor: c.line }, fill: { height: 4, backgroundColor: c.brand } });
