import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextInputInstance,
} from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { confirmDiscard } from '../../app/dialogs';
import { showError, toAppError } from '../../app/errors';
import { ActionSheet } from '../../components/ActionSheet';
import { Button } from '../../components/Button';
import { DelayedSpinner } from '../../components/Loading';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { toast } from '../../components/overlay/store';
import * as chapters from '../../features/chapters';
import type { Chapter, ChapterKind, ID } from '../../features/types';
import * as volumes from '../../features/volumes';
import { chapterText as text } from '../../locales/chapters';
import { t } from '../../locales/zh-CN';
import { color as c, radius } from '../../theme/tokens';
import {
  defaultVolume,
  mainNumberAt,
  type ChapterGroup,
} from './chapterLayout';

export interface ChapterFormSheetProps {
  visible: boolean;
  workId: ID;
  mode: 'create' | 'edit';
  chapterId?: ID;
  volumeId?: ID;
  onRequestClose: () => void;
  onCreated?: (chapter: Chapter) => void;
  onSaved?: () => void;
  onGone?: () => void;
}

type Fields = { title: string; kind: ChapterKind; volumeId: ID };

/** S06a: shared create/edit form. Input is kept local until a single service mutation. */
export function ChapterFormSheet(props: ChapterFormSheetProps) {
  const { visible, workId, mode, chapterId, volumeId, onRequestClose } = props;
  const [groups, setGroups] = useState<ChapterGroup[]>([]);
  const [fields, setFields] = useState<Fields>({
    title: '',
    kind: 'main',
    volumeId: '',
  });
  const [original, setOriginal] = useState<Fields | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [pickerMounted, setPickerMounted] = useState(false);
  const [autoTitle, setAutoTitle] = useState(true);
  const [shown, setShown] = useState(false);
  const titleInput = useRef<TextInputInstance>(null);
  const latest = useRef(props);
  latest.current = props;
  const loadId = useRef(0);

  const gone = () => {
    toast(text.chapterGone);
    latest.current.onRequestClose();
    latest.current.onGone?.();
  };
  const load = async () => {
    const seq = ++loadId.current;
    setLoading(true);
    setFailure(null);
    try {
      const [items, vs, ch] = await Promise.all([
        chapters.list(workId),
        volumes.list(workId),
        mode === 'edit' && chapterId
          ? chapters.get(chapterId)
          : Promise.resolve(null),
      ]);
      if (seq !== loadId.current) {
        return;
      }
      const data = vs.map(v => ({
        volume: v,
        chapters: items.find(g => g.volume.id === v.id)?.chapters ?? [],
      }));
      const selected =
        ch?.volumeId ??
        (volumeId && vs.some(v => v.id === volumeId)
          ? volumeId
          : defaultVolume(data));
      const initial: Fields = ch
        ? { title: ch.title, kind: ch.kind, volumeId: ch.volumeId }
        : {
            title: text.chapterNumber(mainNumberAt(data, selected)),
            kind: 'main',
            volumeId: selected,
          };
      setGroups(data);
      setChapter(ch);
      setFields(initial);
      setOriginal(initial);
      setAutoTitle(!ch);
      setError(null);
    } catch (e) {
      if (seq !== loadId.current) {
        return;
      }
      if (mode === 'edit' && toAppError(e).code === 'NOT_FOUND') {
        gone();
      } else {
        setFailure(e);
      }
    } finally {
      if (seq === loadId.current) {
        setLoading(false);
      }
    }
  };
  useEffect(() => {
    if (visible) {
      load();
    }
    const seq = loadId.current;
    return () => {
      loadId.current = seq + 1;
    };
    // Fields must reset only when the form opens, never on background chapter events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, workId, chapterId, mode, volumeId]);

  useEffect(() => {
    if (!visible || pickerMounted) {
      setShown(false);
    }
  }, [visible, pickerMounted]);
  useEffect(() => {
    // Android can mount TextInput before its Modal owns the native window. Both
    // the data and Modal.onShow must be ready; either may complete first.
    if (shown && visible && !pickerMounted && !loading && !failure) {
      titleInput.current?.focus();
    }
  }, [shown, visible, pickerMounted, loading, failure]);

  const dirty =
    original != null &&
    (fields.title.trim() !== original.title.trim() ||
      fields.kind !== original.kind ||
      fields.volumeId !== original.volumeId);
  const number = mainNumberAt(groups, fields.volumeId, chapterId);
  const kindLocked = chapter?.kind === 'main' && chapter.state !== 'draft';
  const selected = groups.find(g => g.volume.id === fields.volumeId);
  const requestClose = async () => {
    if (!submitting.current && (!dirty || (await confirmDiscard()))) {
      onRequestClose();
    }
  };
  const chooseKind = (kind: ChapterKind) => {
    setFields(f => ({
      ...f,
      kind,
      title: autoTitle
        ? kind === 'main'
          ? text.chapterNumber(number)
          : ''
        : f.title,
    }));
    setError(null);
  };
  const chooseVolume = (id: ID) => {
    setFields(f => ({
      ...f,
      volumeId: id,
      title:
        autoTitle && f.kind === 'main'
          ? text.chapterNumber(mainNumberAt(groups, id, chapterId))
          : f.title,
    }));
  };
  const submit = async () => {
    if (
      submitting.current ||
      !fields.title.trim() ||
      (mode === 'edit' && !dirty)
    ) {
      return;
    }
    submitting.current = true;
    setBusy(true);
    Keyboard.dismiss();
    try {
      if (mode === 'create') {
        const result = await chapters.create({
          workId,
          ...fields,
          title: fields.title.trim(),
        });
        latest.current.onCreated?.(result);
      } else if (chapterId && original) {
        const patch: { title?: string; kind?: ChapterKind; volumeId?: ID } = {};
        if (fields.title.trim() !== original.title.trim()) {
          patch.title = fields.title.trim();
        }
        if (fields.kind !== original.kind) {
          patch.kind = fields.kind;
        }
        if (fields.volumeId !== original.volumeId) {
          patch.volumeId = fields.volumeId;
        }
        await chapters.update(chapterId, patch);
        toast(t.common.saved);
        latest.current.onSaved?.();
      }
      latest.current.onRequestClose();
    } catch (e) {
      const err = toAppError(e);
      if (err.code === 'NOT_FOUND') {
        if (mode === 'edit') {
          gone();
        } else {
          try {
            const current = await chapters.list(workId);
            const last = current[current.length - 1];
            setGroups(current);
            if (last) {
              setFields(f => ({ ...f, volumeId: last.volume.id }));
              toast(t.chapterForm.volumeGone(last.volume.title));
            } else {
              showError(e);
            }
          } catch (reloadError) {
            showError(reloadError);
          }
        }
      } else if (err.code === 'VALIDATION' && err.field === 'title') {
        setError(err.message);
      } else {
        showError(e);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const content = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.form}
    >
      <TextField
        ref={titleInput}
        label={t.chapterForm.titleLabel}
        accessibilityLabel={t.chapterForm.titleLabel}
        value={fields.title}
        onChangeText={title => {
          setFields(f => ({ ...f, title }));
          setAutoTitle(false);
          setError(title.trim() ? null : t.chapterForm.titleEmpty);
        }}
        max={30}
        counter="always"
        error={error}
        placeholder={t.chapterForm.titlePlaceholder}
        selectTextOnFocus={mode === 'create'}
        editable={!busy}
        returnKeyType="done"
        onSubmitEditing={Keyboard.dismiss}
      />
      <Txt variant="callout" color={c.ink2}>
        {t.chapterForm.kindLabel}
      </Txt>
      <Segmented<ChapterKind>
        segments={[
          { key: 'main', label: t.chapterForm.kindMain(number) },
          {
            key: 'extra',
            label: t.chapterForm.kindExtra,
            disabled: kindLocked,
          },
          {
            key: 'draft',
            label: t.chapterForm.kindDraft,
            disabled: kindLocked,
          },
        ]}
        value={fields.kind}
        onChange={chooseKind}
        onDisabledPress={() => toast(t.chapterForm.kindLocked)}
        locked={busy}
      />
      <Txt variant="caption" color={c.ink3}>
        {t.chapterForm.kindHelp[fields.kind]}
      </Txt>
      {mode === 'create' &&
      fields.kind === 'main' &&
      groups
        .slice(groups.findIndex(g => g.volume.id === fields.volumeId) + 1)
        .some(g => g.chapters.some(ch => ch.kind === 'main')) ? (
        <Txt variant="caption" color={c.ink3}>
          {t.chapterForm.shiftNote}
        </Txt>
      ) : null}
      <Txt variant="callout" color={c.ink2}>
        {t.chapterForm.volumeLabel}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text.selectVolume}
        disabled={busy}
        style={styles.volume}
        onPress={() => {
          Keyboard.dismiss();
          setPickerMounted(true);
          setPicker(false);
        }}
      >
        <Txt variant="body" style={styles.grow} numberOfLines={1}>
          {selected?.volume.title}
        </Txt>
        <ChevronDown size={20} color={c.ink3} />
      </Pressable>
      <Button
        label={mode === 'create' ? t.chapterForm.create : t.common.save}
        onPress={submit}
        disabled={
          !fields.title.trim() ||
          !fields.volumeId ||
          (mode === 'edit' && !dirty)
        }
        loading={busy}
      />
    </ScrollView>
  );
  return (
    <>
      <Sheet
        visible={visible && !pickerMounted}
        onShown={() => setShown(true)}
        onClosed={() => {
          if (pickerMounted) {
            setPicker(true);
          }
        }}
        title={
          mode === 'create'
            ? t.chapterForm.createTitle
            : t.chapterForm.editTitle
        }
        locked={busy}
        onRequestClose={requestClose}
        headerRight={
          <Button
            label={t.common.cancel}
            variant="text"
            size="small"
            onPress={requestClose}
            disabled={busy}
          />
        }
      >
        {loading ? (
          <View style={styles.loading}>
            <DelayedSpinner />
          </View>
        ) : failure ? (
          <View style={styles.form}>
            <Button label={t.common.retry} variant="secondary" onPress={load} />
            <Button
              label={t.common.viewDetail}
              variant="text"
              onPress={() => showError(failure)}
            />
          </View>
        ) : (
          content
        )}
      </Sheet>
      {pickerMounted ? (
        <ActionSheet
          visible={picker}
          title={t.chapterForm.pickVolume}
          items={groups.map(g => ({
            key: g.volume.id,
            label: g.volume.title,
            checked: g.volume.id === fields.volumeId,
          }))}
          onRequestClose={() => setPicker(false)}
          onDone={id => {
            setPickerMounted(false);
            if (id) {
              chooseVolume(id);
            }
          }}
        />
      ) : null}
    </>
  );
}
const styles = StyleSheet.create({
  form: { padding: 20, gap: 12 },
  loading: { height: 180 },
  volume: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderWidth: 1,
    borderColor: c.field,
    borderRadius: radius.field,
    paddingHorizontal: 12,
  },
  grow: { flex: 1 },
});
