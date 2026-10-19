import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePreventRemove } from '@react-navigation/native';
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showError, toAppError } from '../../app/errors';
import { useDirtyGuard, useLoad } from '../../app/hooks';
import { BookCover } from '../../components/BookCover';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { DelayedSpinner } from '../../components/Loading';
import { NavBar } from '../../components/NavBar';
import { Segmented } from '../../components/Segmented';
import { Txt } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { toast } from '../../components/overlay/store';
import { isAppError } from '../../features/errors';
import { on } from '../../features/events';
import type { Genre, Work, WorkStatus } from '../../features/types';
import * as works from '../../features/works';
import { workCopy } from '../../locales/work';
import { t } from '../../locales/zh-CN';
import { color as c, maxContentWidth, pageMargin } from '../../theme/tokens';
import { removeWork } from '../shelf/WorkActionsSheet';
import { CoverProgress, CoverSheet } from './CoverSheet';
import type { RootScreenProps } from '../../app/navigation/types';

const copy = workCopy.info;
const genres = Object.keys(workCopy.genres) as Genre[];

interface Form {
  title: string;
  genre: Genre | null;
  premise: string;
  styleNote: string;
  plannedChapters: string;
  status: WorkStatus;
}

const toForm = (work: Work): Form => ({
  title: work.title ?? '', genre: work.genre, premise: work.premise, styleNote: work.styleNote ?? '',
  plannedChapters: work.plannedChapters == null ? '' : String(work.plannedChapters), status: work.status,
});

/** Only changed, normalized fields are sent to works.update (S05a §5). */
function changes(form: Form, work: Work): works.WorkPatch {
  const patch: works.WorkPatch = {};
  if (form.title.trim() !== (work.title ?? '')) { patch.title = form.title.trim(); }
  if (form.genre !== work.genre) { patch.genre = form.genre; }
  if (form.premise.trim() !== work.premise) { patch.premise = form.premise.trim(); }
  if (form.styleNote.trim() !== (work.styleNote ?? '')) { patch.styleNote = form.styleNote.trim() || null; }
  const planned = form.plannedChapters === '' ? null : Number(form.plannedChapters);
  if (planned !== work.plannedChapters) { patch.plannedChapters = planned; }
  if (form.status !== work.status) { patch.status = form.status; }
  return patch;
}

