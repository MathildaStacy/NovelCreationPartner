import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { confirmAiData } from '../../app/dialogs';
import { showError } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { NavBar } from '../../components/NavBar';
import { Sheet } from '../../components/Sheet';
import { SkeletonCards } from '../../components/Skeleton';
import { Txt } from '../../components/Text';
import { showDialog, toast } from '../../components/overlay/store';
import * as ai from '../../features/ai';
import * as chapters from '../../features/chapters';
import * as conflicts from '../../features/conflicts';
import * as jobs from '../../features/jobs';
import * as modelServices from '../../features/modelServices';
import type { ChapterListItem, ConflictView } from '../../features/types';
import { color as c, radius } from '../../theme/tokens';
import { styles } from '../archive/shared';
import { chapterHeading, conflictTitle, openConflict, resolutionLabel, SEVERITY_LABEL } from './conflictText';

/** S14 lists stored evidence; opening this page never re-runs an AI review. */
export function ConflictsScreen({ navigation, route }: RootScreenProps<'Conflicts'>) {
  const { workId, chapterId, entryId } = route.params;
  const chapterFilter = chapterId;
  const [filter, setFilter] = useState('open');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recheckChapterId, setRecheckChapterId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preparing = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const loaded = useLoad(async () => {
    const [list, groups, tasks] = await Promise.all([conflicts.list(workId), chapters.list(workId), jobs.list(workId)]);
    return { list, chapters: groups.flatMap(group => group.chapters), tasks };
  }, [workId], { events: { 'conflicts.changed': e => e.workId === workId, 'chapters.changed': e => e.workId === workId, 'jobs.changed': e => e.workId === workId }, refetchOnFocus: true });
  const eligible = (chapter: ChapterListItem) => chapter.kind === 'main' && chapter.state === 'finalized' && chapter.charCount > 0 && !!chapter.finalizedVersionId;
  const chapterName = (chapter: ChapterListItem) => chapterHeading(chapter)!;
  const openPicker = () => {
    const available = loaded.data?.chapters.filter(eligible).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) ?? [];
    setRecheckChapterId(available.find(chapter => chapter.id === chapterFilter)?.id ?? available[0]?.id ?? null);
    setPickerOpen(true);
  };
  const prepareRecheck = async () => {
    const chapter = loaded.data?.chapters.find(item => item.id === recheckChapterId);
    if (preparing.current || !chapter || !eligible(chapter)) { return; }
    preparing.current = true; setBusy(true);
    try {
      const plan = await conflicts.prepareRecheck(chapter.id);
      const serviceIds = [...new Set(plan.tasks.flatMap(task => task.serviceId ? [task.serviceId] : []))];
      const boundServices = await Promise.all(serviceIds.map(id => modelServices.get(id)));
      if (!alive.current || !navigation.isFocused()) { return; }
      const missingKey = boundServices.find(service => !service.hasKey);
      const chunks = plan.tasks.flatMap(task => task.chunks);
      const newChunks = chunks.filter(chunk => chunk.cachedResult === undefined);
      let key: string;
      do {
        key = await showDialog({
          title: `重新检查${chapterName(chapter)}？`,
          message: '只检查当前定稿与相关设定。完整结果经校验后才发布；正文和正式设定由你决定。',
          notes: [
            ...plan.routes.map(serviceRoute => `冲突检查：${serviceRoute.name} · ${serviceRoute.model || '未绑定模型'} · ${serviceRoute.calls} 个新请求块`),
            ...boundServices.map(service => `发送至 ${new URL(service.baseUrl).host.toLowerCase()}`),
            `整个检查计划 ${plan.plannedCalls} 次请求，含重试与格式修复最多 ${plan.maxPosts} 次；预计输入合计约 ${plan.estimatedInputTokens} token，输出总预留上限 ${plan.maxReservedOutputTokens} token。服务价格未知，费用未知。`,
            ...(chunks.length > newChunks.length ? [`${chunks.length - newChunks.length} 个请求块可复用依赖仍有效的本地结果；实际发送只含新请求块。`] : []),
            ...(plan.reason ? [plan.reason, '请处理后重新预览，不会发送这份计划。'] : missingKey ? ['绑定服务缺少 API Key，请补充后重新预览。'] : ['预览与后台发送使用同一份不可变计划；后续重试共享这里的总预算。']),
          ],
          buttons: [
            { key: 'cancel', label: '取消' },
            { key: 'preview', label: '查看发送内容' },
            ...(!plan.eligible && plan.pauseReason === 'no_service' || missingKey ? [{ key: 'configure', label: missingKey ? '补充 API Key' : '配置模型服务', style: 'primary' as const }] : plan.eligible ? [{ key: 'recheck', label: '确认并加入检查', style: 'primary' as const }] : []),
          ], dismissKey: 'cancel', vertical: true,
        });
        if (key === 'preview') {
          await showDialog({ title: '本次实际发送内容', message: '这是刚才确认范围的完整请求。返回后仍使用同一份计划。',
            notes: chunks.length ? chunks.map((chunk, index) => `冲突检查 · 第 ${index + 1} 块${chunk.cachedResult === undefined ? '' : '（复用本地结果，不发送）'} · ${chunk.contextPlan.serviceSnapshot.name}\n${chunk.contextPlan.serviceSnapshot.model}\n${chunk.contextPlan.serializedRequest}`) : [plan.reason ?? '这份计划没有需要发送的请求。'],
            buttons: [{ key: 'back', label: '返回检查确认', style: 'primary' }], dismissKey: 'back' });
        }
      } while (key === 'preview' && alive.current);
      if (key === 'configure') {
        setPickerOpen(false);
        navigation.navigate('ModelService', missingKey ? { mode: 'edit', from: 'error', serviceId: missingKey.id, focus: 'key' } : { mode: 'guide', from: 'error' });
      } else if (key === 'recheck') {
        const acknowledged = new Set<string>();
        for (const chunk of newChunks) {
          const host = await ai.noticeHost(chunk.contextPlan);
          if (host && !acknowledged.has(host)) {
            if (!await confirmAiData(host)) { return; }
            await ai.acknowledgeHost(host); acknowledged.add(host);
          }
        }
        if (!alive.current || !navigation.isFocused()) { return; }
        await conflicts.recheck(chapter.id, plan);
        setPickerOpen(false); toast('检查已加入后台任务'); await loaded.reload();
      }
    } catch (error) { if (alive.current) { await showError(error); } }
    finally { preparing.current = false; if (alive.current) { setBusy(false); } }
  };
  const scoped = loaded.data?.list.filter(conflict => (!chapterFilter || conflict.chapterId === chapterFilter) && (!entryId || conflict.entryId === entryId)) ?? [];
  const matches = (status: string, selectedFilter: string) => selectedFilter === 'all' || (selectedFilter === 'resolved' ? !['open', 'later'].includes(status) : status === selectedFilter);
  const selected = scoped.filter(conflict => matches(conflict.status, filter));
  const filteredChapter = loaded.data?.chapters.find(chapter => chapter.id === chapterFilter);
  const active = loaded.data?.tasks.filter(task => task.kind === 'detect_conflicts' && !['done', 'cancelled'].includes(task.status) && (!chapterFilter || task.chapterId === chapterFilter)) ?? [];
  const stalled = active.filter(task => ['paused', 'failed'].includes(task.status));
  const checking = active.filter(task => !['paused', 'failed'].includes(task.status));
  const numberLabel = (id: string | null) => { const ch = loaded.data?.chapters.find(item => item.id === id); return ch?.number ? `第 ${ch.number} 章` : '章节'; };
  const filterName = filteredChapter?.number ? `第 ${filteredChapter.number} 章` : filteredChapter?.title ?? '所选章节';
  const emptyTitle = filter === 'open' ? chapterFilter ? `${filterName}没有未处理的冲突` : '没有发现设定冲突。章节定稿后，AI 会对照档案检查' : '没有这类冲突记录。';
  return <View style={styles.root}><NavBar title="设定冲突" onBack={() => navigation.goBack()} right={<Button label="重新检查" variant="text" disabled={loaded.loading || busy} onPress={openPicker} />} />
    <FlatList data={selected} keyExtractor={item => item.id} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.section}>
      {checking.length ? <View style={local.grayBar}><Txt color={c.ink2}>正在检查{[...new Set(checking.map(task => numberLabel(task.chapterId)))].join('、')}…</Txt></View> : null}
      {stalled.length ? <View style={local.yellowBar}><Txt color={c.pend} style={local.flex}>{stalled.some(task => task.status === 'paused') ? '冲突检查已暂停' : '冲突检查没有完成'}</Txt>
        <Button label="查看" size="small" variant="text" onPress={() => navigation.navigate('Jobs', { workId })} /></View> : null}
      {chapterFilter ? <View style={styles.chips}><Chip label={`筛选：${filteredChapter ? chapterName(filteredChapter) : '所选章节'} ×`} accessibilityLabel="移除章节筛选，查看全书冲突" selected onPress={() => navigation.setParams({ chapterId: undefined })} /></View> : null}
      <View style={styles.chips}>{[['open', '待处理'], ['later', '稍后处理'], ['resolved', '已处理'], ['all', '全部']].map(([key, label]) => <Chip key={key} label={`${label} ${scoped.filter(conflict => matches(conflict.status, key)).length}`} selected={filter === key} onPress={() => setFilter(key)} />)}</View>
      {loaded.error ? <EmptyState title="冲突没有加载出来。" action={{ label: '重试', onPress: loaded.reload }} /> : null}
      {!loaded.data && loaded.loading ? <SkeletonCards /> : null}</View>}
      ListEmptyComponent={loaded.data && !loaded.error ? <EmptyState title={emptyTitle} message={active.length ? '检查还没有完成，完成后这里会自动更新。' : undefined} /> : undefined}
      renderItem={({ item }) => <ConflictCard conflict={item} onPress={() => openConflict(navigation, item.id)} />} />
    <Sheet visible={pickerOpen} title="选择要重新检查的章节" onRequestClose={() => setPickerOpen(false)} locked={busy}>
      <ScrollView contentContainerStyle={styles.content}>
        <Txt>一次检查一个当前定稿。已修改或未定稿的正文需要先在编辑器中确认定稿。</Txt>
        {loaded.data?.chapters.filter(chapter => chapter.kind === 'main').map(chapter => <Button key={chapter.id}
          label={`${chapterName(chapter)}${recheckChapterId === chapter.id ? ' ✓' : ''}${!eligible(chapter) ? chapter.state === 'modified' ? '（正文已修改）' : '（尚未定稿）' : ''}`}
          variant={recheckChapterId === chapter.id ? 'secondary' : 'quiet'} disabled={busy || !eligible(chapter)} onPress={() => setRecheckChapterId(chapter.id)} />)}
        {!loaded.data?.chapters.some(eligible) ? <Txt>还没有可检查的定稿章节。</Txt> : null}
        <Button label="预览整个检查" disabled={!recheckChapterId} loading={busy} onPress={() => { prepareRecheck(); }} />
        <Button label="关闭" variant="text" disabled={busy} onPress={() => setPickerOpen(false)} />
      </ScrollView>
    </Sheet>
  </View>;
}

