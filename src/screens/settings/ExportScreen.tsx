import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { Check, ChevronRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLoad } from '../../app/hooks';
import { showError, showErrorDetail, toAppError } from '../../app/errors';
import type { ExportFrom, ExportMode, RootScreenProps } from '../../app/navigation/types';
import { Button } from '../../components/Button';
import { NavBar } from '../../components/NavBar';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import { showDialog, toast } from '../../components/overlay/store';
import * as documents from '../../features/backupFiles';
import * as chapters from '../../features/chapters';
import * as works from '../../features/works';
import type { ChapterListItem, Volume, WorkSummary } from '../../features/types';
import { exportText as x } from '../../locales/settings';
import { color as c, maxContentWidth, pageMargin, radius, rowMinHeight } from '../../theme/tokens';
import { chapterHeading, formatChars } from '../../utils/format';

type Format = 'txt' | 'md';
type Range = 'all' | 'pick';

/** S15b #4: the format is remembered for the app session (initially TXT). */
let lastFormat: Format = 'txt';

const BACK: Record<ExportFrom, string> = { settings: '设置', shelf: '书架', chapters: '章节', editor: '编辑器' };

/** S15b 副标题: 正文 N 章 · 番外 M 章 · 总字数 (番外 omitted when there are none). */
export function workStats(w: Pick<WorkSummary, 'chapterCount' | 'extraCount' | 'charCount'>): string {
  return [x.mainCount(w.chapterCount), ...(w.extraCount ? [x.extraCount(w.extraCount)] : []), formatChars(w.charCount)].join(' · ');
}

/**
 * S15b export page. Three modes share one work selection; entry parameters only
 * preselect (S15b rule 5). Generating locks the form and the back gesture.
 */
