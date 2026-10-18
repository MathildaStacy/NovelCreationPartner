import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { confirmDelete, confirmDiscard } from '../../app/dialogs';
import { useLoad } from '../../app/hooks';
import { showError, toAppError } from '../../app/errors';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Sheet } from '../../components/Sheet';
import { TextField } from '../../components/TextField';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import * as entries from '../../features/entries';
import * as relations from '../../features/relations';
import type { ChapterListItem, EntryDetail, Relation } from '../../features/types';
import { archiveText as a } from '../../locales/archive';
import { t } from '../../locales/zh-CN';
import { color as c } from '../../theme/tokens';
import { ChapterPicker, chapterLabel, styles } from './shared';

interface Form { other: string; reversed: boolean; kind: string; note: string; fromChapterId: string | null; toChapterId: string | null }
const presets = ['亲属', '师徒', '盟友', '对手', '恋人', '上下级', '利益'];
export function RelationSheet({ visible, entry, relation, chapters, onClose }: {
  visible: boolean; entry: EntryDetail; relation: Relation | null; chapters: ChapterListItem[]; onClose: () => void;
}) {
  const [form, setForm] = useState<Form>({ other: '', reversed: false, kind: '', note: '', fromChapterId: null, toChapterId: null });
  const baseline = useRef('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [pick, setPick] = useState(false);
  const [query, setQuery] = useState('');
  const [chapterPicker, setChapterPicker] = useState<'fromChapterId' | 'toChapterId' | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (visible) {
      const next = relation ? { other: relation.fromEntryId === entry.id ? relation.toEntryId : relation.fromEntryId,
        reversed: relation.toEntryId === entry.id, kind: relation.kind, note: relation.note ?? '',
        fromChapterId: relation.fromChapterId, toChapterId: relation.toChapterId } :
        { other: '', reversed: false, kind: '', note: '', fromChapterId: null, toChapterId: null };
      setForm(next); baseline.current = JSON.stringify(next); setError(''); setPick(false); setQuery('');
    }
  }, [visible, relation, entry.id]);
  const options = useLoad(() => entries.list(entry.workId), [entry.workId, visible], { refetchOnFocus: true });
  const edit = <K extends keyof Form>(key: K, value: Form[K]) => { setForm(prev => ({ ...prev, [key]: value })); setError(''); };
  const dirty = JSON.stringify(form) !== baseline.current;
  const close = async () => { if (!busy && (!dirty || await confirmDiscard())) { onClose(); } };
  const from = form.reversed ? form.other : entry.id;
  const to = form.reversed ? entry.id : form.other;
  const otherName = options.data?.find(e => e.id === form.other)?.name ?? (relation ? relation.fromEntryId === entry.id ? relation.toName : relation.fromName : '？');
  const start = chapters.findIndex(ch => ch.id === form.fromChapterId);
  const end = chapters.findIndex(ch => ch.id === form.toChapterId);
  const badRange = start >= 0 && end >= 0 && end < start;
  const duplicate = entry.relations.some(r => r.id !== relation?.id && r.fromEntryId === from && r.toEntryId === to && r.kind === form.kind.trim() &&
    (r.fromChapterId === form.fromChapterId && r.toChapterId === form.toChapterId || !r.toChapterId && !form.toChapterId));
  const save = async () => {
    if (!form.other || !form.kind.trim() || saving.current) { return; }
    if (!dirty) { onClose(); return; }
    saving.current = true; setBusy(true);
    try {
      await relations.upsert({ id: relation?.id, fromEntryId: from, toEntryId: to, kind: form.kind.trim(), note: form.note.trim() || null,
        fromChapterId: form.fromChapterId, toChapterId: form.toChapterId });
      toast(t.common.saved); onClose();
    } catch (e) { const err = toAppError(e); if (['VALIDATION', 'DUPLICATE', 'NOT_FOUND'].includes(err.code)) { setError(err.message); } else { await showError(err); } }
    finally { saving.current = false; setBusy(false); }
  };
  const remove = async () => {
    if (!relation) { return; }
    try { if (await confirmDelete({ name: null, untitled: '删除这条关系？', body: a.relationDeleteBody, button: a.relationDelete,
      run: () => relations.remove(relation.id) })) { toast('已删除'); onClose(); } } catch (e) { await showError(e); }
  };
  return <>
    <Sheet visible={visible} title={pick ? a.relationPick : relation ? a.editRelation : a.addRelation} locked={busy} onRequestClose={() => { close(); }}
      headerLeft={<Button label={pick ? '返回表单' : t.common.cancel} variant="text" onPress={pick ? () => setPick(false) : () => { close(); }} disabled={busy} />}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {pick ? <><TextField value={query} onChangeText={setQuery} max={30} placeholder={a.searchPlaceholder} />
          {(options.data ?? []).filter(e => e.id !== entry.id && e.state !== 'RETIRED' && (!query.trim() || e.name.includes(query.trim()))).map(e =>
            <Button key={e.id} label={`${entries.ENTRY_TYPE_LABELS[e.type]} · ${e.name}`} variant="quiet" onPress={() => { edit('other', e.id); setPick(false); }} />)}
          {!options.data?.some(e => e.id !== entry.id && e.state !== 'RETIRED') ? <Txt>没有找到条目，可以先在档案里新建</Txt> : null}</> : <>
          <View style={styles.notice}><Txt>{form.reversed ? otherName : entry.name} 是 {form.reversed ? entry.name : otherName} 的 {form.kind || '？'}</Txt>
            <Button label={a.reverse} variant="text" disabled={busy} onPress={() => edit('reversed', !form.reversed)} /></View>
          <Button label={`${a.relationOther}：${form.other ? otherName : a.relationPick}`} variant="secondary" disabled={busy} onPress={() => setPick(true)} />
          <View style={styles.chips}>{presets.map(kind => <Chip key={kind} label={kind} selected={form.kind === kind} onPress={() => edit('kind', kind)} disabled={busy} />)}</View>
          <TextField label={a.relationKind} accessibilityLabel={a.relationKind} value={form.kind} onChangeText={v => edit('kind', v)} max={10} editable={!busy} error={duplicate ? '已有这条关系' : error} />
          <Button label={`${a.relationFrom}：${chapterLabel(form.fromChapterId, chapters)}`} variant="text" onPress={() => setChapterPicker('fromChapterId')} disabled={busy} />
          {relation ? <Button label={`${a.relationTo}：${chapterLabel(form.toChapterId, chapters, a.until)}`} variant="text" onPress={() => setChapterPicker('toChapterId')} disabled={busy} /> : null}
          {badRange ? <Txt color={c.conf}>结束章节不能早于起始章节</Txt> : null}
          <TextField label={a.relationNote} accessibilityLabel={a.relationNote} value={form.note} onChangeText={v => edit('note', v)} max={100} multiline editable={!busy} />
          <Button label={a.relationSave} onPress={save} loading={busy} disabled={!form.other || !form.kind.trim() || badRange || duplicate} />
          {relation ? <Button label={a.relationDelete} variant="quiet" disabled={busy} onPress={remove} /> : null}
        </>}
      </ScrollView>
    </Sheet>
    <ChapterPicker visible={!!chapterPicker} title={chapterPicker === 'toChapterId' ? a.relationTo : a.relationFrom}
      value={chapterPicker ? form[chapterPicker] : null} chapters={chapters} nullLabel={chapterPicker === 'toChapterId' ? a.until : a.always}
      onClose={() => setChapterPicker(null)} onPick={id => { if (chapterPicker) { edit(chapterPicker, id); } }} />
  </>;
}
