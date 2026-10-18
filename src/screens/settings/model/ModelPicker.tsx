import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, Modal, Platform, Pressable, StyleSheet, TextInput,
  View, type TextInputInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, CircleX, RefreshCw, Search } from 'lucide-react-native';
import { showAiErrorDetail, toAppError } from '../../../app/errors';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { IconButton } from '../../../components/IconButton';
import { Txt } from '../../../components/Text';
import { OverlayHost, dismissTopDialog } from '../../../components/overlay/OverlayHost';
import { popSheet, pushSheet, useOverlay } from '../../../components/overlay/store';
import { AiCallError, type AppError } from '../../../features/errors';
import * as modelServices from '../../../features/modelServices';
import type { ServiceDraft } from '../../../features/modelServices';
import * as prefs from '../../../features/prefs';
import { settingsText } from '../../../locales/settings';
import { t } from '../../../locales/zh-CN';
import { color as c, hitSize, pageMargin, radius, rowMinHeight } from '../../../theme/tokens';
import { hostOf, isNonText, searchKey, sortModels } from './form';

const p = settingsText.picker;

export interface ModelListCache {
  get: () => string[] | null;
  set: (models: string[]) => void;
}

export interface ModelPickerProps {
  /** S02's draft (protocol, address, auth header, id/revision); never a navigation param. */
  draft: ServiceDraft;
  /** Key input for this request; undefined lets the service read the saved Key. */
  keyArg: string | undefined;
  current: string;
  cache: ModelListCache;
  onSelect: (model: string) => void;
  onClose: () => void;
  onFixKey: () => void;
}

type ListState =
  | { kind: 'loading' }
  | { kind: 'ok'; models: string[] }
  | { kind: 'error'; error: AppError };

type Row =
  | { type: 'use'; value: string }
  | { type: 'tooLong' }
  | { type: 'header'; title: string }
  | { type: 'model'; id: string; group: 'recent' | 'list'; unlisted?: boolean }
  | { type: 'status' }
  | { type: 'hidden'; count: number }
  | { type: 'noMatch'; query: string };

/**
 * S02a: full-screen modal owned by S02 (not a route, so the Key never enters
 * navigation state). Closing aborts the list request; the list is cached by S02.
 */
