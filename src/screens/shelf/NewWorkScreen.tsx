import React, { useEffect, useRef, useState } from 'react';
import { usePreventRemove } from '@react-navigation/native';
import { Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ensureModelService } from '../../app/dialogs';
import { logError, showError } from '../../app/errors';
import { useDirtyGuard } from '../../app/hooks';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { NavBar } from '../../components/NavBar';
import { Txt } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { isAppError } from '../../features/errors';
import type { Genre } from '../../features/types';
import * as works from '../../features/works';
import { workCopy } from '../../locales/work';
import { t } from '../../locales/zh-CN';
import { color as c, maxContentWidth, pageMargin } from '../../theme/tokens';
import type { RootScreenProps } from '../../app/navigation/types';

const copy = workCopy.newWork;
const genres = Object.keys(workCopy.genres) as Genre[];

/** S04: the offline path creates a work and its default volume in one service call. */
export function NewWorkScreen({ navigation }: RootScreenProps<'NewWork'>) {
  const insets = useSafeAreaInsets();
  const [premise, setPremise] = useState('');
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState<Genre | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const creating = useRef(false);
  const checkingModel = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const dirty = !!(premise.trim() || title.trim() || genre);
  usePreventRemove(busy, () => {});
  const leave = useDirtyGuard(dirty && !busy, {
    title: copy.discardTitle, body: copy.discardBody, discard: copy.discard,
  });

  const create = async (partner = false) => {
    if (creating.current || checkingModel.current || !premise.trim()) {
      return;
    }
    creating.current = true;
    setBusy(true);
    Keyboard.dismiss();
    try {
      const work = await works.create({ premise: premise.trim(), title: title.trim(), genre });
      // A failed touch must never make an already created work look like a failed create.
      await works.touch(work.id).catch(logError('works.touch'));
      creating.current = false;
      setBusy(false);
      leave(() => navigation.replace('Work', { workId: work.id, ...(partner ? { tab: 'Partner', seed: premise.trim() } : {}) }));
    } catch (e) {
      if (isAppError(e, 'VALIDATION') && e.field) {
        setErrors(prev => ({ ...prev, [e.field!]: e.message }));
      } else {
        await showError(e, { title: t.errors.notSaved });
      }
      creating.current = false;
      setBusy(false);
    }
  };

  const ideate = async () => {
    if (creating.current || checkingModel.current || !premise.trim()) {
      return;
    }
    checkingModel.current = true;
    setChecking(true);
    const isActive = () => mounted.current && navigation.isFocused();
    try {
      const result = await ensureModelService(isActive, navigation);
      if (!isActive() || result === 'cancelled') {
        return;
      }
      checkingModel.current = false;
      setChecking(false);
      if (result === 'skip') {
        await create();
      } else if (result === 'ok') {
        await create(true);
      }
      // 'connect' opened S02 above this page; the form stays and no work is created.
    } catch (e) {
      if (isActive()) {
        showError(e);
      }
    } finally {
      checkingModel.current = false;
      if (mounted.current) {
        setChecking(false);
      }
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <NavBar
        title={copy.title}
        left={<Button label={t.common.cancel} variant="text" disabled={busy} onPress={() => navigation.goBack()} />}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
        <TextField
          label={copy.premiseLabel}
          accessibilityLabel={copy.premiseLabel}
          placeholder={copy.premisePlaceholder}
          value={premise}
          onChangeText={v => { setPremise(v); setErrors(prev => ({ ...prev, premise: '' })); }}
          max={2000}
          counter="always"
          onOverflow={() => setErrors(prev => ({ ...prev, premise: copy.premiseTooLong }))}
          error={errors.premise}
          multiline serif minLines={4} maxLines={6} autoFocus editable={!busy}
        />
        <View style={styles.group}>
          <Txt variant="callout" color={c.ink2}>{copy.genreLabel}</Txt>
          <View style={styles.chips}>
            {genres.map(g => <Chip key={g} label={workCopy.genres[g]} selected={g === genre} disabled={busy}
              onPress={() => setGenre(g === genre ? null : g)} />)}
          </View>
        </View>
        <TextField
          label={copy.titleLabel}
          accessibilityLabel={copy.titleLabel}
          placeholder={copy.titlePlaceholder}
          value={title}
          onChangeText={v => { setTitle(v); setErrors(prev => ({ ...prev, title: '' })); }}
          max={30} counter="near" returnKeyType="done" onSubmitEditing={Keyboard.dismiss}
          onOverflow={() => setErrors(prev => ({ ...prev, title: copy.titleTooLong }))}
          error={errors.title} editable={!busy}
        />
      </ScrollView>
      <View style={[styles.actions, { paddingBottom: insets.bottom + 12 }]}>
        <Button label={copy.ideate} onPress={ideate} disabled={busy || checking || !premise.trim()} />
        <Button label={copy.createOnly} variant="secondary" onPress={() => { create(); }} loading={busy} disabled={checking || !premise.trim()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  form: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', padding: pageMargin, gap: 24, paddingBottom: 32 },
  group: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actions: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingHorizontal: pageMargin, paddingTop: 12, gap: 8 },
});
