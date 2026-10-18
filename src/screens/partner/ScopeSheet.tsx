import React, { useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
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
  useEffect(() => { if (visible) { setDraft(scope); } }, [visible, scope]);
  const loaded = useLoad(async () => {
    if (!visible) { return { chapters: [], list: [], blocks: [] }; }
    const allChapters = (await chapters.list(workId)).flatMap(g => g.chapters);
    return { chapters: allChapters, list: [], blocks: await partner.previewContext(workId, draft, query) };
  }, [visible, workId, draft, query], { events: { 'entries.changed': e => e.workId === workId, 'chapters.changed': e => e.workId === workId } });
  const save = async () => {
    if (busy) { return; } setBusy(true);
    try { await onSave(draft); onClose(); } catch (error) { await showError(error); } finally { setBusy(false); }
  };
  return <Sheet visible={visible} title="参考范围" locked={busy} onRequestClose={onClose}
    headerRight={<Button label="关闭" variant="text" onPress={onClose} disabled={busy} />}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <View style={styles.chips}><Chip label="全部已确认设定" selected={draft.kind === 'confirmed'} disabled={busy}
        onPress={() => setDraft(prev => ({ ...prev, kind: 'confirmed', chapterId: null }))} />
        <Chip label="仅某章相关" selected={draft.kind === 'chapter'} disabled={busy || !loaded.data?.chapters.length}
          onPress={() => setDraft(prev => ({ ...prev, kind: 'chapter', chapterId: prev.chapterId ?? loaded.data?.chapters[0]?.id ?? null }))} /></View>
      {draft.kind === 'chapter' ? <View style={styles.chips}>{loaded.data?.chapters.map(ch => <Chip key={ch.id}
        label={`${ch.number ? `第 ${ch.number} 章` : ch.kind === 'extra' ? '番外' : '草稿'} ${ch.title}`} selected={draft.chapterId === ch.id}
        disabled={busy} onPress={() => setDraft(prev => ({ ...prev, chapterId: ch.id }))} />)}</View> : null}
      <View style={styles.row}><Txt style={styles.flex}>带入提议状态的条目（未确认）</Txt><Switch value={draft.includeProposed} disabled={busy}
        onValueChange={includeProposed => setDraft(prev => ({ ...prev, includeProposed }))} trackColor={{ true: c.brand }} /></View>
      <Txt variant="headline">本地参考预览</Txt>
      <Txt variant="caption" color={c.ink3}>实际入选来源、被省略内容与预计消耗，在发送前预览。这里只修改之后消息的参考范围。</Txt>
      {loaded.data?.blocks.map(block => <View key={block.sourceId} style={styles.card}>
        <Txt variant="caption">{block.required ? '必需参考' : '相关参考'} · {block.state} · 约 {estimateTokens(block.text)} token</Txt>
        <Txt selectable>{block.text}</Txt>
      </View>)}
      {loaded.error ? <Button label="范围没有加载出来 · 重试" variant="text" onPress={loaded.reload} /> : null}
      <Button label="保存范围" disabled={JSON.stringify(scope) === JSON.stringify(draft) || !!loaded.error || draft.kind === 'chapter' && !draft.chapterId} loading={busy} onPress={save} />
    </ScrollView>
  </Sheet>;
}
