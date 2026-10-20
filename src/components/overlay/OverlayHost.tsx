import React, { useContext, useEffect, useRef, useState } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { color as c, radius, shadow } from '../../theme/tokens';
import { Txt } from '../Text';
import { closeDialog, hideToast, useOverlay, type PendingDialog } from './store';

/**
 * Renders the toast and the topmost dialog when `level` is the current overlay
 * depth (0 = app root, n = inside the n-th open sheet). Plain absolutely
 * positioned views, no nested RN Modal, so it stacks correctly inside sheets.
 */
export function OverlayHost({ level }: { level: number }) {
  const depth = useOverlay(s => s.depth);
  const toast = useOverlay(s => s.toast);
  const dialog = useOverlay(s => (s.dialogs.length ? s.dialogs[s.dialogs.length - 1] : null));
  if (depth !== level) {
    return null;
  }
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {dialog ? <DialogView key={dialog.id} d={dialog} /> : null}
      {toast ? <ToastView key={toast.id} id={toast.id} /> : null}
    </View>
  );
}

/** Dismisses the topmost dialog as if the scrim was tapped. Returns false when there is none or it cannot be dismissed. */
export function dismissTopDialog(): boolean {
  const s = useOverlay.getState();
  const d = s.dialogs[s.dialogs.length - 1];
  if (!d) {
    return false;
  }
  if (d.dismissKey != null && !busyDialogs.has(d.id)) {
    closeDialog(d.id);
    d.resolve(d.dismissKey);
  }
  return true;
}

const busyDialogs = new Set<number>();

function DialogView({ d }: { d: PendingDialog }) {
  const [busy, setBusy] = useState<string | null>(null);
  const { height } = useWindowDimensions();
  // Context, not the hook: hosts can render outside a SafeAreaProvider in isolated screens.
  const insets = useContext(SafeAreaInsetsContext);

  useEffect(() => {
    // Dialogs have no text inputs. Release the underlying field so its keyboard cannot cover the actions.
    Keyboard.dismiss();
    const sub = BackHandler.addEventListener('hardwareBackPress', () => dismissTopDialog());
    AccessibilityInfo.announceForAccessibility?.(d.title);
    return () => sub.remove();
  }, [d.title]);

  const press = async (key: string) => {
    const b = d.buttons.find(x => x.key === key)!;
    if (!b.run) {
      closeDialog(d.id);
      d.resolve(key);
      return;
    }
    setBusy(key);
    busyDialogs.add(d.id);
    try {
      await b.run();
      closeDialog(d.id);
      d.resolve(key);
    } catch (e) {
      closeDialog(d.id);
      d.reject(e);
    } finally {
      busyDialogs.delete(d.id);
    }
  };

  return (
    <View style={[styles.scrim, d.sheet && styles.sheetScrim]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => dismissTopDialog()}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <View style={[styles.dialog, d.sheet && [styles.sheet, { paddingBottom: (insets?.bottom ?? 0) + 8 }], { maxHeight: height * (d.sheet ? 0.9 : 0.8) }]}
        accessibilityViewIsModal accessibilityRole="alert">
        {d.sheet ? <View style={styles.grabber} /> : null}
        <ScrollView bounces={false} contentContainerStyle={styles.dialogBody}>
          <Txt variant="headline" style={styles.title}>
            {d.title}
          </Txt>
          {d.message ? (
            <Txt variant="body" color={c.ink2}>
              {d.message}
            </Txt>
          ) : null}
          {d.notes?.map((n, i) => (
            <Txt key={i} variant="body" color={c.ink2} style={styles.note}>
              {n}
            </Txt>
          ))}
        </ScrollView>
        <View style={d.sheet ? styles.sheetButtons : d.vertical ? styles.btnCol : styles.btnRow}>
          {d.buttons.map(b => (
            <Pressable
              key={b.key}
              onPress={busy ? undefined : () => press(b.key)}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!busy, busy: busy === b.key }}
              style={({ pressed }) => [d.vertical || d.sheet ? styles.btnV : styles.btnH,
                d.sheet && b.style === 'primary' && styles.filled, pressed && !busy && styles.pressed]}
            >
              {busy === b.key ? (
                <ActivityIndicator size="small" color={d.sheet && b.style === 'primary' ? c.white : c.brand} />
              ) : (
                <Txt
                  variant="body"
                  color={b.style === 'primary' ? d.sheet ? c.white : c.brand : c.ink2}
                  weight={b.style === 'primary' ? '600' : undefined}
                  style={busy ? styles.disabled : null}
                >
                  {b.label}
                </Txt>
              )}
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function ToastView({ id }: { id: number }) {
  const t = useOverlay(s => s.toast);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!t) {
      return;
    }
    AccessibilityInfo.announceForAccessibility?.(t.message);
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    const timer = setTimeout(() => hideToast(id), t.duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!t) {
    return null;
  }
  return (
    <Animated.View style={[styles.toastWrap, { opacity }]} pointerEvents="box-none">
      <View style={styles.toast} accessibilityLiveRegion="polite">
        <Txt variant="callout" color={c.white} style={styles.toastText}>
          {t.message}
        </Txt>
        {t.action ? (
          <Pressable
            onPress={() => {
              hideToast(id);
              t.action!.onPress();
            }}
            accessibilityRole="button"
            hitSlop={10}
          >
            <Txt variant="callout" color={c.brandSelect} weight="600">
              {t.action.label}
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim, alignItems: 'center', justifyContent: 'center' },
  dialog: {
    width: '84%',
    maxWidth: 360,
    backgroundColor: c.surface,
    borderRadius: 14,
    overflow: 'hidden',
    ...shadow,
  },
  dialogBody: { padding: 20, paddingBottom: 8, gap: 8 },
  sheetScrim: { justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 680, borderRadius: 0, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: c.line, marginTop: 8 },
  sheetButtons: { paddingHorizontal: 20, paddingTop: 8, gap: 4 },
  filled: { backgroundColor: c.brand, borderRadius: radius.card },
  title: { marginBottom: 2 },
  note: { marginTop: 4 },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8, paddingBottom: 8, gap: 4 },
  btnCol: { paddingHorizontal: 8, paddingBottom: 8 },
  btnH: { minHeight: 44, minWidth: 64, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  btnV: { minHeight: 48, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  disabled: { opacity: 0.45 },
  toastWrap: { position: 'absolute', left: 20, right: 20, bottom: 90, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: c.ink,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 11,
    maxWidth: 560,
    ...shadow,
  },
  toastText: { flexShrink: 1 },
});
