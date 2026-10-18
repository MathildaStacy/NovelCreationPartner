import React, { useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { showError } from '../../app/errors';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { showDialog, toast } from '../../components/overlay/store';
import * as works from '../../features/works';
import type { Cover } from '../../features/types';
import { workName } from '../shelf/workText';

/** Shelf action is already fully dismissed before this author prompt opens. */
export async function changeCover(work: { id: string; title: string | null; cover: Cover }): Promise<void> {
  const key = await showDialog({ title: work.title ? `更换「${workName(work)}」的封面` : '更换封面', vertical: true,
    buttons: [{ key: 'image', label: '从相册选择', style: 'primary' }, ...(work.cover.kind === 'image' ? [{ key: 'text', label: '换回文字书封' }] : []), { key: 'cancel', label: '取消' }], dismissKey: 'cancel' });
  if (key !== 'image' && key !== 'text') return;
  try { if (await works.setCover(work.id, { kind: key })) toast(key === 'image' ? '封面已更换' : '已换回文字书封'); }
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
      const changed = await works.setCover(workId, { kind });
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
