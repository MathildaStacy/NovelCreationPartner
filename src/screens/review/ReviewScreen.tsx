import React, { useEffect, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { confirmDiscard } from '../../app/dialogs';
import { isAppError } from '../../features/errors';
import { showError } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonCards } from '../../components/Loading';
import { NavBar } from '../../components/NavBar';
import { Sheet } from '../../components/Sheet';
import { TextField } from '../../components/TextField';
import { Txt } from '../../components/Text';
import { showDialog, toast } from '../../components/overlay/store';
import * as proposals from '../../features/proposals';
import * as chapters from '../../features/chapters';
import * as entries from '../../features/entries';
import * as jobs from '../../features/jobs';
import { color as c } from '../../theme/tokens';
import { chapterHeading } from '../../utils/format';
import { styles } from '../archive/shared';

type Proposal = Awaited<ReturnType<typeof proposals.list>>[number];
const rejectionReasons = ['AI 理解有误', '只是本章临时状态，不必记入设定', '细节太琐碎，不重要'];
/** S13/13a/b are author-only local writes: AI suggestions never confirm themselves. */
export function ReviewScreen({ navigation, route }: RootScreenProps<'Review'>) {
  const { workId, chapterId, entryId } = route.params;
  const [filter, setFilter] = useState('pending');
  const [edit, setEdit] = useState<Proposal | null>(null);
  const [reject, setReject] = useState<Proposal | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const loaded = useLoad(async () => {
    const [list, groups, activeJobs] = await Promise.all([proposals.list(workId, { chapterId }), chapters.list(workId), jobs.list(workId, { active: true })]);
    const chapterList = groups.flatMap(group => group.chapters);
    const mapped = list.filter(item => !entryId || item.targetEntryId === entryId).map(item => {
      const chapterRank = chapterList.findIndex(ch => ch.id === item.chapterId);
      const chapter = chapterList[chapterRank];
      return { ...item, chapterRank, chapterTitle: chapter ? chapterHeading(chapter) : '已删除的章节' };
    });
    const confidence = { high: 0, medium: 1, low: 2 };
    mapped.sort((a, b) => b.chapterRank - a.chapterRank || confidence[a.confidence] - confidence[b.confidence] || b.createdAt.localeCompare(a.createdAt));
    return { list: mapped, activeJobs: activeJobs.filter(job => !chapterId || job.chapterId === chapterId).map(job => ({ ...job, chapterLabel: chapterList.find(ch => ch.id === job.chapterId) ? `${chapterList.find(ch => ch.id === job.chapterId)?.number ? `第 ${chapterList.find(ch => ch.id === job.chapterId)?.number} 章` : '番外'} ` : '章节' })) };
  }, [workId, chapterId, entryId], {
    events: { 'jobs.changed': event => event.workId === workId, 'proposals.changed': event => event.workId === workId, 'chapters.changed': event => event.workId === workId }, refetchOnFocus: true,
  });
  const decide = async (proposal: Proposal, action: 'accept' | 'reject' | 'undo', edited?: string) => {
    if (busy) { return; } setBusy(true);
    try {
      if (action === 'accept') { await proposals.accept(proposal.id, edited === undefined ? undefined : { value: edited }); }
      else if (action === 'reject') { await proposals.reject(proposal.id, edited || undefined); }
      else { await proposals.undo(proposal.id); }
      setEdit(null); setReject(null); toast(action === 'undo' ? '已撤销决定' : action === 'accept' ? '已写入档案' : '已拒绝', action !== 'undo' ? {
        action: { label: '撤销', onPress: () => { proposals.undo(proposal.id).catch(showError); } },
      } : {}); await loaded.reload();
    } catch (error) { if (isAppError(error, 'CONFLICT_STATE') || isAppError(error, 'NOT_FOUND')) { setEdit(null); setReject(null); await loaded.reload(); } await showError(error); } finally { setBusy(false); }
  };
  const closeEdit = async () => { if (!busy && (!edit || value === edit.after || await confirmDiscard())) { setEdit(null); } };
  const closeReject = async () => { if (!busy && (!reason || await confirmDiscard())) { setReject(null); } };
  const batch = async () => {
    const selected = loaded.data?.list.filter(proposal => proposal.status === 'pending' && proposal.confidence === 'high') ?? [];
    const key = await showDialog({ title: `通过 ${selected.length} 条高置信度提案？`, message: '正式设定将按来源章节生效。其余提案仍等待逐条确认。',
      buttons: [{ key: 'cancel', label: '取消' }, { key: 'accept', label: '通过这些提案', style: 'primary' }], dismissKey: 'cancel' });
    if (key !== 'accept') { return; }
    setBusy(true); let accepted = 0;
    for (const proposal of selected) { try { await proposals.accept(proposal.id); accepted++; } catch { /* Count failed items and keep them for author review. */ } }
    setBusy(false); toast(`已通过 ${accepted} 条，${selected.length - accepted} 条未能通过`); await loaded.reload();
  };
  const all = loaded.data?.list ?? [];
  useEffect(() => {
    const selected = edit ?? reject;
    if (selected && loaded.data && loaded.data.list.find(item => item.id === selected.id)?.status !== 'pending') { setEdit(null); setReject(null); toast('这条提议已处理，列表已刷新'); }
  }, [loaded.data, edit, reject]);
  const filtered = all.filter(item => item.status === filter);
  const typeLabel = (proposal: Proposal) => {
    if (proposal.entryType === 'relation') { return proposal.kind === 'retire' ? '结束关系' : '新增关系'; }
    if (proposal.kind === 'retire') { return '停用字段'; }
    if (proposal.entryType === 'foreshadow' && proposal.field === 'resolved' && proposal.after === 'yes') { return '回收伏笔'; }
    return proposal.type === 'new_entry' ? '新增条目' : proposal.type === 'update_fact' ? '更新字段' : '新增字段';
  };
  return <View style={styles.root}><NavBar title="记忆审核" onBack={() => navigation.goBack()} right={filter === 'pending' && loaded.data?.list.some(item => item.status === 'pending' && item.confidence === 'high') ?
    <Button label="批量通过" variant="text" disabled={busy} onPress={() => { batch(); }} /> : undefined} />
    <FlatList data={filtered} keyExtractor={proposal => proposal.id} contentContainerStyle={styles.content} extraData={busy}
      ListHeaderComponent={<>
      {loaded.loading ? <SkeletonCards /> : null}
      <View style={styles.chips}>{[['pending', '待审核'], ['accepted', '已通过'], ['rejected', '已拒绝'], ['superseded', '旧结果']].map(([key, label]) => <Chip key={key} label={`${label} ${loaded.data?.list.filter(item => item.status === key).length ?? 0}`} selected={filter === key} onPress={() => setFilter(key)} />)}</View>
      {loaded.data?.activeJobs.filter(job => job.kind === 'extract_memory').map(job => <View key={job.id} style={styles.notice}><Txt>{job.status === 'paused' ? 'AI 整理已暂停' : `${job.chapterLabel}正在整理…`}</Txt><Button label="查看" variant="text" onPress={() => navigation.navigate('Jobs', { workId })} /></View>)}
      {loaded.error ? <EmptyState title="记忆没有加载出来。" action={{ label: '重试', onPress: loaded.reload }} /> : null}
      </>}
      ListEmptyComponent={!loaded.error && !loaded.loading ? <EmptyState title={filter === 'pending' ? '没有待审核的设定变更。' : '还没有这类审核记录。'} message="定稿章节后的设定建议会列在这里，正式写入前由你确认。" /> : undefined}
      renderItem={({ item: proposal, index }) => <View>
        {index === 0 || filtered[index - 1].chapterId !== proposal.chapterId ? <Txt variant="headline" style={local.groupHeading}>{proposal.chapterTitle}</Txt> : null}
        <View style={styles.card}>
        <Txt variant="caption" color={c.ink3}>{`${typeLabel(proposal)} · ${proposal.confidence === 'high' ? '高' : proposal.confidence === 'medium' ? '中' : '低'}置信度`}</Txt>
        <Txt variant="headline">{proposal.entryName || proposal.targetName || '新条目'}{proposal.field ? ` · ${entries.FIELD_LABELS[proposal.field] ?? proposal.field}` : ''}</Txt>
        {proposal.status === 'accepted' ? <Txt variant="caption" color={c.est}>{proposal.edited ? '修改后通过' : '已通过'}</Txt> : null}
        {proposal.status === 'superseded' ? <Txt color={c.ink3}>已被后续定稿取代，只供查看。</Txt> : null}
        {proposal.before ? <Txt color={c.ink3}>原：{proposal.before}</Txt> : null}
        {proposal.origin === 'deletion' ? <View style={styles.notice}><Txt>旧定稿证据已从当前正文移除；是否从本章停用该设定？</Txt></View> : <Txt selectable>新：{proposal.status === 'accepted' ? proposal.acceptedValue ?? proposal.after : proposal.after}</Txt>}<View style={styles.notice}><Txt selectable>原文：{proposal.evidence}</Txt></View>
        {proposal.origin === 'deletion' || proposal.status === 'superseded' ? proposal.evidenceVersionId ? <Button label="查看旧定稿证据" variant="text" onPress={() => navigation.navigate('VersionDiff', { chapterId: proposal.chapterId, versionId: proposal.evidenceVersionId!, from: 'list' })} /> : <Txt variant="caption">证据来自旧定稿，请在版本历史中核实。</Txt> : <Button label="跳到原文" variant="text" onPress={() => navigation.navigate('Editor', { workId, chapterId: proposal.chapterId, locate: { quote: proposal.evidence, offset: proposal.evidenceOffset ?? undefined } })} />}
        {proposal.targetEntryId ? <Button label="查看条目" variant="text" onPress={() => navigation.navigate('EntryDetail', { entryId: proposal.targetEntryId! })} /> : null}
        {proposal.status === 'pending' ? <>
          <View style={styles.row}><Button label="通过" disabled={busy} onPress={() => { decide(proposal, 'accept'); }} />
            {proposal.kind !== 'retire' ? <Button label="修改后通过" variant="secondary" disabled={busy} onPress={() => { setEdit(proposal); setValue(proposal.after); }} /> : null}
            <Button label="拒绝" variant="quiet" disabled={busy} onPress={() => { setReject(proposal); setReason(''); }} /></View>
        </> : proposal.status === 'superseded' ? null : <Button label="撤销决定" variant="text" disabled={busy} onPress={() => { decide(proposal, 'undo'); }} />}
      </View></View>} />
    <Sheet visible={!!edit} locked={busy} title="修改后通过" onRequestClose={() => { closeEdit(); }} headerRight={<Button label="取消" variant="text" disabled={busy} onPress={() => { closeEdit(); }} />}>
      {edit ? <ScrollView contentContainerStyle={styles.content}><Txt variant="headline">{edit.entryName || edit.targetName} · {edit.field ? entries.FIELD_LABELS[edit.field] ?? edit.field : '新增条目'}</Txt>
        {edit.before ? <Txt color={c.ink3}>原值：{edit.before}</Txt> : null}
        <TextField label="新值" accessibilityLabel="审核新值" value={value} onChangeText={setValue} max={300} multiline counter="always" editable={!busy} />
        {value !== edit.after ? <Button label="恢复 AI 原文" variant="text" onPress={() => setValue(edit.after)} /> : null}
        <Txt selectable>原文：{edit.evidence}</Txt><Button label="保存并通过" disabled={!value.trim()} loading={busy} onPress={() => { decide(edit, 'accept', value); }} /></ScrollView> : null}
    </Sheet>
    <Sheet visible={!!reject} locked={busy} title="拒绝原因（选填）" onRequestClose={() => { closeReject(); }}>
      {reject ? <ScrollView contentContainerStyle={styles.content}>{rejectionReasons.map(label => <Button key={label} label={label} variant="secondary" disabled={busy} onPress={() => { decide(reject, 'reject', label); }} />)}
        <TextField label="其他原因" value={reason} onChangeText={setReason} max={100} multiline editable={!busy} />
        <Button label={reason.trim() ? '记录原因并拒绝' : '直接拒绝'} loading={busy} onPress={() => { decide(reject, 'reject', reason); }} />
        <Button label="取消" variant="text" disabled={busy} onPress={() => { closeReject(); }} /></ScrollView> : null}
    </Sheet>
  </View>;
}

const local = StyleSheet.create({ groupHeading: { paddingTop: 8 } });
