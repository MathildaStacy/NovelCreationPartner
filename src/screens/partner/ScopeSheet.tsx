import React, { useEffect, useState } from 'react';
import { FlatList, Switch, View } from 'react-native';
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
import { styles } from '../archive/shared';

/** S10a edits scope locally. The exact token/source preview appears before each paid action. */
export function ScopeSheet({ visible, workId, scope, query, onSave, onClose }: {
  visible: boolean; workId: string; scope: PartnerScope; query: string; onSave: (scope: PartnerScope) => Promise<void>; onClose: () => void;
}) {
  const [draft, setDraft] = useState(scope);
  const [busy, setBusy] = useState(false);
  const [choosingChapter, setChoosingChapter] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [removedChapter, setRemovedChapter] = useState(false);
  useEffect(() => { if (visible) { setDraft(scope); setChoosingChapter(false); setExpanded(false); setRemovedChapter(false); } }, [visible, scope]);
  const loaded = useLoad(async () => {
    if (!visible) { return { chapters: [], blocks: [], removedId: null }; }
    const allChapters = (await chapters.list(workId)).flatMap(g => g.chapters);
    const removedId = draft.kind === 'chapter' && draft.chapterId && !allChapters.some(ch => ch.id === draft.chapterId) ? draft.chapterId : null;
    const effective = removedId ? { ...draft, kind: 'confirmed' as const, chapterId: null } : draft;
    return { chapters: allChapters, removedId, blocks: effective.kind === 'chapter' && !effective.chapterId ? [] : await partner.previewContext(workId, effective, query) };
  }, [visible, workId, draft, query], { events: { 'entries.changed': e => e.workId === workId, 'chapters.changed': e => e.workId === workId } });
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
    {choosingChapter ? <FlatList data={loaded.data?.chapters ?? []} keyExtractor={item => item.id} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" renderItem={({ item: ch }) => <Button
        label={`${ch.number ? `第 ${ch.number} 章` : ch.kind === 'extra' ? '番外' : '草稿'} ${ch.title}${draft.chapterId === ch.id ? ' ✓' : ''}`}
        variant="quiet" onPress={() => { setDraft(prev => ({ ...prev, chapterId: ch.id })); setChoosingChapter(false); setRemovedChapter(false); }} />} /> :
    <FlatList data={expanded ? loaded.data?.blocks ?? [] : loaded.data?.blocks.slice(0, 20) ?? []} keyExtractor={block => block.sourceId}
      keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.section}>
      <View style={styles.chips}><Chip label="相关已确认设定" selected={draft.kind === 'confirmed'} disabled={busy}
        onPress={() => setDraft(prev => ({ ...prev, kind: 'confirmed', chapterId: null }))} />
        <Chip label="仅某章相关" selected={draft.kind === 'chapter'} disabled={busy || !loaded.data?.chapters.length}
          onPress={() => setDraft(prev => ({ ...prev, kind: 'chapter', chapterId: prev.chapterId ?? loaded.data?.chapters[0]?.id ?? null }))} /></View>
      {draft.kind === 'chapter' && !draft.chapterId ? <Txt color={c.pend}>{loaded.data?.chapters.length ? '先选择要参考的章节。' : '还没有可参考章节，可先使用相关已确认设定。'}</Txt> : null}
      {draft.kind === 'chapter' ? <Button label={selected ? `${selected.number ? `第 ${selected.number} 章` : selected.kind === 'extra' ? '番外' : '草稿'} ${selected.title} ›` : '选择参考章节'}
        variant="quiet" disabled={busy || loaded.loading} onPress={() => setChoosingChapter(true)} /> : null}
      {removedChapter ? <Txt color={c.pend}>所选章节已删除，已改回相关已确认设定。</Txt> : null}
      <View style={styles.row}><Txt style={styles.flex}>带入提议状态的条目（未确认）</Txt><Switch value={draft.includeProposed} disabled={busy}
        onValueChange={includeProposed => setDraft(prev => ({ ...prev, includeProposed }))} trackColor={{ true: c.brand }} /></View>
      <Txt variant="headline">本地参考预览</Txt>
      <Txt variant="caption" color={c.ink3}>实际入选来源、被省略内容与预计消耗，在发送前预览。这里只修改之后消息的参考范围。</Txt>
      </View>}
      renderItem={({ item: block }) => <View style={styles.card}>
        <Txt variant="caption">{block.required ? '必需参考' : '相关参考'} · {block.state} · 约 {estimateTokens(block.text)} token</Txt>
        <Txt selectable>{block.text}</Txt>
      </View>}
      ListFooterComponent={<View style={styles.section}>
      {!expanded && (loaded.data?.blocks.length ?? 0) > 20 ? <Button label={`显示全部（${loaded.data!.blocks.length}）`} variant="text" onPress={() => setExpanded(true)} /> : null}
      {loaded.error ? <Button label="范围没有加载出来 · 重试" variant="text" onPress={loaded.reload} /> : null}
      <Button label="保存范围" disabled={loaded.loading || JSON.stringify(scope) === JSON.stringify(draft) || !!loaded.error || draft.kind === 'chapter' && !draft.chapterId} loading={busy} onPress={save} />
      </View>} />}
  </Sheet>;
}
