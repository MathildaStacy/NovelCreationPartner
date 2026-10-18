import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePreventRemove } from '@react-navigation/native';
import {
  AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance, type TextInputInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showAiErrorDetail, showError, toAppError } from '../../../app/errors';
import { useDirtyGuard } from '../../../app/hooks';
import type { RootScreenProps } from '../../../app/navigation/types';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { DelayedSpinner } from '../../../components/Loading';
import { NavBar } from '../../../components/NavBar';
import { Segmented } from '../../../components/Segmented';
import { Txt } from '../../../components/Text';
import { TextField } from '../../../components/TextField';
import { showDialog, toast } from '../../../components/overlay/store';
import { isAppError, type AppError } from '../../../features/errors';
import * as modelServices from '../../../features/modelServices';
import type { ServiceDetail } from '../../../features/modelServices';
import * as prefs from '../../../features/prefs';
import type { AiErrorInfo, Protocol } from '../../../features/types';
import { settingsText } from '../../../locales/settings';
import { t } from '../../../locales/zh-CN';
import { color as c, maxContentWidth, pageMargin } from '../../../theme/tokens';
import { removeService } from '../serviceActions';
import { AdvancedSection } from './AdvancedSection';
import {
  ADVANCED_FIELDS, FIELD_ORDER, PROTOCOLS, addressLine, draftOf, fieldOf, formFrom, hostOf, isDirty,
  keyUnavailableFailure, listCacheKey, newForm, parseBudget, resultFailure, sameConnection, switchProtocol,
  testTime, validateForm, type Field, type FixTarget, type Form,
} from './form';
import { ModelPicker } from './ModelPicker';
import { TestPanel, type TestState } from './TestPanel';

const f = settingsText.form;
const LIST_TTL = 10 * 60 * 1000;
type Errors = Partial<Record<Field, string>>;
const CONNECTION: (keyof Form)[] = ['protocol', 'baseUrl', 'model', 'authHeader'];
const CLEARS_CAPS: (keyof Form)[] = ['protocol', 'baseUrl', 'model'];

/**
 * S02 连接模型 (with S02a/b/c). The API Key exists only in this component's
 * state: never in navigation params, global stores or logs. Leaving the page,
 * changing a connection field or saving aborts page requests and drops results.
 */