export function ModelPicker({ draft, keyArg, current, cache, onSelect, onClose, onFixKey }: ModelPickerProps) {
  const insets = useSafeAreaInsets();
  const [level, setLevel] = useState(0);
  const [query, setQuery] = useState('');
  const [deferred, setDeferred] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [showAll, setShowAll] = useState(false);
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInputInstance>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const args = useRef({ draft, keyArg, cache });
  args.current = { draft, keyArg, cache };

  useEffect(() => {
    mounted.current = true;
    setLevel(pushSheet());
    const requests = generation;
    return () => {
      mounted.current = false;
      requests.current++;
      controller.current?.abort();
      popSheet();
    };
  }, []);

  useEffect(() => {
    prefs.get('recentModels')
      .then(items => {
        if (mounted.current) {
          setRecent(items.filter(item => item.protocol === draft.protocol).slice(0, 5).map(item => item.model));
        }
      })
      .catch(() => {});
  }, [draft.protocol]);

  const load = (force: boolean) => {
    const cached = force ? null : args.current.cache.get();
    if (cached) { setList({ kind: 'ok', models: cached }); return; }
    controller.current?.abort();
    const own = new AbortController();
    controller.current = own;
    const gen = ++generation.current;
    setList({ kind: 'loading' });
    modelServices.fetchModels(args.current.draft, args.current.keyArg, { signal: own.signal })
      .then(models => {
        if (!mounted.current || gen !== generation.current) { return; }
        args.current.cache.set(models);
        setList({ kind: 'ok', models });
      })
      .catch((e: unknown) => {
        if (!mounted.current || gen !== generation.current) { return; }
        // Our own aborts bump the generation; anything else (e.g. a cancelled slot) can be retried.
        setList({ kind: 'error', error: toAppError(e) });
      });
  };
  useEffect(() => load(false), []);

  const errorKind = list.kind !== 'error' ? null : listErrorKind(list.error);
  useEffect(() => {
    if (errorKind === 'noEndpoint' || errorKind === 'failed') {
      const frame = requestAnimationFrame(() => input.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [errorKind]);

  const models = useMemo(() => (list.kind === 'ok' ? sortModels(list.models) : []), [list]);
  // S02a §6: filter synchronously, debounce only very long lists.
  useEffect(() => {
    if (models.length <= 1000) { setDeferred(query); return; }
    const timer = setTimeout(() => setDeferred(query), 150);
    return () => clearTimeout(timer);
  }, [query, models.length]);

  const value = query.trim();
  const rows = useMemo<Row[]>(() => {
    const q = deferred.trim();
    const key = searchKey(q);
    const match = (id: string) => !key || searchKey(id).includes(key);
    const loaded = list.kind === 'ok';
    const out: Row[] = [];
    if (q) {
      if ([...q].length > 200) { out.push({ type: 'tooLong' }); }
      else if (!recent.includes(q) && !models.includes(q)) { out.push({ type: 'use', value: q }); }
    }
    const recentRows: Row[] = recent.filter(match).map(id => ({ type: 'model', id, group: 'recent', unlisted: loaded && !models.includes(id) }));
    if (!q && current && !recent.includes(current) && !(loaded && models.includes(current))) {
      recentRows.unshift({ type: 'model', id: current, group: 'recent', unlisted: true });
    }
    if (recentRows.length) { out.push({ type: 'header', title: p.recent }, ...recentRows); }
    if (list.kind !== 'ok') {
      out.push({ type: 'status' });
      return out;
    }
    const matched = models.filter(match);
    const visible = showAll ? matched : matched.filter(id => !isNonText(id));
    const hidden = matched.length - matched.filter(id => !isNonText(id)).length;
    if (q && recentRows.length === 0 && matched.length === 0) {
      out.push({ type: 'noMatch', query: q });
      return out;
    }
    if (models.length === 0) {
      out.push({ type: 'status' });
      return out;
    }
    out.push({ type: 'header', title: p.provided(visible.length) });
    out.push(...visible.map(id => ({ type: 'model', id, group: 'list' }) as Row));
    if (hidden > 0) { out.push({ type: 'hidden', count: hidden }); }
    return out;
  }, [deferred, list, models, recent, current, showAll]);

  const select = (model: string) => {
    generation.current++;
    controller.current?.abort();
    Keyboard.dismiss();
    onSelect(model);
  };

  const submit = () => {
    const use = rows.find(row => row.type === 'use');
    if (use && use.type === 'use') { select(use.value); return; }
    const choices = rows.filter((row): row is Extract<Row, { type: 'model' }> => row.type === 'model');
    const unique = [...new Set(choices.map(row => row.id))];
    if (value && unique.length === 1) { select(unique[0]); return; }
    Keyboard.dismiss();
  };

  const requestClose = () => {
    // A dialog inside this modal takes the back press first.
    const overlay = useOverlay.getState();
    if (overlay.depth === level && overlay.dialogs.length) { dismissTopDialog(); return; }
    onClose();
  };

  const detail = (error: AppError) => {
    if (error instanceof AiCallError) {
      showAiErrorDetail(error.info, { protocol: draft.protocol, baseUrl: draft.baseUrl, kind: 'models' });
    }
  };

  const renderStatus = () => {
    if (list.kind === 'loading') {
      return (
        <View style={styles.status}>
          <ActivityIndicator color={c.ink3} />
          <Txt variant="callout" color={c.ink3}>{p.loading}</Txt>
        </View>
      );
    }
    if (list.kind === 'ok') { return <Txt variant="callout" color={c.ink3} style={styles.status}>{p.empty}</Txt>; }
    const error = list.error;
    const info = error instanceof AiCallError ? error.info : null;
    const kind = listErrorKind(error);
    const message = kind === 'noEndpoint' ? p.noEndpoint : kind === 'keyUnavailable' ? p.keyUnavailable
      : error.code === 'AI_RATE_LIMIT' ? p.rateLimit : error.message;
    return (
      <View style={styles.status}>
        <Txt variant="callout" color={kind === 'noEndpoint' ? c.ink2 : c.conf}>{message}</Txt>
        <View style={styles.actions}>
          {kind === 'auth' ? <Button label={p.fixKey} variant="text" size="small" onPress={onFixKey} /> : null}
          {kind === 'keyUnavailable' || kind === 'failed' ? <Button label={t.common.retry} variant="text" size="small" onPress={() => load(true)} /> : null}
          {info && kind !== 'noEndpoint' ? <Button label={t.common.viewDetail} variant="text" size="small" onPress={() => detail(error)} /> : null}
        </View>
      </View>
    );
  };

  const renderRow = ({ item }: { item: Row }) => {
    switch (item.type) {
      case 'use':
        return (
          <Pressable onPress={() => select(item.value)} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <Txt color={c.brand} numberOfLines={1} ellipsizeMode="middle">{p.useAs(item.value)}</Txt>
          </Pressable>
        );
      case 'tooLong':
        return <View style={styles.row}><Txt color={c.ink3}>{p.tooLong}</Txt></View>;
      case 'header':
        return <Txt variant="callout" color={c.ink2} style={styles.header}>{item.title}</Txt>;
      case 'model': {
        const isCurrent = item.id === current;
        return (
          <Pressable onPress={() => (isCurrent ? onClose() : select(item.id))} accessibilityRole="button"
            accessibilityLabel={item.id} accessibilityState={{ selected: isCurrent }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <Txt style={styles.model} numberOfLines={1} ellipsizeMode="middle">{item.id}</Txt>
            {item.unlisted ? <Txt variant="caption" color={c.ink3}>{p.notListed}</Txt> : null}
            {isCurrent ? <Badge label={p.current} tone="confirmed" /> : null}
            {isCurrent ? <Check size={18} color={c.brand} /> : null}
          </Pressable>
        );
      }
      case 'status':
        return renderStatus();
      case 'hidden':
        return (
          <Button label={showAll ? p.collapse : p.hidden(item.count)} variant="text" size="small"
            onPress={() => setShowAll(v => !v)} style={styles.hidden} />
        );
      case 'noMatch':
        return <Txt variant="callout" color={c.ink3} style={styles.status}>{p.noMatch(item.query)}</Txt>;
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={requestClose} statusBarTranslucent={Platform.OS === 'android'} navigationBarTranslucent={Platform.OS === 'android'}>
      <View style={[styles.root, Platform.OS === 'android' ? { paddingTop: insets.top } : null]}>
        <View style={styles.bar}>
          <Button label={p.cancel} variant="text" onPress={onClose} />
          <Txt variant="headline" style={styles.title} accessibilityRole="header">{p.title}</Txt>
          {list.kind === 'loading' ? (
            <View style={styles.spinner}><ActivityIndicator size="small" color={c.ink3} /></View>
          ) : (
            <IconButton label={p.refreshA11y} onPress={() => load(true)}><RefreshCw size={20} color={c.brand} /></IconButton>
          )}
        </View>
        <Txt variant="caption" color={c.ink3} style={styles.service} numberOfLines={1}>
          {`${hostOf(draft.baseUrl)} · ${settingsText.form.protocols[draft.protocol]}`}
        </Txt>
        <View style={styles.searchBox}>
          <Search size={18} color={c.ink3} />
          <TextInput ref={input} value={query} onChangeText={setQuery} placeholder={p.search} placeholderTextColor={c.ink3}
            accessibilityLabel={p.search} autoCapitalize="none" autoCorrect={false} returnKeyType="done"
            onSubmitEditing={submit} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            style={styles.searchInput} />
          {focused && query ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="清除" hitSlop={10}>
              <CircleX size={18} color={c.ink3} />
            </Pressable>
          ) : null}
        </View>
        <FlatList data={rows} renderItem={renderRow} keyboardShouldPersistTaps="handled"
          keyExtractor={(row, i) => (row.type === 'model' ? `${row.group}:${row.id}` : `${row.type}:${i}`)}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} initialNumToRender={30} windowSize={9} />
      </View>
      <OverlayHost level={level} />
    </Modal>
  );
}

type ListErrorKind = 'noEndpoint' | 'auth' | 'keyUnavailable' | 'failed';
function listErrorKind(error: AppError): ListErrorKind {
  const status = error instanceof AiCallError ? error.info.status : null;
  if (error.code === 'AI_NOT_FOUND' || status === 404 || status === 405) { return 'noEndpoint'; }
  if (error.code === 'AI_AUTH' || error.code === 'AI_PERMISSION') { return 'auth'; }
  if (error.code === 'KEY_UNAVAILABLE') { return 'keyUnavailable'; }
  return 'failed';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  bar: { height: hitSize + 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  title: { position: 'absolute', left: 96, right: 96, textAlign: 'center' },
  spinner: { width: hitSize, height: hitSize, alignItems: 'center', justifyContent: 'center' },
  service: { paddingHorizontal: pageMargin, marginBottom: 8, textAlign: 'center' },
  searchBox: {
    marginHorizontal: pageMargin, marginBottom: 8, minHeight: 44, borderRadius: radius.field, backgroundColor: c.surface,
    borderWidth: 1, borderColor: c.line, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8,
  },
  searchInput: { flex: 1, padding: 0, fontSize: 15, color: c.ink, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  header: { paddingHorizontal: pageMargin, paddingTop: 16, paddingBottom: 6 },
  row: {
    minHeight: rowMinHeight - 8, paddingHorizontal: pageMargin, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line,
  },
  pressed: { backgroundColor: c.sunken },
  model: { flex: 1, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  status: { paddingHorizontal: pageMargin, paddingVertical: 16, gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginLeft: -8 },
  hidden: { alignSelf: 'flex-start', marginHorizontal: pageMargin - 8, marginTop: 8 },
});