export function ExportScreen({ navigation, route }: RootScreenProps<'Export'>) {
  const params = route.params ?? {};
  const insets = useSafeAreaInsets();
  const initialMode: ExportMode = params.chapterId ? 'text' : params.mode ?? (params.workId ? 'work' : 'all');
  const [mode, setMode] = useState<ExportMode>(initialMode);
  const [workId, setWorkId] = useState<string | null>(params.workId ?? null);
  const [format, setFormatState] = useState<Format>(lastFormat);
  const [range, setRange] = useState<Range>(params.chapterId ? 'pick' : 'all');
  const [picked, setPicked] = useState<string[]>(params.chapterId ? [params.chapterId] : []);
  const [includeExtras, setIncludeExtras] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'work' | 'chapters' | null>(null);
  const busyRef = useRef(false);
  usePreventRemove(busy, () => {});

  const all = useLoad(() => works.list(), [], { refetchOnFocus: true, events: {
    'work.created': () => true, 'work.updated': () => true, 'work.removed': () => true, 'chapters.changed': () => true, 'chapter.saved': () => true,
  } });
  const groups = useLoad(async () => workId ? (await chapters.list(workId))
    .map(g => ({ volume: g.volume, chapters: g.chapters.filter(ch => ch.kind !== 'draft') })) : [], [workId], {
    events: { 'chapters.changed': e => e.workId === workId },
  });

  const list = all.data ?? [];
  const work = list.find(w => w.id === workId) ?? null;
  const exportable = (groups.data ?? []).flatMap(g => g.chapters);
  const mains = exportable.filter(ch => ch.kind === 'main');
  const hasExtras = exportable.some(ch => ch.kind === 'extra');
  const livePicked = picked.filter(id => exportable.some(ch => ch.id === id));

  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, [busy]);

  const setFormat = (value: Format) => { lastFormat = value; setFormatState(value); };
  const chooseWork = (id: string) => {
    if (id !== workId) { setPicked([]); setRange('all'); setIncludeExtras(false); }
    setInlineError(null); setWorkId(id); setSheet(null);
  };

  const noWorks = all.data !== undefined && list.length === 0;
  const noText = mode === 'text' && !!work && groups.data !== undefined && exportable.length === 0;
  const ready = !noWorks && (mode === 'all' || (!!work && (mode === 'work' || (!noText && (range === 'all' ? mains.length > 0 || includeExtras && hasExtras : livePicked.length > 0)))));

  const run = async () => {
    if (busyRef.current || !ready) { return; }
    busyRef.current = true; setBusy(true); setInlineError(null);
    try {
      const chapterIds = mode !== 'text' ? undefined : range === 'pick' ? livePicked
        : includeExtras ? exportable.filter(ch => ch.kind === 'main' || ch.kind === 'extra').map(ch => ch.id) : undefined;
      const result = await documents.share(mode === 'text' ? { format, workId: workId!, chapterIds }
        : { format: 'backup', workId: mode === 'work' ? workId! : undefined });
      if (result === 'completed') { toast('已导出'); } else if (result === 'opened') { toast('已打开系统分享'); }
    } catch (error) {
      const err = toAppError(error);
      if (err.code === 'NOT_FOUND' && mode !== 'all') {
        toast(x.workGone); setWorkId(null); setPicked([]); setRange('all'); await all.reload();
      } else if (err.code === 'VALIDATION' && mode === 'text') {
        setInlineError(range === 'pick' ? x.pickedGone : err.message); await groups.reload();
      } else if (err.code === 'STORAGE_FULL' || err.code === 'DB_ERROR') {
        const summary = err.code === 'STORAGE_FULL' ? x.storageFull : err.message === x.shareFailed ? x.shareFailed : x.failed;
        const action = await showDialog({ title: x.failedTitle, message: summary,
          buttons: [...(err.code === 'DB_ERROR' ? [{ key: 'detail', label: '查看详情' }] : []), { key: 'close', label: '知道了', style: 'primary' as const }], dismissKey: 'close' });
        if (action === 'detail') { await showErrorDetail(err, summary); }
      } else { await showError(err); }
    } finally { busyRef.current = false; setBusy(false); }
  };

  const totalChars = list.reduce((sum, w) => sum + w.charCount, 0);
  const info = mode === 'all' ? [x.allSummary(list.length, formatChars(totalChars)), ...x.backupIncludes, ...x.backupExcludes]
    : mode === 'work' ? [x.workIncludes, ...x.backupExcludesWork] : [format === 'md' ? x.mdSample : x.txtSample, x.textOnly];

  return <View style={styles.root}>
    <NavBar title="导出" backLabel={BACK[params.from ?? 'settings']} onBack={() => { if (!busyRef.current) { navigation.goBack(); } }} />
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
      <Segmented<ExportMode> value={mode} locked={busy} onChange={next => { setInlineError(null); setMode(next); }}
        segments={[{ key: 'all', label: '全部作品备份' }, { key: 'work', label: '单部备份' }, { key: 'text', label: '导出正文' }]} />

      {mode !== 'all' ? <><Group title="作品" /><View style={styles.card}>
        <Row title={work ? work.title ?? '未命名作品' : x.pickWork} subtitle={work ? workStats(work) : undefined} disabled={busy || noWorks}
          onPress={() => setSheet('work')} chevron />
      </View></> : null}

      {mode === 'text' && work ? <>
        <Group title="格式" />
        <Segmented<Format> value={format} locked={busy} onChange={setFormat} segments={[{ key: 'txt', label: 'TXT' }, { key: 'md', label: 'Markdown' }]} />
        <Group title="章节范围" />
        <View style={styles.card}>
          <Row title={x.allMain(mains.length)} selected={range === 'all'} disabled={busy} onPress={() => { setInlineError(null); setRange('all'); }} radio />
          <Row title={x.pickChapters} subtitle={livePicked.length ? x.picked(livePicked.length) : x.nonePicked} selected={range === 'pick'} disabled={busy || !exportable.length}
            onPress={() => { setInlineError(null); setRange('pick'); setSheet('chapters'); }} radio separated />
          {range === 'all' && hasExtras ? <View style={[styles.row, styles.sep]}>
            <Txt style={styles.flex}>{x.includeExtras(exportable.filter(ch => ch.kind === 'extra').length)}</Txt>
            <Switch value={includeExtras} disabled={busy} onValueChange={setIncludeExtras} accessibilityLabel="包含番外" />
          </View> : null}
        </View>
      </> : null}

      <View style={styles.info}>
        {noWorks ? <Txt>{x.noWorks}</Txt> : noText ? <Txt>{x.noText}</Txt> : info.map((line, i) => <Txt key={i} variant="callout" color={c.ink2}>{line}</Txt>)}
        {mode !== 'text' && !noWorks ? <Txt weight="600">{x.noKey}</Txt> : null}
      </View>

      {inlineError ? <Txt color={c.conf} accessibilityRole="alert">{inlineError}</Txt> : null}
      <Button label={busy ? '正在生成…' : mode === 'text' ? '生成并分享' : '生成备份文件并分享'} disabled={busy || !ready}
        icon={busy ? <ActivityIndicator size="small" color={c.white} /> : undefined} onPress={() => { run(); }} />
      {busy && slow ? <Txt variant="caption" color={c.ink3} align="center">{x.slow}</Txt> : null}
    </ScrollView>

    <Sheet visible={sheet === 'work'} title="选择作品" onRequestClose={() => setSheet(null)}>
      <ScrollView contentContainerStyle={styles.sheet}>
        {list.map((w, i) => <Row key={w.id} title={w.title ?? '未命名作品'} subtitle={workStats(w)} selected={w.id === workId} radio separated={i > 0} onPress={() => chooseWork(w.id)} />)}
      </ScrollView>
    </Sheet>
    <ChapterSelectSheet visible={sheet === 'chapters'} groups={groups.data ?? []} value={livePicked}
      onClose={() => setSheet(null)} onDone={ids => { setPicked(ids); setSheet(null); }} />
  </View>;
}

