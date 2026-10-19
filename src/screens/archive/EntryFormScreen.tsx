import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePreventRemove } from '@react-navigation/native';
import { Keyboard, KeyboardAvoidingView, ScrollView, TextInput, View } from 'react-native';
import { useDirtyGuard, useLoad } from '../../app/hooks';
import { confirmDiscard } from '../../app/dialogs';
import { showError, toAppError } from '../../app/errors';
import type { RootScreenProps } from '../../app/navigation/types';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { DelayedSpinner } from '../../components/Loading';
import { NavBar } from '../../components/NavBar';
import { Segmented } from '../../components/Segmented';
import { TextField } from '../../components/TextField';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import * as entries from '../../features/entries';
import * as chapters from '../../features/chapters';
import type { EntryDetail, EntryType } from '../../features/types';
import { archiveText as a } from '../../locales/archive';
import { t } from '../../locales/zh-CN';
import { color as c } from '../../theme/tokens';
import { ChapterPicker, chapterLabel, styles } from './shared';

interface FieldDraft { field: string; value: string; fromChapterId: string | null }
interface Form { type: EntryType; name: string; aliases: string; summary: string; facts: FieldDraft[] }
const allTypes: EntryType[] = ['character', 'world', 'place', 'faction', 'rule', 'foreshadow'];
const aliasesOf = (text: string) => [...new Set(text.split(/[、,，]/).map(v => v.trim()).filter(Boolean))];
const fromEntry = (entry: EntryDetail): Form => ({ type: entry.type, name: entry.name, aliases: entry.aliases.join('、'),
  summary: entry.summary ?? '', facts: entry.facts.map(f => ({ field: f.field, value: f.value, fromChapterId: f.fromChapterId })) });