export function ModelServiceScreen({ navigation, route }: RootScreenProps<'ModelService'>) {
  const params = route.params;
  const editing = params.mode === 'edit';
  const insets = useSafeAreaInsets();
  const [base, setBase] = useState<ServiceDetail | null>(null);
  const [baseline, setBaseline] = useState<Form | null>(editing ? null : newForm);
  const [form, setForm] = useState<Form | null>(editing ? null : newForm);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  // Key: page-local. `keyEdited` = typed by the author; a revealed value is not an edit.
  const [keyInput, setKeyInput] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const keyGeneration = useRef(0);
  const keyInputRef = useRef('');
  keyInputRef.current = keyInput;

  const [errors, setErrors] = useState<Errors>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [test, setTestState] = useState<TestState>({ kind: 'none' });
  const testRef = useRef<TestState>(test);
  const setTest = (next: TestState) => { testRef.current = next; setTestState(next); };
  const testController = useRef<AbortController | null>(null);
  const testGeneration = useRef(0);
  const [testedHere, setTestedHere] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [picker, setPicker] = useState(false);
  const listCache = useRef(new Map<string, { models: string[]; at: number }>());
  const mounted = useRef(true);
  const formRef = useRef(form);
  formRef.current = form;

  const scroll = useRef<ScrollViewInstance>(null);
  const positions = useRef<Partial<Record<Field | 'protocol' | 'advanced' | 'advancedTop', number>>>({});
  const inputs = { baseUrl: useRef<TextInputInstance>(null), key: useRef<TextInputInstance>(null), model: useRef<TextInputInstance>(null) };

  const dropTest = useCallback(() => {
    testGeneration.current++;
    testController.current?.abort();
    testController.current = null;
    if (testRef.current.kind !== 'none') { setTest({ kind: 'none' }); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const generation = testGeneration;
    const cache = listCache.current;
    return () => {
      // S02 closed: abort the page request and release the result association.
      mounted.current = false;
      generation.current++;
      testController.current?.abort();
      cache.clear();
    };
  }, []);

  // Background hides a shown Key (S02 rule 5).
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => { if (next !== 'active') { setShowKey(false); } });
    return () => sub.remove();
  }, []);

  const keyArg = (): string | undefined => {
    if (editing && !keyEdited) { return undefined; }
    return keyInput.trim() ? keyInput : undefined;
  };
  const keyChanged = editing ? keyEdited && keyInput.trim() !== '' : keyInput.trim() !== '';
  const keyRequired = !editing || (base !== null && !base.hasKey);
  const dirty = !!form && !!baseline && isDirty(form, baseline, keyChanged);

  usePreventRemove(saving, () => {});
  const leave = useDirtyGuard(dirty && !saving);

  const gone = useCallback(() => {
    toast(f.gone);
    leave(() => navigation.goBack());
  }, [leave, navigation]);

  // Edit mode reads the saved configuration once; S02 edits a draft and ignores later events.
  useEffect(() => {
    if (!editing) { return; }
    let alive = true;
    setLoadError(null);
    modelServices.get(params.serviceId)
      .then(detail => {
        if (!alive) { return; }
        const next = formFrom(detail);
        setBase(detail); setBaseline(next); setForm(next);
        setKeyInput(''); setKeyEdited(false); setShowKey(false); keyGeneration.current++;
        setErrors({}); setTestedHere(false);
      })
      .catch(e => {
        if (!alive) { return; }
        if (isAppError(e, 'NOT_FOUND')) { gone(); } else { setLoadError(e); }
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadNonce]);

  // D03 情况 B / 填写 Key: focus the Key after the push transition and the data are ready.
  const [appeared, setAppeared] = useState(false);
  const focusedOnce = useRef(false);
  useLayoutEffect(() => navigation.addListener('transitionEnd', e => { if (!e.data.closing) { setAppeared(true); } }), [navigation]);
  useEffect(() => {
    if (params.focus !== 'key' || !appeared || !form || focusedOnce.current) { return; }
    focusedOnce.current = true;
    const frame = requestAnimationFrame(() => inputs.key.current?.focus());
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appeared, form, params.focus]);

  const scrollTo = (target: Field | 'protocol') => {
    const pos = positions.current;
    const y = ADVANCED_FIELDS.includes(target as Field)
      ? (pos.advanced ?? 0) + (pos.advancedTop ?? 0) + (pos[target] ?? 0)
      : pos[target] ?? 0;
    scroll.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
  };

  const showErrors = (next: Errors) => {
    setErrors(next);
    const first = FIELD_ORDER.find(field => next[field]);
    if (!first) { return; }
    if (ADVANCED_FIELDS.includes(first) || ADVANCED_FIELDS.some(field => next[field])) { setAdvancedOpen(true); }
    // Wait for the advanced section to lay out before scrolling.
    setTimeout(() => { if (mounted.current) { scrollTo(first); } }, 50);
  };

  const fix = (target: FixTarget) => {
    scrollTo(target);
    if (target !== 'protocol') {
      setTimeout(() => inputs[target].current?.focus(), 50);
    }
  };

  const edit = <K extends keyof Form>(key: K, value: Form[K]) => {
    if (!form || form[key] === value) { return; }
    let next = { ...form, [key]: value };
    if (CONNECTION.includes(key)) {
      dropTest();
      if (CLEARS_CAPS.includes(key)) { next = { ...next, caps: {} }; }
    }
    setForm(next);
    const field = (FIELD_ORDER as string[]).includes(key) ? key as Field : null;
    if (field && errors[field]) { setErrors(prev => ({ ...prev, [field]: undefined })); }
  };

  const changeProtocol = (next: Protocol) => {
    if (!form || form.protocol === next) { return; }
    dropTest();
    setForm(switchProtocol(form, next));
    setErrors(prev => ({ ...prev, baseUrl: undefined }));
  };

  const changeKey = (value: string) => {
    keyGeneration.current++;
    setKeyInput(value);
    setKeyEdited(true);
    dropTest();
    if (errors.key) { setErrors(prev => ({ ...prev, key: undefined })); }
  };

  const toggleKey = async () => {
    if (showKey) { setShowKey(false); return; }
    if (editing && base?.hasKey && keyInputRef.current === '') {
      const generation = keyGeneration.current;
      try {
        const value = await modelServices.revealKey(base.id);
        // Never overwrite something typed meanwhile, and never reveal into a closed or backgrounded page.
        if (!mounted.current || generation !== keyGeneration.current || keyInputRef.current !== '' || AppState.currentState === 'background' || AppState.currentState === 'inactive') { return; }
        setKeyInput(value);
        setShowKey(true);
      } catch {
        if (mounted.current && generation === keyGeneration.current) { toast(f.keyRevealFailed); }
      }
      return;
    }
    setShowKey(true);
  };

  const blurBaseUrl = () => {
    if (!form) { return; }
    const message = validateForm(form, '', false, false).baseUrl;
    if (message) { setErrors(prev => ({ ...prev, baseUrl: message })); }
  };

  const blurNumber = (field: 'maxOutput' | 'budget') => {
    if (!form) { return; }
    const message = validateForm(form, '', false, false)[field];
    if (message) { setErrors(prev => ({ ...prev, [field]: message })); return; }
    if (field === 'budget') {
      const rounded = String(parseBudget(form.budget));
      if (rounded !== form.budget) { setForm({ ...form, budget: rounded }); }
    }
  };

  const clearCaps = () => {
    if (!form) { return; }
    // Also forget the test association so save cannot merge its old capability patch again.
    dropTest();
    setForm({ ...form, caps: {} });
    toast(settingsText.advanced.capsCleared);
  };

  const runTest = async () => {
    if (!form || savingRef.current) { return; }
    const key = keyArg();
    const found = validateForm(form, key ?? '', keyRequired);
    if (Object.keys(found).length) { showErrors(found); return; }
    Keyboard.dismiss();
    dropTest();
    const generation = testGeneration.current;
    const controller = new AbortController();
    testController.current = controller;
    const draft = draftOf(form, base);
    const cacheKey = listCacheKey(form, base?.revision, keyGeneration.current);
    setTestedHere(true);
    setTest({ kind: 'running', started: Date.now(), host: hostOf(form.baseUrl), retry: null });
    try {
      const result = await modelServices.test(draft, key, {
        signal: controller.signal,
        onRetry: attempt => {
          const current = testRef.current;
          if (generation === testGeneration.current && mounted.current && current.kind === 'running') {
            setTest({ ...current, retry: attempt });
          }
        },
      });
      if (generation !== testGeneration.current || !mounted.current) { return; }
      if (result.models && cacheKey) { listCache.current.set(cacheKey, { models: result.models, at: Date.now() }); }
      setTest({ kind: 'done', result, model: draft.model.trim() });
    } catch (e) {
      if (generation !== testGeneration.current || !mounted.current) { return; }
      testController.current = null;
      const error = toAppError(e);
      if (error.code === 'AI_CANCELLED') { setTest({ kind: 'none' }); }
      else if (error.code === 'KEY_UNAVAILABLE') { setTest({ kind: 'local', failure: keyUnavailableFailure }); }
      else if (error.code === 'NOT_FOUND') { gone(); }
      else {
        setTest({ kind: 'none' });
        const field = fieldOf(error.field);
        if (field) { showErrors({ [field]: error.message }); } else { showError(error); }
      }
    }
  };

  const currentResult = () => (testRef.current.kind === 'done' ? testRef.current.result : undefined);

  const afterSave = async (pending: boolean) => {
    const from = params.from;
    if (from === 'welcome') {
      // S01 is not routed in this phase; kept for the guide entry (S02 rule 9).
      if (!(await prefs.get('onboardingDone').catch(() => true))) { await prefs.set('onboardingDone', true).catch(() => {}); }
      leave(() => navigation.reset({ index: 0, routes: [{ name: 'Shelf' }] }));
      return;
    }
    toast(pending ? f.savedPending : from === 'd03' ? f.savedFromD03 : from === 'error' ? f.savedFromError : f.saved);
    leave(() => navigation.goBack());
  };

  const saveFailed = async (error: AppError) => {
    const field = fieldOf(error.field);
    if ((error.code === 'VALIDATION' || error.code === 'DUPLICATE') && field) {
      showErrors({ [field]: error.message });
    } else if (error.code === 'KEY_UNAVAILABLE') {
      await showDialog({ title: f.notSaved, message: f.keyStoreFailed, buttons: [{ key: 'ok', label: t.common.gotIt, style: 'primary' }], dismissKey: 'ok' });
    } else if (error.code === 'NOT_FOUND') {
      gone();
    } else if (error.code === 'CONFLICT_STATE') {
      const key = await showDialog({
        title: f.conflictTitle, message: f.conflictBody,
        buttons: [{ key: 'keep', label: t.unsaved.keep }, { key: 'reload', label: f.reload, style: 'primary' }],
        dismissKey: 'keep',
      });
      if (key === 'reload' && mounted.current) { dropTest(); setLoadNonce(n => n + 1); }
    } else {
      showError(error, { title: f.notSaved });
    }
  };

  const save = async () => {
    if (!form || !baseline || savingRef.current) { return; }
    const key = keyArg();
    const found = validateForm(form, key ?? '', keyRequired);
    if (Object.keys(found).length) { showErrors(found); return; }
    Keyboard.dismiss();
    // Saving while testing aborts the test first and counts as untested.
    if (testRef.current.kind === 'running') { dropTest(); }
    const result = currentResult();
    const connectionChanged = !editing || !sameConnection(form, baseline) || key !== undefined;
    if (connectionChanged && !result) {
      const choice = await showDialog({
        title: f.untestedTitle, message: f.untestedBody,
        buttons: [{ key: 'test', label: f.testFirst }, { key: 'save', label: f.saveAnyway, style: 'primary' }],
        dismissKey: 'dismiss',
      });
      if (choice === 'test') { runTest(); return; }
      if (choice !== 'save') { return; }
    } else if (connectionChanged && result && !result.ok) {
      const failure = resultFailure(result);
      const choice = await showDialog({
        title: f.failedTitle, message: failure?.message,
        buttons: [{ key: 'fix', label: f.keepEditing }, { key: 'save', label: f.saveFailed, style: 'primary' }],
        dismissKey: 'fix',
      });
      if (choice !== 'save') {
        if (failure?.fix) { fix(failure.fix); }
        return;
      }
    }
    const latest = formRef.current;
    if (!latest || !mounted.current || savingRef.current) { return; }
    savingRef.current = true;
    setSaving(true);
    try {
      const out = await modelServices.save(draftOf(latest, base), key, currentResult());
      savingRef.current = false;
      if (!mounted.current) { return; }
      setSaving(false);
      // Saved: abort page requests and release the Key and result references.
      dropTest();
      setKeyInput('');
      setShowKey(false);
      await afterSave(out.keyCleanupPending);
    } catch (e) {
      savingRef.current = false;
      if (!mounted.current) { return; }
      setSaving(false);
      await saveFailed(toAppError(e));
    }
  };

  const remove = async () => {
    if (!base || savingRef.current) { return; }
    dropTest();
    const all = await modelServices.list().catch(() => []);
    const current = all.find(item => item.id === base.id) ?? base;
    if (await removeService(current, all.length ? all : [current])) {
      leave(() => navigation.goBack());
    }
  };

  const later = () => {
    // S01 "稍后再说": not routed in this phase.
    prefs.set('onboardingDone', true).catch(() => {});
    leave(() => navigation.reset({ index: 0, routes: [{ name: 'Shelf' }] }));
  };

  const openPicker = () => {
    if (!form) { return; }
    const found = validateForm(form, keyArg() ?? '', keyRequired, false);
    const blocking: Errors = { baseUrl: found.baseUrl, key: found.key };
    if (blocking.baseUrl || blocking.key) { showErrors(blocking); return; }
    Keyboard.dismiss();
    setPicker(true);
  };

  const pickModel = (model: string) => {
    setPicker(false);
    if (form && model !== form.model) { edit('model', model); }
  };

  const listCacheFor = useMemo(() => {
    const key = form ? listCacheKey(form, base?.revision, keyGeneration.current) : null;
    return {
      get: () => {
        const hit = key ? listCache.current.get(key) : undefined;
        return hit && Date.now() - hit.at < LIST_TTL ? hit.models : null;
      },
      set: (models: string[]) => { if (key) { listCache.current.set(key, { models, at: Date.now() }); } },
    };
    // The cache key changes with the Key edit generation, which only changes with keyInput.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, base?.revision, keyInput]);

  const title = params.mode === 'edit' ? f.titleEdit : params.mode === 'add' ? f.titleAdd : f.titleGuide;
  const navBar = (
    <NavBar title={title} onBack={saving ? undefined : () => navigation.goBack()}
      right={params.from === 'welcome' && !editing ? <Button label={f.later} variant="text" disabled={saving} onPress={later} /> : undefined} />
  );

  if (!form || !baseline) {
    return (
      <View style={styles.root}>
        {navBar}
        {loadError ? (
          <EmptyState title={f.loadFailed} action={{ label: t.common.retry, onPress: () => setLoadNonce(n => n + 1) }} style={styles.fill} />
        ) : <DelayedSpinner />}
      </View>
    );
  }

  const address = addressLine(form.protocol, form.baseUrl);
  const keyPlaceholder = !editing || !base ? undefined
    : !base.hasKey ? undefined : base.keyMask ? f.keySaved(base.keyMask) : f.keyUnreadable;
  const keyHelp = editing && base?.hasKey && !base.keyMask ? f.keyUnreadableHelp
    : Platform.OS === 'ios' ? f.keyHelpIos : f.keyHelpAndroid;
  const caps = { ...form.caps, ...(test.kind === 'done' ? test.result.capsPatch : null) };
  const busy = saving;
  const lastTest = editing && base?.lastTest && !testedHere ? base.lastTest : null;
  const layout = (key: Field | 'protocol' | 'advanced') => (e: { nativeEvent: { layout: { y: number } } }) => {
    positions.current[key] = e.nativeEvent.layout.y;
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      {navBar}
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
        <View style={styles.group} onLayout={layout('protocol')}>
          <Txt variant="callout" color={c.ink2}>{f.protocol}</Txt>
          <Segmented value={form.protocol} onChange={changeProtocol} locked={busy}
            segments={PROTOCOLS.map(key => ({ key, label: f.protocols[key] }))} />
        </View>
        <View style={styles.group} onLayout={layout('baseUrl')}>
          <TextField ref={inputs.baseUrl} label={f.baseUrl} accessibilityLabel={f.baseUrl} value={form.baseUrl}
            onChangeText={v => edit('baseUrl', v)} onBlur={blurBaseUrl} keyboardType="url" autoCapitalize="none"
            autoCorrect={false} editable={!busy} error={errors.baseUrl}
            help={address.url ? f.resolved(address.url) : f.resolvedPending} />
          {address.insecure && !errors.baseUrl ? <Txt variant="caption" color={c.pend}>{f.httpWarning}</Txt> : null}
        </View>
        <View style={styles.group} onLayout={layout('key')}>
          {editing && base && !base.hasKey ? <Txt variant="callout" color={c.pend}>{f.keyMissing}</Txt> : null}
          <TextField ref={inputs.key} label={f.apiKey} accessibilityLabel={f.apiKey} value={keyInput}
            onChangeText={changeKey} secureTextEntry={!showKey} autoCapitalize="none" autoCorrect={false}
            autoComplete="off" importantForAutofill="no" placeholder={keyPlaceholder} editable={!busy}
            error={errors.key} help={keyHelp}
            accessory={<Button label={showKey ? f.hide : f.show} accessibilityLabel={showKey ? f.hideA11y : f.showA11y}
              variant="text" size="small" disabled={busy} onPress={toggleKey} />} />
        </View>
        <View style={styles.group} onLayout={layout('model')}>
          <TextField ref={inputs.model} label={f.model} accessibilityLabel={f.model} value={form.model}
            onChangeText={v => edit('model', v)} autoCapitalize="none" autoCorrect={false}
            placeholder={f.modelPlaceholder[form.protocol]} editable={!busy} error={errors.model}
            accessory={<Button label={f.pick} variant="text" size="small" disabled={busy} onPress={openPicker} />} />
        </View>
        <View style={styles.group}>
          <Button label={test.kind === 'running' ? settingsText.test.running : test.kind === 'none' ? settingsText.test.run : settingsText.test.again}
            variant="secondary" disabled={busy || test.kind === 'running'} onPress={runTest} />
          {lastTest ? (
            <Txt variant="caption" color={c.ink3}>
              {lastTest.ok ? settingsText.test.lastOk(testTime(lastTest.at)) : settingsText.test.lastFailed(testTime(lastTest.at), lastTest.message)}
            </Txt>
          ) : null}
          <TestPanel state={test} onCancel={dropTest} onFix={fix} onPick={openPicker}
            onDetail={(info: AiErrorInfo) => { showAiErrorDetail(info, { protocol: form.protocol, baseUrl: form.baseUrl }); }} />
        </View>
        <View onLayout={layout('advanced')}>
          <AdvancedSection form={form} open={advancedOpen} errors={errors} caps={caps} editable={!busy}
            onToggle={() => {
              const opening = !advancedOpen;
              setAdvancedOpen(opening);
              if (opening) { setTimeout(() => { if (mounted.current) { scrollTo('name'); } }, 50); }
            }}
            onChange={edit} onBlurNumber={blurNumber} onClearCaps={clearCaps}
            onFieldLayout={(field, y) => { positions.current[field === 'top' ? 'advancedTop' : field] = y; }} />
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Button label={saving ? f.saving : f.save} disabled={saving} onPress={save} accessibilityLabel={f.save} />
        {editing && base ? (
          <Pressable onPress={saving ? undefined : remove} accessibilityRole="button" accessibilityState={{ disabled: saving }}
            style={({ pressed }) => [styles.remove, (pressed || saving) && styles.dim]}>
            <Txt color={c.conf}>{f.remove}</Txt>
          </Pressable>
        ) : null}
      </View>
      {picker ? (
        <ModelPicker draft={draftOf(form, base, true)} keyArg={keyArg()} current={form.model} cache={listCacheFor}
          onSelect={pickModel} onClose={() => setPicker(false)}
          onFixKey={() => { setPicker(false); setTimeout(() => fix('key'), 300); }} />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  fill: { flex: 1 },
  form: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', padding: pageMargin, gap: 20, paddingBottom: 32 },
  group: { gap: 8 },
  footer: {
    paddingHorizontal: pageMargin, paddingTop: 12, gap: 4, backgroundColor: c.paper,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line,
  },
  remove: { alignSelf: 'center', minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  dim: { opacity: 0.5 },
});
