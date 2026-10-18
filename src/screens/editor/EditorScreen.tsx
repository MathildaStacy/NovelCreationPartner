import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import { Ellipsis, Undo2, Redo2 } from 'lucide-react-native';
import { ActionSheet } from '../../components/ActionSheet';
import { Button } from '../../components/Button';
import { ChapterBadge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { DelayedSpinner } from '../../components/Loading';
import { NavBar } from '../../components/NavBar';
import { Txt } from '../../components/Text';
import { showDialog, toast } from '../../components/overlay/store';
import { ensureModelService } from '../../app/dialogs';
import { showError, showErrorDetail, toAppError } from '../../app/errors';
import { logError } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import * as chapters from '../../features/chapters';
import * as conflicts from '../../features/conflicts';
import * as prefs from '../../features/prefs';
import * as versions from '../../features/versions';
import { on } from '../../features/events';
import { isAppError } from '../../features/errors';
import type { Chapter } from '../../features/types';
import { t } from '../../locales/zh-CN';
import { editorCopy } from '../../locales/editor';
import {
  color as c,
  font as fonts,
  maxContentWidth,
  maxFontSizeMultiplier,
} from '../../theme/tokens';
import {
  chapterHeading,
  chapterPrefix,
  STATE_LABEL,
  truncate,
} from '../../utils/format';
import { countChars } from '../../utils/text';
import { ChapterFormSheet } from '../work/ChapterFormSheet';
import { Autosave, type SaveStatus } from './autosave';
import {
  displayEdit,
  toBodyOffset,
  toDisplay,
  toDisplayOffset,
  toBody,
  type Selection,
} from './indent';
import { EditHistory } from './history';
import { locateSelection } from './locate';
import { finalizeWithConfirm } from './finalize';
import { FontSheet } from './FontSheet';

const inBackground = (work: Promise<unknown> | undefined) => {
  work?.catch(logError('editor'));
};

type SaveResult = Awaited<ReturnType<typeof chapters.saveBody>>;

export function EditorScreen({ navigation, route }: RootScreenProps<'Editor'>) {
  const { chapterId, workId } = route.params;
  const insets = useSafeAreaInsets();
  const input = useRef<React.ElementRef<typeof TextInput>>(null);
  const nativeText = useRef<string | null>(null);
  const ignoreNativeSelection = useRef(false);
  const [chapter, setChapter] = useState<Chapter>();
  const chapterRef = useRef<Chapter | undefined>(undefined);
  const [error, setError] = useState<unknown>();
  const [body, setBody] = useState('');
  const bodyRef = useRef('');
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const selectionRef = useRef(selection);
  const [chars, setChars] = useState(0);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [editorFont, setEditorFont] =
    useState<prefs.Prefs['editorFont']>('serif');
  const [editorSize, setEditorSize] =
    useState<prefs.Prefs['editorFontSize']>(18);
  const [finalBody, setFinalBody] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [form, setForm] = useState(false);
  const [fontSheet, setFontSheet] = useState(false);
  const [longDismissed, setLongDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(() =>
    Keyboard.isVisible(),
  );
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const [allowRemove, setAllowRemove] = useState(false);
  const goBackAfterBypass = useRef(false);
  useEffect(() => {
    if (allowRemove && goBackAfterBypass.current) {
      goBackAfterBypass.current = false;
      navigation.goBack();
    }
  }, [allowRemove, navigation]);
  const alive = useRef(true);
  const loadSeq = useRef(0);
  const leaving = useRef(false);
  const session = useRef<Autosave<SaveResult> | null>(null);
  const history = useRef(new EditHistory());
  const [, refreshHistory] = useState(0);
  const errorShown = useRef(false);
  const backgroundError = useRef<unknown>(undefined);
  const [retryLoad, setRetryLoad] = useState(0);
  const conflictList = useLoad(
    () => conflicts.forChapter(chapterId),
    [chapterId],
    {
      events: { 'conflicts.changed': e => e.workId === workId },
    },
  );

  const select = useCallback((s: Selection) => {
    selectionRef.current = s;
    setSelection(s);
    if (session.current) {
      session.current.cursor = s.start;
    }
  }, []);

  const load = useCallback(
    async (restored = false) => {
      const seq = ++loadSeq.current;
      try {
        const [ch, family, size] = await Promise.all([
          chapters.get(chapterId),
          prefs.get('editorFont'),
          prefs.get('editorFontSize'),
        ]);
        if (!alive.current || seq !== loadSeq.current) {
          return;
        }
        const located = locateSelection(
          ch.body,
          restored ? 0 : ch.lastCursor,
          restored ? undefined : route.params.locate,
        );
        session.current?.dispose();
        history.current = new EditHistory();
        chapterRef.current = ch;
        bodyRef.current = ch.body;
        setChapter(ch);
        setBody(ch.body);
        setChars(ch.charCount);
        setError(undefined);
        setStatus('saved');
        setEditorFont(family);
        setEditorSize(size);
        select(located.selection);
        errorShown.current = false;
        session.current = new Autosave(
          ch.body,
          located.selection.start,
          (text, cursor) =>
            chapters.saveBody(chapterId, text, cursor).catch(e => {
              throw toAppError(e);
            }),
          (nextStatus, result, saveError) => {
            if (!alive.current || seq !== loadSeq.current) {
              return;
            }
            setStatus(nextStatus);
            if (result) {
              setChapter(current =>
                current
                  ? {
                      ...current,
                      state: result.state,
                      charCount: result.charCount,
                    }
                  : current,
              );
              if (errorShown.current) {
                toast(t.editor.saved);
                errorShown.current = false;
              }
            }
            if (saveError && !errorShown.current) {
              errorShown.current = true;
              if (AppState.currentState === 'active') {
                inBackground(showError(saveError));
              } else {
                backgroundError.current = saveError;
              }
            }
          },
        );
        if (located.missing) {
          toast(
            located.missing === 'near'
              ? t.editor.locateNear
              : t.editor.locateMissing,
          );
        }
        if (restored) {
          toast(t.editor.restored);
          navigation.setParams({ restored: undefined, locate: undefined });
        }
        input.current?.focus();
        if (ch.finalizedVersionId) {
          const saved = await versions
            .get(ch.finalizedVersionId)
            .catch(() => null);
          if (alive.current && seq === loadSeq.current) {
            setFinalBody(saved?.body ?? null);
          }
        } else {
          setFinalBody(null);
        }
      } catch (e) {
        if (!alive.current || seq !== loadSeq.current) {
          return;
        }
        if (isAppError(e, 'NOT_FOUND')) {
          toast(e.message);
          goBackAfterBypass.current = true;
          setAllowRemove(true);
        } else {
          setError(e);
        }
      }
    },
    [chapterId, navigation, route.params.locate, select],
  );

  useEffect(() => {
    alive.current = true;
    inBackground(load(!!route.params.restored));
    return () => {
      alive.current = false;
      session.current?.dispose();
    };
    // Initialization deliberately does not reread the body on metadata events or focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, retryLoad]);

  useEffect(() => {
    if (route.params.restored && chapterRef.current) {
      inBackground(load(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.restored, route.params.focusNonce]);

  useEffect(() => {
    const timer = setTimeout(() => setChars(countChars(body)), 500);
    return () => clearTimeout(timer);
  }, [body]);

  useEffect(() => {
    let metadataSeq = 0;
    let prefSeq = 0;
    const offChapter = on('chapters.changed', e => {
      if (e.workId !== workId) {
        return;
      }
      const seq = ++metadataSeq;
      chapters
        .get(chapterId)
        .then(async ch => {
          if (!alive.current || seq !== metadataSeq) {
            return;
          }
          chapterRef.current = ch;
          setChapter(ch);
          const saved = ch.finalizedVersionId
            ? await versions.get(ch.finalizedVersionId).catch(() => null)
            : null;
          if (alive.current && seq === metadataSeq) {
            setFinalBody(saved?.body ?? null);
          }
        })
        .catch(metadataError => {
          if (alive.current && isAppError(metadataError, 'NOT_FOUND')) {
            toast(metadataError.message);
            goBackAfterBypass.current = true;
            setAllowRemove(true);
          }
        });
    });
    const offSaved = on('chapter.saved', e => {
      if (e.chapterId === chapterId && alive.current) {
        setChapter(ch =>
          ch ? { ...ch, state: e.state, charCount: e.charCount } : ch,
        );
      }
    });
    const offPrefs = on('prefs.changed', e => {
      if (e.key !== 'editorFont' && e.key !== 'editorFontSize') {
        return;
      }
      const seq = ++prefSeq;
      Promise.all([prefs.get('editorFont'), prefs.get('editorFontSize')])
        .then(([family, size]) => {
          if (alive.current && seq === prefSeq) {
            setEditorFont(family);
            setEditorSize(size);
          }
        })
        .catch(() => {});
    });
    const appState = AppState.addEventListener('change', state => {
      if (state !== 'active' && navigation.isFocused()) {
        session.current?.flush().catch(() => {});
      }
      if (state === 'active' && backgroundError.current) {
        inBackground(showError(backgroundError.current));
        backgroundError.current = undefined;
      }
    });
    return () => {
      metadataSeq++;
      prefSeq++;
      offChapter();
      offSaved();
      offPrefs();
      appState.remove();
    };
  }, [chapterId, workId, navigation]);

  const flush = async (op?: string) => {
    Keyboard.dismiss();
    try {
      await session.current?.flush();
      return true;
    } catch {
      if (op) {
        toast(t.editor.notSavedFor(op));
      }
      return false;
    }
  };

  usePreventRemove(!!chapter && !allowRemove, ({ data }) => {
    if (leaving.current) {
      return;
    }
    leaving.current = true;
    setBusy(true);
    inBackground(
      (async () => {
        if (await flush()) {
          try {
            await versions.snapshot(chapterId, 'auto');
          } catch (e) {
            console.warn('[editor.snapshot]', e);
          }
          setAllowRemove(true);
          navigation.dispatch(data.action);
        } else {
          const key = await showDialog({
            title: t.editor.unsavedTitle,
            message: t.editor.unsavedBody,
            vertical: true,
            dismissKey: 'stay',
            buttons: [
              { key: 'copy', label: t.editor.copyAll },
              { key: 'discard', label: t.editor.discardLeave },
              { key: 'stay', label: t.editor.stay, style: 'primary' },
            ],
          });
          if (key === 'copy') {
            Clipboard.setString(toDisplay(bodyRef.current));
            toast(t.editor.copiedAll);
          }
          if (key === 'discard') {
            session.current?.dispose();
            setAllowRemove(true);
            navigation.dispatch(data.action);
          }
        }
        leaving.current = false;
        if (alive.current) {
          setBusy(false);
        }
      })(),
    );
  });

  const changeBody = (next: string, s: Selection, record = true) => {
    if (countChars(next) > 100_000) {
      ignoreNativeSelection.current = true;
      toast(t.editor.hardLimit);
      return;
    }
    if (record) {
      history.current.record(bodyRef.current, next, selectionRef.current, s);
    }
    bodyRef.current = next;
    setBody(next);
    select(s);
    refreshHistory(n => n + 1);
    session.current?.edit(next, s.start);
  };
  const undo = (redo: boolean) => {
    nativeText.current = null;
    const next = redo
      ? history.current.redo(bodyRef.current)
      : history.current.undo(bodyRef.current);
    if (next) {
      changeBody(next.body, next.selection, false);
    }
  };
  const state =
    chapter?.kind === 'main' && chapter.state !== 'draft' && finalBody !== null
      ? body === finalBody
        ? 'finalized'
        : 'modified'
      : chapter?.state ?? 'draft';
  const openVersions = async () => {
    if (await flush(t.editor.opVersions)) {
      navigation.navigate('Versions', { chapterId, from: 'editor' });
    }
  };
  const doMenu = async (key: string | null) => {
    if (key === 'info') {
      setForm(true);
    } else if (key === 'font') {
      setFontSheet(true);
    } else if (key === 'versions') {
      await openVersions();
    } else if (key === 'snapshot' && (await flush(t.editor.opSnapshot))) {
      try {
        const before = await versions.list(chapterId);
        const version = await versions.snapshot(chapterId, 'manual');
        const same = before.some(v => v.id === version.id);
        toast(same ? t.editorMore.snapshotSame : t.editorMore.snapshotDone, {
          action: {
            label: t.common.view,
            onPress: () => inBackground(openVersions()),
          },
        });
      } catch (e) {
        await showError(e);
      }
    }
  };
  const ai = async () => {
    const available = await ensureModelService();
    if (available === 'connect') {
      toast(t.common.comingSoon);
    } else if (available === 'ok') {
      toast(editorCopy.aiLater);
    }
  };

  let content: React.ReactNode;
  if (error && !chapter) {
    content = (
      <EmptyState
        title={t.editor.loadFailed}
        action={{
          label: t.common.retry,
          onPress: () => setRetryLoad(n => n + 1),
        }}
        secondary={{
          label: t.common.viewDetail,
          onPress: () => showErrorDetail(error, t.editor.loadFailed),
        }}
        style={styles.fill}
      />
    );
  } else if (!chapter) {
    content = <DelayedSpinner delay={150} />;
  } else {
    const selectedChars = countChars(
      body.slice(selection.start, selection.end),
    );
    content = (
      <>
        <View style={styles.statusRow}>
          {chapter.kind === 'main' ? (
            <Txt variant="caption" color={c.ink2}>
              {chapterPrefix(chapter)}
            </Txt>
          ) : null}
          <ChapterBadge kind={chapter.kind} state={state} />
          <Txt variant="caption" color={c.ink2} numeric>
            {editorCopy.characters(chars)}
          </Txt>
          <Pressable
            accessibilityRole={status === 'failed' ? 'button' : 'text'}
            onPress={
              status === 'failed' ? () => inBackground(flush()) : undefined
            }
            style={styles.saveStatus}
          >
            <Txt
              variant="caption"
              color={status === 'failed' ? c.conf : c.ink3}
            >
              {status === 'saved'
                ? t.editor.saved
                : status === 'saving'
                ? t.editor.saving
                : t.editor.saveFailed}
            </Txt>
          </Pressable>
        </View>
        {conflictList.data?.length ? (
          <Pressable
            onPress={() =>
              inBackground(
                flush().then(ok => {
                  if (ok) {
                    toast(editorCopy.conflictLater);
                  }
                }),
              )
            }
            style={[styles.notice, styles.conflictNotice]}
          >
            <Txt variant="callout" color={c.conf}>
              {t.editor.conflictBar(conflictList.data.length)}
            </Txt>
          </Pressable>
        ) : null}
        {chars > 50_000 || (chars > 20_000 && !longDismissed) ? (
          <View
            style={[
              styles.notice,
              chars > 50_000 ? styles.conflictNotice : styles.longNotice,
            ]}
          >
            <Txt
              variant="callout"
              color={chars > 50_000 ? c.conf : c.pend}
              style={styles.fill}
            >
              {chars > 50_000 ? t.editor.tooLongBar : t.editor.longBar}
            </Txt>
            {chars <= 50_000 ? (
              <Button
                label={t.common.gotIt}
                size="small"
                variant="quiet"
                onPress={() => setLongDismissed(true)}
              />
            ) : null}
          </View>
        ) : null}
        <View style={styles.fill}>
          <TextInput
            ref={input}
            testID="editor-body"
            accessibilityLabel={editorCopy.body}
            autoFocus
            multiline
            scrollEnabled
            editable={!busy}
            value={toDisplay(body)}
            selection={{
              start: toDisplayOffset(body, selection.start),
              end: toDisplayOffset(body, selection.end),
            }}
            onChangeText={raw => {
              nativeText.current = raw;
              const next = displayEdit(
                bodyRef.current,
                selectionRef.current,
                raw,
              );
              // Backspace on an indent also removes a newline; the native caret still refers to the old paragraph.
              ignoreNativeSelection.current = next.body !== toBody(raw);
              changeBody(next.body, next.selection);
            }}
            onSelectionChange={e => {
              if (ignoreNativeSelection.current) {
                ignoreNativeSelection.current = false;
                nativeText.current = null;
                return;
              }
              const raw = nativeText.current ?? toDisplay(bodyRef.current);
              nativeText.current = null;
              const s = e.nativeEvent.selection;
              const nextSelection = {
                start: Math.min(
                  bodyRef.current.length,
                  toBodyOffset(raw, s.start),
                ),
                end: Math.min(bodyRef.current.length, toBodyOffset(raw, s.end)),
              };
              if (
                nextSelection.start !== selectionRef.current.start ||
                nextSelection.end !== selectionRef.current.end
              ) {
                history.current.breakGroup();
              }
              select(nextSelection);
            }}
            placeholder={t.editor.placeholder}
            placeholderTextColor={c.ink3}
            selectionColor={c.brandSelect}
            maxFontSizeMultiplier={maxFontSizeMultiplier}
            textAlignVertical="top"
            style={[
              styles.body,
              {
                fontFamily: editorFont === 'serif' ? fonts.serif : fonts.sans,
                fontSize: editorSize,
                lineHeight: editorSize * 1.9,
              },
            ]}
          />
          {body === '' ? (
            <View
              pointerEvents="none"
              style={styles.placeholder}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Txt
                testID="editor-placeholder"
                color={c.ink3}
                style={{
                  fontFamily: editorFont === 'serif' ? fonts.serif : fonts.sans,
                  fontSize: editorSize,
                  lineHeight: editorSize * 1.9,
                }}
              >
                {'　　'}
                {t.editor.placeholder}
              </Txt>
            </View>
          ) : null}
        </View>
        {selectedChars > 0 ? (
          <View style={styles.selectionBar}>
            <Txt variant="caption" color={c.white}>
              {selectedChars > 2000
                ? t.editor.selectedTooMany(String(selectedChars))
                : t.editor.selected(String(selectedChars))}
            </Txt>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.selectionOps}
              keyboardShouldPersistTaps="handled"
            >
              {Object.values(t.editor.ops).map(label => (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: selectedChars > 2000 || busy,
                  }}
                  onPress={
                    selectedChars > 2000 || busy
                      ? undefined
                      : () => inBackground(ai())
                  }
                  style={[
                    styles.selectionOp,
                    selectedChars > 2000 && styles.disabled,
                  ]}
                >
                  <Txt variant="callout" color={c.white}>
                    {label}
                  </Txt>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : (
          <View style={styles.toolbar}>
            <IconButton
              label={t.editor.undo}
              disabled={!history.current.canUndo || busy}
              onPress={() => undo(false)}
            >
              <Undo2 size={23} color={c.ink2} />
            </IconButton>
            <IconButton
              label={t.editor.redo}
              disabled={!history.current.canRedo || busy}
              onPress={() => undo(true)}
            >
              <Redo2 size={23} color={c.ink2} />
            </IconButton>
            <Button
              label={t.editor.describe}
              variant="quiet"
              disabled={busy}
              onPress={() => inBackground(ai())}
              style={styles.tool}
            />
            <Button
              label={t.editor.archive}
              variant="quiet"
              disabled={busy}
              onPress={() => {
                Keyboard.dismiss();
                toast(editorCopy.archiveLater);
              }}
              style={styles.tool}
            />
            {chapter.kind === 'main' ? (
              <Button
                label={
                  state === 'finalized' ? t.editor.finalized : t.editor.finalize
                }
                variant="text"
                strong
                disabled={busy || state === 'finalized'}
                onPress={() => {
                  if (!countChars(bodyRef.current)) {
                    toast(t.editor.emptyFinalize);
                    return;
                  }
                  setBusy(true);
                  inBackground(
                    (async () => {
                      try {
                        if (await flush(t.editor.opFinalize)) {
                          await finalizeWithConfirm({
                            ...chapter,
                            state,
                            charCount: countChars(bodyRef.current),
                          });
                        }
                      } finally {
                        if (alive.current) {
                          setBusy(false);
                        }
                      }
                    })(),
                  );
                }}
                style={styles.tool}
              />
            ) : null}
          </View>
        )}
      </>
    );
  }
  return (
    <View style={styles.root}>
      <NavBar
        title={chapter?.title}
        onBack={() => navigation.goBack()}
        right={
          <IconButton
            label={t.editor.more}
            disabled={!chapter || busy}
            onPress={() => {
              Keyboard.dismiss();
              inBackground(flush());
              setMenu(true);
            }}
          >
            <Ellipsis size={24} color={c.ink} />
          </IconButton>
        }
      />
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={0}
        style={styles.content}
        testID="editor-keyboard-layout"
      >
        {/* KAV writes its own paddingBottom for keyboard height, so keep safe-area padding on a child. */}
        <View
          testID="editor-safe-content"
          style={[
            styles.fill,
            !keyboardVisible && { paddingBottom: insets.bottom },
          ]}
        >
          {content}
        </View>
      </KeyboardAvoidingView>
      {chapter ? (
        <>
          <ActionSheet
            visible={menu}
            onRequestClose={() => setMenu(false)}
            onDone={key => inBackground(doMenu(key))}
            title={t.editorMore.header(
              chapterHeading({
                ...chapter,
                title: truncate(chapter.title, 12),
              }),
              countChars(body),
              chapter.kind === 'main'
                ? STATE_LABEL[state]
                : chapterPrefix(chapter),
            )}
            items={[
              { key: 'info', label: t.editorMore.info },
              { key: 'versions', label: t.editorMore.versions },
              {
                key: 'snapshot',
                label: t.editorMore.snapshot,
                disabled: countChars(body) === 0,
              },
              { key: 'font', label: t.editorMore.font },
            ]}
          />
          <ChapterFormSheet
            visible={form}
            workId={workId}
            chapterId={chapterId}
            mode="edit"
            onRequestClose={() => setForm(false)}
            onSaved={() => setForm(false)}
            onGone={() => {
              setForm(false);
              goBackAfterBypass.current = true;
              setAllowRemove(true);
            }}
          />
          <FontSheet
            visible={fontSheet}
            onClose={() => setFontSheet(false)}
            font={editorFont}
            size={editorSize}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.surface },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  fill: { flex: 1 },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingHorizontal: 24,
    minHeight: 44,
    flexWrap: 'wrap',
  },
  saveStatus: { marginLeft: 'auto', minHeight: 44, justifyContent: 'center' },
  placeholder: { position: 'absolute', left: 24, right: 24, top: 16 },
  body: {
    flex: 1,
    color: c.ink,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    paddingHorizontal: 4,
    minHeight: 52,
  },
  tool: { flex: 1, paddingHorizontal: 2 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 4,
  },
  conflictNotice: { backgroundColor: c.confTint },
  longNotice: { backgroundColor: c.pendTint },
  selectionBar: {
    backgroundColor: c.ink,
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  selectionOps: { gap: 12 },
  selectionOp: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  disabled: { opacity: 0.5 },
});