/** S15b #5 弹窗: chapters grouped by volume (drafts excluded), multi-select with 全选 / 全不选. */
function ChapterSelectSheet({ visible, groups, value, onClose, onDone }: {
  visible: boolean; groups: { volume: Volume; chapters: ChapterListItem[] }[]; value: string[]; onClose: () => void; onDone: (ids: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(value);
  const valueKey = value.join(',');
  useEffect(() => { if (visible) { setDraft(valueKey ? valueKey.split(',') : []); } }, [visible, valueKey]);
  const ids = groups.flatMap(g => g.chapters.map(ch => ch.id));
  const allOn = ids.length > 0 && ids.every(id => draft.includes(id));
  const toggle = (id: string) => setDraft(old => old.includes(id) ? old.filter(item => item !== id) : [...old, id]);
  return <Sheet visible={visible} title="选择章节" subtitle={x.picked(draft.length)} onRequestClose={onClose}
    headerLeft={<Button label={allOn ? '全不选' : '全选'} variant="text" size="small" onPress={() => setDraft(allOn ? [] : ids)} />}
    headerRight={<Button label="确定" variant="text" size="small" strong onPress={() => onDone(ids.filter(id => draft.includes(id)))} />}>
    <ScrollView contentContainerStyle={styles.sheet}>
      {groups.filter(g => g.chapters.length).map(g => <View key={g.volume.id}>
        <Txt variant="caption" color={c.ink3} style={styles.volume}>{g.volume.title}</Txt>
        {g.chapters.map((ch, i) => <Row key={ch.id} title={chapterHeading(ch)} selected={draft.includes(ch.id)} check separated={i > 0} onPress={() => toggle(ch.id)} />)}
      </View>)}
    </ScrollView>
  </Sheet>;
}

function Group({ title }: { title: string }) {
  return <Txt variant="callout" color={c.ink2} style={styles.group}>{title}</Txt>;
}

function Row({ title, subtitle, onPress, disabled, selected, radio, check, chevron, separated }: {
  title: string; subtitle?: string; onPress: () => void; disabled?: boolean; selected?: boolean;
  radio?: boolean; check?: boolean; chevron?: boolean; separated?: boolean;
}) {
  const role = radio ? 'radio' : check ? 'checkbox' : 'button';
  return <Pressable onPress={disabled ? undefined : onPress} accessibilityRole={role} accessibilityLabel={title}
    accessibilityState={{ disabled: !!disabled, ...(radio || check ? { checked: !!selected } : {}) }}
    style={({ pressed }) => [styles.row, separated && styles.sep, pressed && !disabled && styles.pressed, disabled && styles.disabled]}>
    <View style={styles.flex}>
      <Txt numberOfLines={1}>{title}</Txt>
      {subtitle ? <Txt variant="caption" color={c.ink3} numberOfLines={1}>{subtitle}</Txt> : null}
    </View>
    {radio ? <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.dot} /> : null}</View> : null}
    {check ? <View style={[styles.box, selected && styles.boxOn]}>{selected ? <Check size={14} color={c.white} /> : null}</View> : null}
    {chevron ? <ChevronRight size={18} color={c.ink3} /> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  content: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingHorizontal: pageMargin, paddingTop: 12, gap: 12 },
  group: { marginTop: 8 },
  card: { backgroundColor: c.surface, borderRadius: radius.card, overflow: 'hidden' },
  row: { minHeight: rowMinHeight, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  pressed: { backgroundColor: c.sunken },
  disabled: { opacity: 0.45 },
  flex: { flex: 1, gap: 2 },
  info: { marginTop: 8, padding: 16, borderRadius: radius.card, backgroundColor: c.brandTint, gap: 6 },
  sheet: { paddingBottom: 24 },
  volume: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: c.ink3, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: c.brand },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.brand },
  box: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: c.ink3, alignItems: 'center', justifyContent: 'center' },
  boxOn: { borderColor: c.brand, backgroundColor: c.brand },
});
