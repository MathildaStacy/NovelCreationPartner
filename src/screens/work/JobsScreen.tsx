import React, { useState } from 'react';
import { FlatList, View } from 'react-native';
import { confirmAiData, ensureModelService } from '../../app/dialogs';
import { showError, showErrorDetail } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Delayed, SkeletonCards } from '../../components/Skeleton';
import { NavBar } from '../../components/NavBar';
import { Txt } from '../../components/Text';
import { showDialog, toast } from '../../components/overlay/store';
import * as ai from '../../features/ai';
import * as jobs from '../../features/jobs';
import * as chapters from '../../features/chapters';
import * as modelServices from '../../features/modelServices';
import * as prefs from '../../features/prefs';
import * as usage from '../../features/aiUsage';
import type { Job, JobKind, PauseReason } from '../../features/types';
import { color as c } from '../../theme/tokens';
import { styles } from '../archive/shared';

const kinds: Record<JobKind, string> = { summarize: '生成章节摘要', extract_memory: '提取设定变更', detect_conflicts: '检测设定冲突' };
const status = { queued: '排队中', running: '执行中', paused: '已暂停', done: '已完成', failed: '失败', cancelled: '已取消' };
const reasons: Record<PauseReason, string> = {
  no_service: '未绑定模型服务，请重新确认定稿', no_key: '绑定服务缺少 API Key', notice: '需要确认数据说明', offline: '等待网络',
  interrupted: '请求中断，可能已计费，等待你确认', legacy_input: '旧任务未绑定输入，请重新确认定稿', budget: '整个作业已达到预算，请缩小范围后重新定稿', stale: '输入或服务已变化，请重新确认定稿',
  batch: '等待你授权下一批请求块',
};

