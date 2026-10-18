import React, { useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ChevronRight, MoreHorizontal, Plus } from 'lucide-react-native';
import { showError } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import { useWorkId } from '../../app/navigation/WorkContext';
import { Badge, type BadgeTone } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { DelayedSpinner } from '../../components/Loading';
import { NavBar } from '../../components/NavBar';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import * as chapters from '../../features/chapters';
import { isAppError } from '../../features/errors';
import { on } from '../../features/events';
import * as jobs from '../../features/jobs';
import type { Job, JobKind, Overview } from '../../features/types';
import * as works from '../../features/works';
import { workCopy } from '../../locales/work';
import { t } from '../../locales/zh-CN';
import { color as c, font, genreColor, maxContentWidth, pageMargin, radius } from '../../theme/tokens';
import { chapterHeading, formatChars, formatTime, genreLabel } from '../../utils/format';
import { ChapterFormSheet } from './ChapterFormSheet';
import type { WorkTabScreenProps } from '../../app/navigation/types';

const copy = workCopy.overview;
const STAGE: Record<JobKind, number> = { summarize: 1, extract_memory: 2, detect_conflicts: 3 };

const currentJob = (list: Job[]) => list.find(j => j.status === 'running') ?? list.find(j => j.status === 'queued');

async function chapterIfLive(id: string | null | undefined) {
  if (!id) { return null; }
  try { return await chapters.get(id); } catch (e) {
    if (isAppError(e, 'NOT_FOUND')) { return null; }
    throw e;
  }
}