/** S05a: explicit save, D04 on every navigation exit, deletion with D02 and undo. */
export function WorkInfoScreen({ navigation, route }: RootScreenProps<'WorkInfo'>) {
  const { workId, from } = route.params;
  const insets = useSafeAreaInsets();
  const loaded = useLoad(() => works.get(workId), [workId], {
    // D06 updates the preview without overwriting this form's draft.
    events: { 'work.updated': p => p.workId === workId },
  });
  const baseline = useRef<Work | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const mutating = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [coverOpen, setCoverOpen] = useState(false);

  useEffect(() => {
    if (loaded.data && baseline.current?.id !== workId) {
      baseline.current = loaded.data;
      setForm(toForm(loaded.data));
    }
  }, [loaded.data, workId]);

  const patch = useMemo(() => form && baseline.current ? changes(form, baseline.current) : {}, [form]);
  const dirty = Object.keys(patch).length > 0;
  usePreventRemove(busy, () => {});
  const leave = useDirtyGuard(dirty && !busy);
  const shelf = () => leave(() => navigation.popTo('Shelf'));

  useEffect(() => on('work.removed', p => {
    // Our delete awaits D02 first so its undo toast is already ready when we leave.
    if (p.workId === workId && !mutating.current) {
      toast(t.errors.workGone);
      leave(() => navigation.popTo('Shelf'));
    }
  }), [leave, navigation, workId]);

  useEffect(() => {
    if (!loaded.error) { return; }
    if (isAppError(loaded.error, 'NOT_FOUND')) {
      toast(t.errors.workGone);
      leave(() => navigation.popTo('Shelf'));
    } else {
      showError(loaded.error, { title: copy.loadFailed });
    }
  }, [loaded.error, leave, navigation]);

  const premiseError = form && !form.premise.trim() ? copy.premiseEmpty : fieldErrors.premise;
  const plannedError = form && form.plannedChapters !== '' && Number(form.plannedChapters) < 1 ? copy.plannedRange : fieldErrors.plannedChapters;
  const invalid = !!(premiseError || plannedError);

  const edit = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm(prev => prev ? { ...prev, [key]: value } : prev);
    setFieldErrors(prev => ({ ...prev, [key]: '' }));
  };

  const save = async () => {
    if (!dirty || invalid || mutating.current) { return; }
    mutating.current = true;
    setBusy(true);
    Keyboard.dismiss();
    try {
      await works.update(workId, patch);
      mutating.current = false;
      setBusy(false);
      toast(t.common.saved);
      leave(() => navigation.goBack());
    } catch (e) {
      mutating.current = false;
      setBusy(false);
      const error = toAppError(e);
      if (error.code === 'NOT_FOUND') {
        toast(t.errors.workGone);
        shelf();
      } else if (error.code === 'VALIDATION' && error.field) {
        setFieldErrors(prev => ({ ...prev, [error.field!]: error.message }));
      } else {
        showError(error, { title: t.errors.notSaved });
      }
    }
  };

  const remove = async () => {
    if (mutating.current || !loaded.data) { return; }
    mutating.current = true;
    const removed = await removeWork(loaded.data);
    mutating.current = false;
    if (removed) { shelf(); }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <NavBar title={copy.title} backLabel={from === 'shelf' ? copy.backShelf : copy.backOverview}
        onBack={busy ? undefined : () => navigation.goBack()}
        right={<Button label={t.common.save} variant="text" loading={busy} disabled={!dirty || invalid} onPress={save} />} />
      {loaded.loading || !form && !loaded.error ? <DelayedSpinner /> : !form || !loaded.data ? (
        <EmptyState title={copy.loadFailed} action={{ label: t.common.reload, onPress: loaded.reload }} style={styles.fill} />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable onPress={busy ? undefined : () => { Keyboard.dismiss(); setCoverOpen(true); }}
            accessibilityRole="button" accessibilityLabel={copy.changeCover} style={styles.cover}>
            <View><BookCover title={form.title} genre={form.genre} cover={loaded.data.cover} version={loaded.data.updatedAt} width={54} /><CoverProgress workId={workId} /></View>
            <Txt color={c.brand}>{copy.changeCover}</Txt>
          </Pressable>
          <TextField label={copy.titleLabel} accessibilityLabel={copy.titleLabel} placeholder={copy.titlePlaceholder}
            value={form.title} onChangeText={v => edit('title', v)} max={30} counter="always"
            autoFocus={from === 'shelf'} editable={!busy} error={fieldErrors.title}
            onOverflow={() => setFieldErrors(prev => ({ ...prev, title: t.newWork.titleTooLong }))} />
          <View style={styles.group}>
            <Txt variant="callout" color={c.ink2}>{copy.genreLabel}</Txt>
            <View style={styles.chips}>{genres.map(g => <Chip key={g} label={workCopy.genres[g]} selected={form.genre === g}
              disabled={busy} onPress={() => edit('genre', form.genre === g ? null : g)} />)}</View>
          </View>
          <TextField label={copy.premiseLabel} accessibilityLabel={copy.premiseLabel} value={form.premise}
            onChangeText={v => edit('premise', v)} max={2000} counter="always" multiline minLines={3} maxLines={6}
            editable={!busy} error={premiseError} onOverflow={() => setFieldErrors(prev => ({ ...prev, premise: t.newWork.premiseTooLong }))} />
          <TextField label={copy.styleLabel} accessibilityLabel={copy.styleLabel} placeholder={copy.stylePlaceholder}
            value={form.styleNote} onChangeText={v => edit('styleNote', v)} max={500} counter="always" multiline minLines={2} maxLines={4}
            editable={!busy} error={fieldErrors.styleNote} onOverflow={() => setFieldErrors(prev => ({ ...prev, styleNote: copy.styleTooLong }))} />
          <TextField label={copy.plannedLabel} accessibilityLabel={copy.plannedLabel} placeholder={copy.plannedPlaceholder}
            value={form.plannedChapters} onChangeText={v => edit('plannedChapters', v.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad" editable={!busy} error={plannedError} />
          <View style={styles.group}>
            <Txt variant="callout" color={c.ink2}>{copy.statusLabel}</Txt>
            <Segmented value={form.status} onChange={v => edit('status', v)} locked={busy}
              segments={[{ key: 'ongoing', label: copy.ongoing }, { key: 'finished', label: copy.finished }]} />
          </View>
          <Button label={copy.remove} variant="quiet" disabled={busy} onPress={remove} />
        </ScrollView>
      )}
      {loaded.data ? <CoverSheet workId={workId} title={loaded.data.title} cover={loaded.data.cover} visible={coverOpen} onClose={() => setCoverOpen(false)} /> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  fill: { flex: 1 },
  form: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', padding: pageMargin, gap: 20 },
  group: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cover: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 4 },
});