/** S05b shows persistent parent-operation budgets and never silently replays interrupted requests. */
export function JobsScreen({ navigation, route }: RootScreenProps<'Jobs'>) {
  const { workId } = route.params;
  const [busy, setBusy] = useState<string | null>(null);
  const loaded = useLoad(async () => {
    const list = await jobs.list(workId);
    const ids = [...new Set(list.flatMap(job => job.operationId ? [job.operationId] : []))];
    return { list, chapters: (await chapters.list(workId)).flatMap(group => group.chapters),
      budgets: new Map(await Promise.all(ids.map(async id => [id, await usage.forRequest(id)] as const))) };
  }, [workId], { events: { 'jobs.changed': event => event.workId === workId, 'chapters.changed': event => event.workId === workId, 'usage.changed': () => true } });
  const resume = async (job: Job) => {
    if (busy) { return; } setBusy(job.id);
    let confirmedHost: string | undefined;
    try {
      if (job.pauseReason === 'interrupted') {
        const key = await showDialog({ title: '重试中断的请求？', message: '上次请求可能已计费。重试会再次请求，并继续使用整个作业剩余的次数与输出预算。',
          buttons: [{ key: 'cancel', label: '取消' }, { key: 'retry', label: '继续重试', style: 'primary' }], dismissKey: 'cancel' });
        if (key !== 'retry') { return; }
      }
      if (job.serviceId) {
        const service = await modelServices.get(job.serviceId);
        if (!service.hasKey) { navigation.navigate('ModelService', { mode: 'edit', from: 'error', serviceId: service.id, focus: 'key' }); return; }
        const host = new URL(service.baseUrl).host.toLowerCase();
        const acknowledged = await prefs.get('aiNoticeAcknowledged').catch(() => ({} as Record<string, string>));
        if (!acknowledged[host]) {
          if (!await confirmAiData(host)) { return; }
          // A failed preference write still counts for this resume (D01 §3); the runner would otherwise pause again.
          if (!await ai.acknowledgeHost(host)) { confirmedHost = host; }
        }
      } else { await ensureModelService(() => navigation.isFocused(), navigation); return; }
      await jobs.resume(job.id, { confirmInterrupted: job.pauseReason === 'interrupted', acknowledgedHost: confirmedHost }); toast('已重新排队');
    } catch (error) { await showError(error); } finally { setBusy(null); await loaded.reload(); }
  };
  const cancel = async (job: Job) => {
    if (busy) { return; } setBusy(job.id);
    try {
      if (job.kind === 'summarize') {
        const key = await showDialog({ title: '取消后续任务？', message: '这次定稿未完成的提取设定和冲突检测也会取消。已经完成的结果会保留。',
          buttons: [{ key: 'keep', label: '保留' }, { key: 'cancel', label: '取消任务', style: 'primary' }], dismissKey: 'keep' });
        if (key !== 'cancel') { return; }
        for (const child of cancelledWithSummary(job, loaded.data?.list ?? [])) { await jobs.cancel(child.id); }
      } else { await jobs.cancel(job.id); }
      toast('已取消');
    } catch (error) { await showError(error); } finally { setBusy(null); await loaded.reload(); }
  };
  const authorizeBatch = async (job: Job) => {
    if (busy) { return; } setBusy(job.id);
    try {
      const preview = await jobs.previewNextBatch(job.id);
      if (!preview) { toast('没有等待授权的请求块'); return; }
      let key: string;
      do {
        key = await showDialog({ title: `执行第 ${preview.start}–${preview.end} 个请求块？`,
          message: `整次作业共 ${preview.totalCalls} 个请求块，本次只授权所列范围，后续批次仍保持暂停。`,
          notes: [
            ...preview.chunks.map(chunk => `${kinds[chunk.kind]} · 第 ${chunk.number} 块 · ${chunk.serviceName} · ${chunk.model}`),
            `本批预计输入约 ${preview.estimatedInputTokens} token，计划输出至多 ${preview.batchOutputTokens} token；共用原作业剩余 ${preview.remainingPosts} 次尝试，全部批次输出总预留上限 ${preview.maxReservedOutputTokens} token。费用未知，失败也可能已计费。`,
            preview.deadlineAt ? `原作业期限：${new Date(preview.deadlineAt).toLocaleString('zh-CN')}，本次确认不会延长。` : '原作业期限从首次执行起计算，后续批次不会重新计时。',
            '本批预览与执行使用同一份已保存请求。设定、正文或服务变化后需要重新定稿。',
          ],
          buttons: [{ key: 'cancel', label: '取消' }, { key: 'preview', label: '查看发送内容' },
            { key: 'authorize', label: '确认执行本批', style: 'primary', run: () => jobs.authorizeBatch(preview) }], dismissKey: 'cancel' });
        if (key === 'preview') {
          await showDialog({ title: '本批实际发送内容', message: '只会向这里列出的服务发送这些请求；首次外发仍需确认数据说明。',
            notes: preview.chunks.map(chunk => `第 ${chunk.number} 块 · ${chunk.serviceName} · ${chunk.model}\n${chunk.contextPlan.serializedRequest}`),
            buttons: [{ key: 'back', label: '返回本批确认', style: 'primary' }], dismissKey: 'back' });
        }
      } while (key === 'preview');
      if (key === 'authorize') { toast('本批已授权，后续批次仍需确认'); }
    } catch (error) { await showError(error); } finally { setBusy(null); await loaded.reload(); }
  };
  const data = loaded.data;
  return <View style={styles.root}><NavBar title="后台任务" backLabel="概览" onBack={() => navigation.goBack()} />
    <FlatList data={data?.list ?? []} keyExtractor={job => job.id} contentContainerStyle={styles.content} extraData={busy}
      ListHeaderComponent={loaded.error ? <EmptyState title="任务没有加载出来。" action={{ label: '重试', onPress: loaded.reload }} /> : undefined}
      ListEmptyComponent={!loaded.loading ? <EmptyState title="还没有后台任务" message="章节定稿后，摘要、设定提取与冲突检测会出现在这里。" /> : <Delayed><SkeletonCards count={3} /></Delayed>}
      renderItem={({ item: job }) => {
        const chapter = data?.chapters.find(item => item.id === job.chapterId);
        const budget = job.operationId ? data?.budgets.get(job.operationId) : undefined;
        return <View style={styles.card}>
          <View style={styles.row}><Txt variant="headline" style={styles.flex}>{kinds[job.kind]}</Txt><Badge label={status[job.status]} tone={job.status === 'failed' ? 'conflict' : job.status === 'paused' ? 'pending' : 'neutral'} /></View>
          <Txt>{chapter ? `${chapter.number ? `第 ${chapter.number} 章 ` : ''}${chapter.title}` : '已删除的章节'}</Txt>
          {job.pauseReason ? <Txt color={c.pend}>{reasons[job.pauseReason]}</Txt> : null}
          {job.error ? <Txt color={c.conf}>{job.error.message}</Txt> : null}
          <Txt variant="caption">本任务执行 {job.attempts} 次</Txt>
          <Txt variant="caption">{job.totalChunks ? `已验证 ${job.completedChunks ?? 0} / ${job.totalChunks} 个请求块${job.status !== 'done' ? '；整理尚未完整完成' : ''}` : '尚未绑定请求块'}</Txt>
          {budget ? <View style={styles.notice}>
            <Txt>{`整个 AI 作业：计划 ${budget.plannedCalls} 次；已尝试 ${budget.physicalPosts} / ${budget.maxPosts} 次`}</Txt>
            <Txt>{`输出已预留或使用 ${budget.reservedOutput} / ${budget.maxReservedOutput} token；${budget.unknownAttempts} 次用量未知`}</Txt>
            <Txt variant="caption">费用未知；失败和中断也可能已计费。</Txt>
          </View> : null}
          <View style={styles.row}>
            {job.pauseReason === 'batch' && data?.list.find(item => item.operationId === job.operationId && !['done', 'cancelled'].includes(item.status))?.id === job.id ? <Button label="预览并授权下一批" disabled={!!busy} loading={busy === job.id} onPress={() => { authorizeBatch(job); }} /> : null}
            {['paused', 'failed'].includes(job.status) && !['legacy_input', 'budget', 'stale', 'no_service', 'batch'].includes(job.pauseReason ?? '') ? <Button label={job.pauseReason === 'interrupted' ? '确认后重试' : '继续'} disabled={!!busy} loading={busy === job.id} onPress={() => { resume(job); }} /> : null}
            {job.pauseReason && ['legacy_input', 'budget', 'stale', 'no_service'].includes(job.pauseReason) && chapter ? <Button label="前往章节重新定稿" variant="text" onPress={() => navigation.navigate('Editor', { workId, chapterId: chapter.id })} /> : null}
            {!['done', 'cancelled'].includes(job.status) ? <Button label="取消任务" variant="quiet" disabled={!!busy} onPress={() => { cancel(job); }} /> : null}
            {job.error ? <Button label="查看详情" variant="text" onPress={() => showErrorDetail(job.error, '后台任务没有完成')} /> : null}
            {job.status === 'done' && job.kind !== 'summarize' ? <Button label={job.kind === 'extract_memory' ? '查看待审核记忆' : '查看冲突'} variant="text"
              onPress={() => job.kind === 'extract_memory' ? navigation.navigate('Review', { workId, chapterId: job.chapterId ?? undefined }) : navigation.navigate('Conflicts', { workId, chapterId: job.chapterId ?? undefined })} /> : null}
          </View>
        </View>;
      }} />
  </View>;
}

/**
 * S05b: cancelling a summary also cancels the unfinished follow-ups of the same
 * finalization. Legacy jobs have no operationId (null), so they are matched by
 * chapter + finalized version instead; without either, only the job itself is
 * cancelled — never every legacy job of the work.
 */
export function cancelledWithSummary(job: Job, list: readonly Job[]): Job[] {
  const unfinished = (item: Job) => !['done', 'cancelled'].includes(item.status);
  const sibling = (item: Job) =>
    job.operationId !== null ? item.operationId === job.operationId
      : job.sourceVersionId !== null && item.operationId === null && item.chapterId === job.chapterId && item.sourceVersionId === job.sourceVersionId;
  const others = list.filter(item => item.id !== job.id && unfinished(item) && sibling(item));
  return unfinished(job) ? [job, ...others] : others;
}
