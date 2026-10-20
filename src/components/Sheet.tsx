import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color as c, motion, radius, shadow } from '../theme/tokens';
import { OverlayHost, dismissTopDialog } from './overlay/OverlayHost';
import { popSheet, pushSheet, useOverlay } from './overlay/store';
import { Txt } from './Text';

export interface SheetProps {
  visible: boolean;
  /** The user asked to close (scrim, swipe down, Android back). Guard unsaved input here (D04). */
  onRequestClose: () => void;
  /** Called after the hide animation; open the next sheet from here so two never overlap (S03a #5). */
  onClosed?: () => void;
  /** Native modal is visible and its entering animation finished; safe to focus inputs. */
  onShown?: () => void;
  title?: string;
  /** Small grey title (action sheets). */
  subtitle?: string;
  /** What screen readers announce for the header line, e.g. "星海之境，作品操作" (S03a). */
  headerAccessibilityLabel?: string;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  /** Disable scrim / swipe / back while submitting. */
  locked?: boolean;
  /** Max share of the window height (UI §4.9: 90%). */
  maxHeightRatio?: number;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Bottom sheet (UI §4.9, G01 §5): top corners 20, 4×36 grabber, title2 title,
 * height by content up to 90% of the screen; scrim tap or swipe down closes.
 * Animates 280 ms in / 220 ms out, fades instead when Reduce Motion is on.
 */
export function Sheet({
  visible,
  onRequestClose,
  onClosed,
  onShown,
  title,
  subtitle,
  headerAccessibilityLabel,
  headerLeft,
  headerRight,
  children,
  locked,
  maxHeightRatio = 0.9,
  contentStyle,
  testID,
}: SheetProps) {
  const [mounted, setMounted] = useState(visible);
  const [level, setLevel] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const shownRef = useRef(onShown);
  shownRef.current = onShown;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const animationGeneration = useRef(0);
  const nativePresented = useRef(false);
  const entryGeneration = useRef<number | null>(null);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  const requestRef = useRef(onRequestClose);
  requestRef.current = onRequestClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const startEntry = (generation: number) => {
    if (entryGeneration.current === generation || !visibleRef.current) {
      return;
    }
    entryGeneration.current = generation;
    Animated.timing(progress, {
      toValue: 1,
      duration: motion.sheetIn,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (
        finished &&
        visibleRef.current &&
        generation === animationGeneration.current
      ) {
        shownRef.current?.();
      }
    });
  };

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(setReduceMotion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const generation = animationGeneration.current;
    if (visible) {
      setMounted(true);
      drag.setValue(0);
      if (nativePresented.current) {
        // Reopening before the exit completes reuses the still-present native
        // Modal, so it will not emit another onShow event.
        startEntry(generation);
      } else {
        progress.setValue(0);
      }
      // Modal.onShow starts entry only after the native dialog exists. Android
      // clears FLAG_NOT_FOCUSABLE just after that event, so focusing from the
      // event itself can select text while its one-shot IME request is refused.
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: motion.sheetOut,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (
          finished &&
          !visibleRef.current &&
          generation === animationGeneration.current
        ) {
          nativePresented.current = false;
          setMounted(false);
          closedRef.current?.();
        }
      });
    }
    return () => {
      animationGeneration.current = generation + 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    setLevel(pushSheet());
    return () => popSheet();
  }, [mounted]);

  const nativeShown = () => {
    nativePresented.current = true;
    startEntry(animationGeneration.current);
  };

  const requestClose = () => {
    // A dialog inside the sheet takes the back press first.
    if (
      useOverlay.getState().depth === level &&
      useOverlay.getState().dialogs.length
    ) {
      dismissTopDialog();
      return;
    }
    if (!lockedRef.current) {
      requestRef.current();
    }
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        !lockedRef.current && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 90 || g.vy > 1.2) {
          Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
          requestRef.current();
        } else {
          Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () =>
        Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start(),
    }),
  ).current;

  if (!mounted) {
    return null;
  }

  const translateY = reduceMotion
    ? drag
    : Animated.add(
        progress.interpolate({
          inputRange: [0, 1],
          outputRange: [height * 0.6, 0],
        }),
        drag,
      );

  return (
    <Modal
      transparent
      visible
      animationType="none"
      onShow={nativeShown}
      onRequestClose={requestClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.root} testID={testID}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={requestClose}
            accessibilityRole="button"
            accessibilityLabel="关闭"
          />
        </Animated.View>
        {/* Android runs edge-to-edge (gradle.properties), so the window is not resized for the keyboard: pad on both platforms. */}
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.kav}
          pointerEvents="box-none"
        >
          <Animated.View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                maxHeight: height * maxHeightRatio,
                paddingBottom: Math.max(insets.bottom, 12),
              },
              reduceMotion ? { opacity: progress } : null,
              { transform: [{ translateY }] },
            ]}
          >
            <View {...pan.panHandlers}>
              <View style={styles.grabber} />
              {title || subtitle || headerLeft || headerRight ? (
                <View style={styles.header}>
                  <View style={styles.side}>{headerLeft}</View>
                  <View style={styles.titleBox}>
                    {title ? (
                      <Txt
                        variant="title2"
                        numberOfLines={1}
                        accessibilityRole="header"
                        accessibilityLabel={headerAccessibilityLabel}
                      >
                        {title}
                      </Txt>
                    ) : null}
                    {subtitle ? (
                      <Txt
                        variant="callout"
                        color={c.ink3}
                        numberOfLines={1}
                        align="center"
                        accessibilityRole="header"
                        accessibilityLabel={title ? undefined : headerAccessibilityLabel}
                      >
                        {subtitle}
                      </Txt>
                    ) : null}
                  </View>
                  <View style={[styles.side, styles.right]}>{headerRight}</View>
                </View>
              ) : null}
            </View>
            <View style={[styles.content, contentStyle]}>{children}</View>
          </Animated.View>
        </KeyboardAvoidingView>
        <OverlayHost level={level} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrim: { backgroundColor: c.scrim },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    ...shadow,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.line,
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  side: { minWidth: 64, flexDirection: 'row', alignItems: 'center' },
  right: { justifyContent: 'flex-end' },
  titleBox: { flex: 1, alignItems: 'center' },
  content: { flexShrink: 1 },
});
