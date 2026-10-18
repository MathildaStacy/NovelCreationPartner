import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { ArrowDown, ArrowUp, Pencil } from 'lucide-react-native';
import { confirmDelete } from '../../app/dialogs';
import { showError, toAppError } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import { Button } from '../../components/Button';
import { DelayedSpinner } from '../../components/Loading';
import { IconButton } from '../../components/IconButton';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { toast } from '../../components/overlay/store';
import * as volumes from '../../features/volumes';
import { chapterText as text } from '../../locales/chapters';
import { t } from '../../locales/zh-CN';
import { color as c } from '../../theme/tokens';
import { defaultVolumeTitle, formatChars } from '../../utils/format';
import type { ChapterGroup } from './chapterLayout';

type Edit = { id: string | null; name: string; original: string };

export function VolumesSheet({
  visible,
  workId,
  focusVolumeId,
  groups,
  onRequestClose,
}: {
  visible: boolean;
  workId: string;
  focusVolumeId?: string;
  groups: ChapterGroup[];
  onRequestClose: () => void;
}) {
  const data = useLoad(() => volumes.list(workId), [workId], {
    events: { 'chapters.changed': p => p.workId === workId },
  });
  const [edit, setEdit] = useState<Edit | null>(null);
  const editRef = useRef(edit);
  editRef.current = edit;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const pendingCommit = useRef<Promise<boolean> | null>(null);
  const [highlight, setHighlight] = useState(focusVolumeId);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    const timer = setTimeout(() => setHighlight(undefined), 1000);
    return () => clearTimeout(timer);
  }, []);
  const commitInput = async (): Promise<boolean> => {
    const current = editRef.current;
    if (!current) {
      return true;
    }
    if (busyRef.current) {
      return false;
    }
    const name = current.name.trim();
    if (!name || name === current.original) {
      if (!name && current.id) {
        toast(t.volumes.nameEmpty);
      }
      setEdit(null);
      editRef.current = null;
      setError(null);
      return true;
    }
    busyRef.current = true;
    setBusy(current.id ?? 'new');
    try {
      if (current.id) {
        await volumes.rename(current.id, name);
      } else {
        await volumes.create(workId, name);
      }
      setEdit(null);
      editRef.current = null;
      setError(null);
      await data.reload();
      return true;
    } catch (e) {
      if (toAppError(e).code === 'VALIDATION') {
        setError(toAppError(e).message);
      } else {
        showError(e);
      }
      return false;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };
  // Blur and the header's Done can arrive in the same frame. Reuse the write.
  const commit = (): Promise<boolean> => {
    if (pendingCommit.current) {
      return pendingCommit.current;
    }
    const task = commitInput();
    pendingCommit.current = task;
    task.finally(() => {
      if (pendingCommit.current === task) {
        pendingCommit.current = null;
      }
    });
    return task;
  };
  const close = async () => {
    if ((!busyRef.current || pendingCommit.current) && (await commit())) {
      Keyboard.dismiss();
      onRequestClose();
    }
  };
  const startEdit = (next: Edit) => {
    setError(null);
    setEdit(next);
    editRef.current = next;
  };
  const move = async (index: number, delta: number) => {
    if (busyRef.current || !data.data || editRef.current) {
      return;
    }
    const ids = data.data.map(v => v.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    busyRef.current = true;
    setBusy(ids[index + delta]);
    try {
      await volumes.reorder(workId, ids);
      await data.reload();
    } catch (e) {
      showError(e);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };
  const remove = async (v: volumes.VolumeListItem) => {
    if (busyRef.current || editRef.current) {
      return;
    }
    if (data.data?.length === 1) {
      toast(t.volumes.keepOne);
      return;
    }
    if (v.chapterCount || v.trashedChapterCount) {
      toast(t.volumes.notEmpty(v.trashedChapterCount));
      return;
    }
    try {
      const removed = await confirmDelete({
        name: v.title,
        body: t.confirmDelete.volumeBody,
        button: t.confirmDelete.volumeButton,
        run: async () => {
          busyRef.current = true;
          setBusy(v.id);
          try {
            await volumes.remove(v.id);
          } finally {
            busyRef.current = false;
            setBusy(null);
          }
        },
      });
      if (removed) {
        toast(t.common.deleted);
        await data.reload();
      }
    } catch (e) {
      showError(e);
      await data.reload();
    }
  };
  const input = (current: Edit) => (
    <TextField
      label={text.volumeName}
      accessibilityLabel={text.volumeName}
      value={current.name}
      onChangeText={name => {
        const next = { ...current, name };
        setEdit(next);
        editRef.current = next;
        setError(null);
      }}
      max={30}
      counter="always"
      error={error}
      autoFocus
      selectTextOnFocus
      returnKeyType="done"
      editable={!busy}
      onSubmitEditing={commit}
      onBlur={commit}
    />
  );
  return (
    <Sheet
      visible={visible}
      title={t.volumes.title}
      locked={!!busy}
      onRequestClose={close}
      maxHeightRatio={0.88}
      headerRight={
        <Button
          label={t.common.done}
          variant="text"
          size="small"
          onPress={close}
          disabled={!!busy}
        />
      }
    >
      {data.loading ? (
        <View style={styles.loading}>
          <DelayedSpinner />
        </View>
      ) : data.error ? (
        <View style={styles.pad}>
          <Button label={t.common.retry} onPress={data.reload} />
        </View>
      ) : (
        <ScrollView ref={scroll} keyboardShouldPersistTaps="handled">
          {data.data?.map((v, index) => {
            const chars =
              groups
                .find(g => g.volume.id === v.id)
                ?.chapters.filter(ch => ch.kind === 'main')
                .reduce((sum, ch) => sum + ch.charCount, 0) ?? 0;
            const blocked = !!busy || !!edit;
            const cannotDelete =
              data.data?.length === 1 ||
              v.chapterCount > 0 ||
              v.trashedChapterCount > 0;
            return (
              <View
                key={v.id}
                style={[styles.row, highlight === v.id && styles.highlight]}
                onLayout={e => {
                  if (v.id === focusVolumeId) {
                    scroll.current?.scrollTo({
                      y: e.nativeEvent.layout.y,
                      animated: false,
                    });
                  }
                }}
              >
                <View style={styles.grow}>
                  {edit?.id === v.id ? (
                    input(edit)
                  ) : (
                    <>
                      <Txt variant="body" weight="600" numberOfLines={1}>
                        {v.title}
                      </Txt>
                      <Txt variant="caption" color={c.ink3}>
                        {t.volumes.meta(
                          v.chapterCount,
                          formatChars(chars),
                          v.trashedChapterCount,
                        )}
                      </Txt>
                    </>
                  )}
                </View>
                {busy === v.id ? <ActivityIndicator color={c.ink3} /> : null}
                {!edit ? (
                  <View style={styles.controls}>
                    <IconButton
                      label={`${v.title}，${t.volumes.rename}`}
                      disabled={blocked}
                      onPress={() =>
                        startEdit({
                          id: v.id,
                          name: v.title,
                          original: v.title,
                        })
                      }
                    >
                      <Pencil size={18} color={c.ink2} />
                    </IconButton>
                    {(data.data?.length ?? 0) > 1 ? (
                      <>
                        <IconButton
                          label={`${v.title}，${t.volumes.up}`}
                          disabled={blocked || index === 0}
                          onPress={() => move(index, -1)}
                        >
                          <ArrowUp size={18} color={c.ink2} />
                        </IconButton>
                        <IconButton
                          label={`${v.title}，${t.volumes.down}`}
                          disabled={
                            blocked || index === (data.data?.length ?? 0) - 1
                          }
                          onPress={() => move(index, 1)}
                        >
                          <ArrowDown size={18} color={c.ink2} />
                        </IconButton>
                      </>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${v.title}，${t.volumes.remove}`}
                      accessibilityState={{ disabled: cannotDelete || blocked }}
                      disabled={blocked}
                      onPress={() => remove(v)}
                      style={[styles.remove, cannotDelete && styles.dim]}
                    >
                      <Txt variant="callout" color={c.ink2}>
                        {t.volumes.remove}
                      </Txt>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
          {edit?.id === null ? (
            <View style={styles.pad}>
              {input(edit)}
              {busy === 'new' ? <ActivityIndicator color={c.ink3} /> : null}
            </View>
          ) : null}
          <Button
            label={t.volumes.add}
            variant="text"
            disabled={!!busy || !!edit}
            onPress={() => {
              startEdit({
                id: null,
                name: defaultVolumeTitle((data.data?.length ?? 0) + 1),
                original: '',
              });
              setTimeout(() => scroll.current?.scrollToEnd(), 50);
            }}
          />
          <Txt variant="caption" color={c.ink3} style={styles.pad}>
            {t.volumes.note}
          </Txt>
        </ScrollView>
      )}
    </Sheet>
  );
}
const styles = StyleSheet.create({
  loading: { height: 160 },
  pad: { padding: 20 },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
    gap: 4,
  },
  grow: { flex: 1, gap: 4 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
  },
  remove: {
    minWidth: 48,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.4 },
  highlight: { backgroundColor: c.brandTint },
});