/** S05: every statistic comes from the local service layer and updates on its events. */
export function OverviewScreen({ navigation }: WorkTabScreenProps<'Overview'>) {
  const workId = useWorkId();
  const focused = useIsFocused();
  const [creating, setCreating] = useState(false);
  const previous = useRef<Overview['pending'] | null>(null);
  const loaded = useLoad(async () => {
    const [work, overview, activeJobs] = await Promise.all([
      works.get(workId), works.overview(workId), jobs.list(workId, { active: true }),
    ]);
    const job = currentJob(activeJobs);
    const [last, jobChapter] = await Promise.all([
      chapterIfLive(overview.lastEdited?.chapterId), chapterIfLive(job?.chapterId),
    ]);
    return { work, overview, activeJobs, last, jobChapter };
  }, [workId], {
    refetchOnFocus: true,
    events: {
      'work.updated': p => p.workId === workId,
      'chapters.changed': p => p.workId === workId,
      'chapter.saved': p => p.workId === workId,
      'entries.changed': p => p.workId === workId,
      'proposals.changed': p => p.workId === workId,
      'conflicts.changed': p => p.workId === workId,
      'jobs.changed': p => p.workId === workId,
    },
  });

  useEffect(() => on('work.removed', p => {
    // A covering WorkInfo screen owns its deletion flow and D04 bypass.
    if (p.workId === workId && focused) {
      toast(t.errors.workGone);
      navigation.popTo('Shelf');
    }
  }), [focused, navigation, workId]);

  useEffect(() => {
    if (!loaded.error) { return; }
    if (isAppError(loaded.error, 'NOT_FOUND')) {
      toast(t.errors.workGone);
      navigation.popTo('Shelf');
    } else {
      showError(loaded.error, { title: copy.loadFailed });
    }
  }, [loaded.error, navigation]);

  useEffect(() => {
    const pending = loaded.data?.overview.pending;
    if (!pending) { return; }
    const prev = previous.current;
    if (prev && focused) {
      const message = [pending.proposals > prev.proposals ? copy.newProposals(pending.proposals - prev.proposals) : '',
        pending.conflicts > prev.conflicts ? copy.newConflicts(pending.conflicts - prev.conflicts) : ''].filter(Boolean).join('，');
      if (message) { toast(message); }
    }
    previous.current = pending;
  }, [loaded.data, focused]);

  const info = () => navigation.navigate('WorkInfo', { workId, from: 'overview' });
  const data = loaded.data;
  const overview = data?.overview;
  const pending = overview?.pending;
  const hasPending = !!pending && pending.conflicts + pending.proposals + pending.activeJobs + pending.failedJobs > 0;
  const failed = data?.activeJobs.filter(j => j.status === 'failed').length ?? 0;
  const paused = data?.activeJobs.filter(j => j.status === 'paused').length ?? 0;
  const activeJob = currentJob(data?.activeJobs ?? []);
  const jobsTitle = failed ? copy.jobsFailed(failed) : paused ? copy.jobsPaused(paused) :
    activeJob?.status === 'running' ? copy.jobsRunning(data?.jobChapter?.number ?? null, STAGE[activeJob.kind]) : copy.jobsQueued;

  return (
    <View style={styles.root}>
      <NavBar title={data?.work.title ?? t.common.untitledWork} backLabel={t.tabs.backToShelf}
        onBack={() => navigation.popTo('Shelf')}
        right={<IconButton label={copy.info} onPress={info}><MoreHorizontal size={24} color={c.ink} strokeWidth={1.75} /></IconButton>} />
      <View style={[styles.band, { backgroundColor: genreColor(data?.work.genre) }]} />
      {loaded.loading ? <DelayedSpinner /> : !data || !overview ? (
        <EmptyState title={copy.loadFailed} action={{ label: t.common.reload, onPress: loaded.reload }} style={styles.fill} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={info} accessibilityRole="button" accessibilityLabel={copy.info} style={styles.card}>
            <View style={styles.row}>
              <Txt variant="title2" style={styles.workName}>{data.work.title ?? t.common.untitledWork}</Txt>
              <Badge label={data.work.status === 'ongoing' ? copy.ongoing : copy.finished} tone="neutral" />
            </View>
            <Txt variant="callout" color={c.ink3} numeric>{[
              genreLabel(data.work.genre), overview.plannedChapters == null ? copy.mainCount(overview.chapterCount) :
                copy.plannedProgress(overview.chapterCount, overview.plannedChapters), formatChars(overview.charCount),
            ].filter(Boolean).join('  ')}</Txt>
            {overview.plannedChapters != null ? <View style={styles.track} accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: overview.plannedChapters, now: Math.min(overview.chapterCount, overview.plannedChapters) }}>
              <View style={[styles.progress, { width: `${Math.min(1, overview.chapterCount / overview.plannedChapters) * 100}%` }]} />
            </View> : null}
            <Txt variant="callout" color={c.ink2} numberOfLines={2}>{data.work.premise}</Txt>
          </Pressable>
          <Pressable style={[styles.card, styles.continue]} accessibilityRole="button"
            accessibilityLabel={data.last ? copy.continueWriting : copy.newFirstChapter}
            onPress={() => data.last ? navigation.navigate('Editor', { workId, chapterId: data.last.id }) : setCreating(true)}>
            {data.last ? <>
              <View style={styles.row}>
                <Txt variant="callout" color={c.brand} weight="600">{copy.continueWriting}</Txt>
                <Txt variant="caption" color={c.ink3}>{formatTime(data.last.updatedAt)}</Txt>
              </View>
              <Txt variant="headline">{chapterHeading(data.last)}</Txt>
              <Txt variant="prose" color={c.ink3} numberOfLines={2}>{overview.lastEdited?.excerpt || copy.noBodyYet}</Txt>
            </> : <View style={styles.newChapter}><Plus size={20} color={c.brand} /><Txt color={c.brand} weight="600">{copy.newFirstChapter.replace('＋ ', '')}</Txt></View>}
          </Pressable>
          {hasPending ? <View style={styles.section}>
            <Txt variant="headline">{copy.pending}</Txt>
            <View style={styles.list}>
              {pending!.conflicts > 0 ? <PendingRow label={copy.conflicts(pending!.conflicts)} tone="conflict" onPress={() => navigation.navigate('Conflicts', { workId })} /> : null}
              {pending!.proposals > 0 ? <PendingRow label={copy.proposals(pending!.proposals)} tone="pending" onPress={() => navigation.navigate('Review', { workId })} /> : null}
              {data.activeJobs.length > 0 ? <PendingRow label={jobsTitle} tone={failed ? 'conflict' : 'pending'}
                detail={!failed && !paused && activeJob?.status === 'running' ? copy.jobSteps[activeJob.kind] : undefined}
                onPress={() => navigation.navigate('Jobs', { workId })} /> : null}
            </View>
          </View> : null}
          <View style={styles.section}>
            <View style={styles.row}>
              <Txt variant="headline">{copy.archive}</Txt>
              <Pressable onPress={() => navigation.navigate('Archive')} accessibilityRole="button" style={styles.viewAll}>
                <Txt variant="callout" color={c.brand}>{copy.viewAll}</Txt>
              </Pressable>
            </View>
            <View style={styles.archive}>
              {[[copy.characters, overview.archive.characters], [copy.settings, overview.archive.others],
                [copy.foreshadows, overview.archive.foreshadowsOpen]].map(([label, count]) => (
                <Pressable key={label} style={[styles.card, styles.stat]} accessibilityRole="button"
                  accessibilityLabel={`${label}，${count}`} onPress={() => navigation.navigate('Archive', { type: label === copy.characters ? 'character' : label === copy.foreshadows ? 'foreshadow' : 'world' })}>
                  <Txt variant="title2" numeric>{count}</Txt><Txt variant="caption" color={c.ink3} align="center">{label}</Txt>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
      <ChapterFormSheet visible={creating} mode="create" workId={workId} onRequestClose={() => setCreating(false)}
        onCreated={chapter => { setCreating(false); navigation.navigate('Editor', { workId, chapterId: chapter.id }); }} />
    </View>
  );
}

function PendingRow({ label, tone, detail, onPress }: { label: string; tone: BadgeTone; detail?: string; onPress: () => void }) {
  return <Pressable style={styles.pendingRow} accessibilityRole="button" accessibilityLabel={label}
    onPress={onPress}>
    <View style={styles.pendingText}><Badge label={label} tone={tone} />
      {detail ? <Txt variant="caption" color={c.ink3}>{detail}</Txt> : null}</View>
    <ChevronRight size={18} color={c.ink3} />
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  fill: { flex: 1 },
  band: { height: 4 },
  content: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', padding: pageMargin, gap: 20, paddingBottom: 32 },
  card: { backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: radius.card, padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  workName: { flex: 1, fontFamily: font.serif },
  continue: { borderColor: c.brand },
  track: { height: 4, backgroundColor: c.sunken, borderRadius: radius.pill, overflow: 'hidden' },
  progress: { height: 4, backgroundColor: c.brand },
  newChapter: { minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  section: { gap: 12 },
  list: { borderColor: c.line, borderWidth: 1, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden' },
  pendingRow: { minHeight: 64, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomColor: c.line, borderBottomWidth: StyleSheet.hairlineWidth },
  pendingText: { flex: 1, gap: 6 },
  viewAll: { minHeight: 44, justifyContent: 'center' },
  archive: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 12 },
});
