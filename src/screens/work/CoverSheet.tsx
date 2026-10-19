import React, { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { create } from 'zustand';
import { showError } from '../../app/errors';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { showDialog, toast } from '../../components/overlay/store';
import * as works from '../../features/works';
import type { Cover } from '../../features/types';
import { Delayed } from '../../components/Skeleton';
import { color as c, radius } from '../../theme/tokens';
import { workName } from '../shelf/workText';

/** Works whose cover is being picked / processed (D06 §2: 书封位置显示加载指示). */
const useCoverBusy = create<{ ids: string[] }>(() => ({ ids: [] }));
async function processing<T>(workId: string, run: () => Promise<T>): Promise<T> {
  useCoverBusy.setState(state => ({ ids: [...state.ids, workId] }));
  try { return await run(); } finally {
    useCoverBusy.setState(state => { const at = state.ids.indexOf(workId); return { ids: state.ids.filter((_, i) => i !== at) }; });
  }
}

/** Overlay for a BookCover slot; the spinner appears only after 300 ms. */
export function CoverProgress({ workId }: { workId: string }) {
  const busy = useCoverBusy(state => state.ids.includes(workId));
  return busy ? <Delayed><View style={styles.progress} testID="cover-progress" accessibilityLabel="正在处理封面">
    <ActivityIndicator color={c.white} /></View></Delayed> : null;
}

/** Shelf action is already fully dismissed before this author prompt opens. */
export async function changeCover(work: { id: string; title: string | null; cover: Cover }): Promise<void> {
  const key = await showDialog({ title: work.title ? `更换「${workName(work)}」的封面` : '更换封面', vertical: true,
    buttons: [{ key: 'image', label: '从相册选择', style: 'primary' }, ...(work.cover.kind === 'image' ? [{ key: 'text', label: '换回文字书封' }] : []), { key: 'cancel', label: '取消' }], dismissKey: 'cancel' });
  if (key !== 'image' && key !== 'text') return;
  try { if (await processing(work.id, () => works.setCover(work.id, { kind: key }))) toast(key === 'image' ? '封面已更换' : '已换回文字书封'); }
  catch (error) { await showError(error); }
}

/** D06: the sheet owns only the author action; native picker bytes never cross as a path. */
export function CoverSheet({ workId, title, cover, visible, onClose }: {
  workId: string; title: string | null; cover: Cover; visible: boolean; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const mutating = useRef(false);
  const choose = async (kind: 'image' | 'text') => {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true);
    try {
      const changed = await processing(workId, () => works.setCover(workId, { kind }));
      if (changed) { toast(kind === 'image' ? '封面已更换' : '已换回文字书封'); onClose(); }
      else if (kind === 'image') onClose();
    } catch (error) { await showError(error); }
    finally { mutating.current = false; setBusy(false); }
  };
  return <Sheet visible={visible} title={title ? `更换「${workName({ title })}」的封面` : '更换封面'} onRequestClose={busy ? () => {} : onClose} locked={busy}>
    <ScrollView>
      <Button label="从相册选择" disabled={busy} loading={busy} onPress={() => { choose('image'); }} />
      {cover.kind === 'image' ? <Button label="换回文字书封" variant="quiet" disabled={busy} onPress={() => { choose('text'); }} /> : null}
      <Button label="取消" variant="text" disabled={busy} onPress={onClose} />
    </ScrollView>
  </Sheet>;
}

const styles = StyleSheet.create({
  progress: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.cover, backgroundColor: 'rgba(29,26,43,0.35)', alignItems: 'center', justifyContent: 'center' },
});