/** S12a writes only changed fields. A new effective chapter creates a stage in the feature transaction. */
export function EntryFormScreen({ navigation, route }: RootScreenProps<'EntryForm'>) {
  const { workId, entryId, type: initialType = 'character', name = '', field: focusField, conflictId } = route.params;
  const loaded = useLoad(async () => ({ entry: entryId ? await entries.get(entryId) : null,
    chapters: (await chapters.list(workId)).flatMap(group => group.chapters).filter(ch => ch.kind === 'main') }), [workId, entryId]);
  const [form, setForm] = useState<Form | null>(null);
  const baseline = useRef<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [chapterField, setChapterField] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const focus = useRef<React.ElementRef<typeof TextInput>>(null);
  useEffect(() => {
    if (!loaded.data || baseline.current) { return; }
    const next = loaded.data.entry ? fromEntry(loaded.data.entry) : { type: initialType, name, aliases: '', summary: '', facts: [] };
    baseline.current = next; setForm(next);
    if (focusField) { setTimeout(() => focus.current?.focus(), 100); }
  }, [loaded.data, initialType, name, focusField]);
  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(baseline.current);
  usePreventRemove(busy, () => {});
  const leave = useDirtyGuard(dirty && !busy);
  const fieldNames = useMemo(() => form ? [...new Set([...entries.ENTRY_FIELDS[form.type], ...form.facts.map(f => f.field)])] : [], [form]);
  const edit = <K extends keyof Form>(key: K, value: Form[K]) => { setForm(prev => prev ? { ...prev, [key]: value } : prev); setErrors(prev => ({ ...prev, [key]: '' })); };
  const fact = (field: string) => form?.facts.find(f => f.field === field) ?? { field, value: '', fromChapterId: null };
  const editFact = (field: string, patch: Partial<FieldDraft>) => {
    setForm(prev => prev ? { ...prev, facts: [...prev.facts.filter(f => f.field !== field), { ...(prev.facts.find(f => f.field === field) ?? { field, value: '', fromChapterId: null }), ...patch }] } : prev);
    setErrors(prev => ({ ...prev, facts: '', [field]: '' }));
  };
  const switchType = async (type: EntryType) => {
    if (!form || type === form.type) { return; }
    const dropped = form.facts.filter(f => !entries.ENTRY_FIELDS[type].includes(f.field));
    if (dropped.some(f => f.value.trim()) && !await confirmDiscard({ title: `切换分类会清空 ${dropped.filter(f => f.value.trim()).length} 个字段`, body: '同名字段会保留。', discard: '切换分类' })) { return; }
    setForm({ ...form, type, facts: form.facts.filter(f => entries.ENTRY_FIELDS[type].includes(f.field)) });
    setErrors({}); setDuplicateId(null);
  };
  const save = async () => {
    if (!form || !form.name.trim() || saving.current) { return; }
    saving.current = true; setBusy(true); Keyboard.dismiss();
    try {
      if (entryId) {
        const original = baseline.current!;
        const changed = form.facts.filter(f => {
          const before = original.facts.find(b => b.field === f.field);
          return f.value.trim() !== (before?.value ?? '') || f.fromChapterId !== (before?.fromChapterId ?? null);
        });
        await entries.update(entryId, {
          ...(form.name.trim() !== original.name ? { name: form.name.trim() } : {}),
          ...(form.aliases !== original.aliases ? { aliases: aliasesOf(form.aliases) } : {}),
          ...(form.summary !== original.summary ? { summary: form.summary.trim() } : {}),
          ...(changed.length ? { facts: changed } : {}),
        }, { conflictId });
        toast(conflictId ? '档案已保存，冲突已解决' : t.common.saved); leave(() => navigation.goBack());
      } else {
        const entry = await entries.create({ workId, type: form.type, name: form.name.trim(), aliases: aliasesOf(form.aliases),
          summary: form.summary.trim(), facts: form.facts.filter(f => f.value.trim()) });
        toast(t.common.saved); leave(() => navigation.replace('EntryDetail', { entryId: entry.id }));
      }
    } catch (e) {
      const error = toAppError(e);
      if (error.code === 'VALIDATION' || error.code === 'DUPLICATE') {
        setErrors(prev => ({ ...prev, [error.field ?? 'name']: error.message }));
        if (error.code === 'DUPLICATE') {
          const candidates = await entries.search(workId, form.name.trim());
          setDuplicateId(candidates.find(candidate => candidate.type === form.type)?.id ?? null);
        }
      }
      else if (error.code === 'NOT_FOUND') { toast(a.gone); leave(() => navigation.goBack()); }
      else { await showError(error); }
    } finally { saving.current = false; setBusy(false); }
  };
  const chapterOptions = loaded.data?.chapters ?? [];
  return <KeyboardAvoidingView style={styles.root} behavior="padding">
    <NavBar title={`${entryId ? '编辑' : '新建'}${form ? entries.ENTRY_TYPE_LABELS[form.type] : '条目'}`} backLabel={t.common.cancel}
      onBack={busy ? undefined : () => navigation.goBack()} right={<Button label={t.common.save} variant="text" loading={busy}
        disabled={!form?.name.trim() || !!entryId && !dirty || Object.values(errors).some(Boolean)} onPress={save} />} />
    {!form ? loaded.error ? <EmptyState title={a.entryFailed} action={{ label: t.common.retry, onPress: loaded.reload }} /> : <DelayedSpinner /> :
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.chips}>{allTypes.map(type => <Chip key={type} label={entries.ENTRY_TYPE_LABELS[type]} selected={form.type === type}
          disabled={!!entryId || busy} onPress={() => { switchType(type); }} />)}</View>
        <TextField label={a.name} accessibilityLabel={a.name} placeholder={a.namePlaceholder} value={form.name} max={30} editable={!busy} clearable
          onChangeText={v => { edit('name', v); setDuplicateId(null); }} error={errors.name} />
        {duplicateId ? <Button label="查看同名条目" variant="text" onPress={() => navigation.navigate('EntryDetail', { entryId: duplicateId })} /> : null}
        <TextField label={a.aliases} accessibilityLabel={a.aliases} value={form.aliases} editable={!busy} onChangeText={v => edit('aliases', v)} error={errors.aliases} />
        <TextField label={a.summary} accessibilityLabel={a.summary} value={form.summary} max={100} editable={!busy} onChangeText={v => edit('summary', v)} error={errors.summary} />
        {fieldNames.map(field => <View key={field} style={styles.card}>
          <View style={styles.row}><Txt variant="headline" style={styles.flex}>{entries.FIELD_LABELS[field] ?? field}</Txt>
            <Button label={chapterLabel(fact(field).fromChapterId, chapterOptions)} variant="text" disabled={busy} onPress={() => setChapterField(field)} /></View>
          {field === 'resolved' ? <Segmented value={fact(field).value === 'yes' ? 'yes' : 'no'} onChange={value => editFact(field, { value })}
            locked={busy} segments={[{ key: 'no', label: a.unresolved }, { key: 'yes', label: a.resolved }]} /> :
            field === 'plantedIn' ? <Button label={chapterLabel(fact(field).value || null, chapterOptions, '选择埋设章节')} variant="text" onPress={() => setChapterField('plantedIn:value')} /> :
            <TextField ref={field === focusField ? focus : undefined} accessibilityLabel={entries.FIELD_LABELS[field] ?? field} value={fact(field).value}
              onChangeText={value => editFact(field, { value })} multiline minLines={2} max={500} counter="near" editable={!busy} error={errors[field] ?? errors.facts} />}
        </View>)}
        {custom ? <View style={styles.card}><TextField value={customName} label={a.customName} accessibilityLabel={a.customName} max={10} onChangeText={setCustomName} />
          <Button label="添加字段" disabled={!customName.trim() || fieldNames.includes(customName.trim())} onPress={() => { editFact(customName.trim(), { value: '' }); setCustom(false); setCustomName(''); }} /></View> :
          <Button label={a.custom} variant="text" disabled={busy} onPress={() => setCustom(true)} />}
        {errors.facts ? <Txt color={c.conf}>{errors.facts}</Txt> : null}
      </ScrollView>}
    <ChapterPicker visible={chapterField !== null} title="自第几章起生效" value={chapterField ? fact(chapterField).fromChapterId : null} chapters={chapterOptions}
      onClose={() => setChapterField(null)} onPick={id => {
        if (chapterField === 'plantedIn:value') { editFact('plantedIn', { value: id ?? '' }); }
        else if (chapterField) { editFact(chapterField, { fromChapterId: id }); }
      }} />
  </KeyboardAvoidingView>;
}
