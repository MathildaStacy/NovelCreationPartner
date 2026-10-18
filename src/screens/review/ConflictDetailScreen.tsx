import React, { useEffect, useRef, useState } from 'react';
import { usePreventRemove } from '@react-navigation/native';
import { ScrollView, View } from 'react-native';
import { showError } from '../../app/errors';
import { useDirtyGuard, useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { NavBar } from '../../components/NavBar';
import { TextField } from '../../components/TextField';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import * as conflicts from '../../features/conflicts';
import type { ConflictStatus } from '../../features/types';
import { color as c } from '../../theme/tokens';
import { styles } from '../archive/shared';

/** S14a leaves all edits to the author and saves only an explicit resolution. */
export function ConflictDetailScreen({ navigation, route }: RootScreenProps<'ConflictDetail'>) {
  const { conflictId } = route.params;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const baseline = useRef<string | null>(null);
  const loaded = useLoad(() => conflicts.get(conflictId), [conflictId], { events: { 'conflicts.changed': () => true }, refetchOnFocus: true });
  useEffect(() => {
    if (loaded.data && (baseline.current === null || note === baseline.current)) {
      baseline.current = loaded.data.note ?? ''; setNote(baseline.current);
    }
    // Preserve an unsaved author note while service events refresh stored evidence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded.data]);
  const conflict = loaded.data;
  useDirtyGuard(!!conflict && note !== (baseline.current ?? '') && !busy);
  usePreventRemove(busy, () => {});
  const resolved = !!conflict && !['open', 'later'].includes(conflict.status);
  const prose = conflict ? [conflict.a, conflict.b].find(source => source.ref.startsWith('chapter:')) ?? conflict.b : null;
  const resolve = async (status: ConflictStatus) => {
    if (busy) { return; } setBusy(true);
    try { if (status === 'open') { await conflicts.reopen(conflictId); }
      else { await conflicts.resolve(conflictId, { status, note: note.trim() || undefined }); } baseline.current = note.trim(); setNote(note.trim()); toast(status === 'intentional' ? '已标记为有意为之' : '已保存处理状态'); await loaded.reload(); }
    catch (error) { await showError(error); } finally { setBusy(false); }
  };
  return <View style={styles.root}><NavBar title="冲突处理" onBack={() => navigation.goBack()} />
    {!conflict ? loaded.error ? <EmptyState title="冲突没有加载出来。" action={{ label: '重试', onPress: loaded.reload }} /> : null : <ScrollView contentContainerStyle={styles.content}>
      <Txt variant="headline">{conflict.explanation}</Txt><View style={styles.card}><Txt weight="600">{conflict.a.label}</Txt><Txt selectable>{conflict.a.quote}</Txt>
        {conflict.entryId ? <Button label="查看档案" variant="text" onPress={() => navigation.navigate('EntryDetail', { entryId: conflict.entryId! })} /> : null}</View>
      <View style={styles.card}><Txt weight="600">{conflict.b.label}</Txt><Txt selectable>{conflict.b.quote}</Txt>
        {conflict.chapterId ? <Button label="跳到原文修改" variant="text" onPress={() => navigation.navigate('Editor', { workId: conflict.workId, chapterId: conflict.chapterId!, locate: { quote: prose?.quote } })} /> : null}</View>
      {conflict.suggestions.map((suggestion, index) => <Txt key={index} color={c.ink2}>建议：{suggestion}</Txt>)}
      {resolved ? <View style={styles.notice}><Txt>{conflict.status === 'superseded' ? '已被后续定稿取代' : conflict.status === 'intentional' ? '有意为之' : conflict.status === 'updated_entry' ? '已更新档案' : '已改正文'}</Txt><Txt>{conflict.note || '未填写备注'}</Txt>{conflict.status === 'superseded' ? <Txt>这份记录只供查看，请以当前定稿的新检查结果为准。</Txt> : <Button label="重新打开这个冲突" variant="text" disabled={busy} onPress={() => { resolve('open'); }} />}</View> : <>
      <TextField label="处理备注（选填）" value={note} onChangeText={setNote} max={200} multiline editable={!busy} />
      {conflict.entryId ? <Button label="以正文为准 · 编辑档案" variant="secondary" disabled={busy} onPress={() => navigation.navigate('EntryForm', { workId: conflict.workId, entryId: conflict.entryId!, conflictId })} /> : null}
      <Button label="正文已修改，标记已处理" disabled={busy} onPress={() => { resolve('fixed_text'); }} />
      <Button label="有意为之" variant="secondary" disabled={busy} onPress={() => { resolve('intentional'); }} />
      <Button label="稍后处理" variant="quiet" disabled={busy} onPress={() => { resolve('later'); }} />
      </>}
      <Txt variant="caption" color={c.ink3}>标记处理不会自动修改正文或设定。更新档案时仍由你保存字段。</Txt>
    </ScrollView>}
  </View>;
}