function ConflictCard({ conflict, onPress }: { conflict: ConflictView; onPress(): void }) {
  const heading = chapterHeading(conflict.chapter);
  const title = conflictTitle(conflict);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}，${SEVERITY_LABEL[conflict.severity]}严重度，去处理`} onPress={onPress} style={styles.card}>
    <View style={local.row}><Txt variant="headline" style={local.flex} numberOfLines={1}>{title}</Txt>
      <Badge label={`${SEVERITY_LABEL[conflict.severity]}严重度`} tone={conflict.severity === 'low' ? 'neutral' : conflict.severity === 'high' ? 'conflict' : 'pending'} /></View>
    <Txt color={c.ink2} numberOfLines={2}>{conflict.explanation}</Txt>
    {conflict.status !== 'open' ? <Txt variant="caption" color={c.ink3}>{resolutionLabel(conflict)}</Txt> : null}
    <View style={local.row}><Txt variant="caption" color={c.ink3} style={local.flex} numberOfLines={1}>{heading ?? '档案之间'}</Txt>
      <Txt variant="callout" color={c.brand}>{['open', 'later'].includes(conflict.status) ? '去处理 ›' : '查看 ›'}</Txt></View>
  </Pressable>;
}
const local = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  grayBar: { backgroundColor: c.sunken, borderRadius: radius.small, padding: 12 },
  yellowBar: { backgroundColor: c.pendTint, borderRadius: radius.small, paddingHorizontal: 12, paddingVertical: 4, flexDirection: 'row', alignItems: 'center' },
});
