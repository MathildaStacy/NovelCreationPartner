import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { t } from '../locales/zh-CN';
import { color as c, motion } from '../theme/tokens';
import { Txt } from './Text';

/**
 * Row swipe actions (S06 / S10b / S15d). Built on PanResponder so it needs no
 * extra native gesture library. Only horizontal drags are claimed; vertical
 * movement stays with the surrounding list or sheet.
 */
export interface SwipeAction {
  key: string;
  label: string;
  /** neutral = grey (S10b 重命名, S06 更多); danger = error colour (删除 / 彻底删除). */
  tone?: 'neutral' | 'danger';
  accessibilityLabel?: string;
  onPress: () => void;
}

export const SWIPE_ACTION_WIDTH = 72;

/** A drag becomes a row swipe only when clearly horizontal (G01: no fight with list scroll). */
export function shouldCaptureSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5;
}

/** Where a released drag settles: fully open (-width) or closed (0). */
export function swipeTarget(origin: number, dx: number, vx: number, width: number): number {
  const position = origin + dx;
  if (vx < -0.5) {
    return -width;
  }
  if (vx > 0.5) {
    return 0;
  }
  return position < -width / 2 ? -width : 0;
}

/**
 * One group per list: at most one row is open; scrolling or tapping any row
 * closes it (S10b rule 1).
 */
export interface SwipeGroup {
  openKey: string | null;
  open: (key: string) => void;
  close: () => void;
}

export function useSwipeGroup(): SwipeGroup {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = useCallback((key: string) => setOpenKey(key), []);
  const close = useCallback(() => setOpenKey(null), []);
  return useMemo(() => ({ openKey, open, close }), [openKey, open, close]);
}

/**
 * The same actions for screen readers, so nothing depends on the gesture.
 * Spread onto the row's main Pressable.
 */
export function swipeAccessibility(actions: SwipeAction[]): {
  accessibilityActions: AccessibilityActionInfo[];
  onAccessibilityAction: (event: AccessibilityActionEvent) => void;
} {
  return {
    accessibilityActions: actions.map(a => ({ name: a.key, label: a.accessibilityLabel ?? a.label })),
    onAccessibilityAction: event => actions.find(a => a.key === event.nativeEvent.actionName)?.onPress(),
  };
}

let reduceMotion = false;
let reduceMotionWatched = false;
function watchReduceMotion() {
  if (reduceMotionWatched) {
    return;
  }
  reduceMotionWatched = true;
  AccessibilityInfo.isReduceMotionEnabled?.()
    .then(value => {
      reduceMotion = value;
    })
    .catch(() => {});
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', value => {
    reduceMotion = value;
  });
}

export function SwipeRow({
  rowKey,
  group,
  actions,
  disabled,
  style,
  children,
}: {
  rowKey: string;
  group: SwipeGroup;
  actions: SwipeAction[];
  disabled?: boolean;
  /** Wrapper style, e.g. card radius and spacing so the revealed area matches the row. */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const width = actions.length * SWIPE_ACTION_WIDTH;
  const isOpen = group.openKey === rowKey;
  const anyOpen = group.openKey !== null;
  const x = useRef(new Animated.Value(0)).current;
  const target = useRef(0);
  const [revealed, setRevealed] = useState(false);
  const live = useRef({ group, rowKey, width, disabled, isOpen });
  live.current = { group, rowKey, width, disabled, isOpen };

  useEffect(watchReduceMotion, []);

  const animateTo = useCallback(
    (next: number) => {
      target.current = next;
      if (next < 0) {
        setRevealed(true);
      }
      const done = () => {
        if (target.current === 0) {
          setRevealed(false);
        }
      };
      if (reduceMotion) {
        x.setValue(next);
        done();
        return;
      }
      Animated.timing(x, {
        toValue: next,
        duration: motion.settle,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          done();
        }
      });
    },
    [x],
  );

  // Opened by long press / closed by another row, scroll or an action.
  useEffect(() => {
    const next = isOpen ? -width : 0;
    if (next !== target.current) {
      animateTo(next);
    }
  }, [isOpen, width, animateTo]);

  // A virtualized row that unmounts while open must not leave the group stuck open.
  useEffect(
    () => () => {
      if (live.current.isOpen) {
        live.current.group.close();
      }
    },
    [],
  );

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        !live.current.disabled && live.current.width > 0 && shouldCaptureSwipe(g.dx, g.dy),
      onPanResponderGrant: () => setRevealed(true),
      onPanResponderMove: (_e, g) =>
        x.setValue(Math.min(0, Math.max(-live.current.width, target.current + g.dx))),
      onPanResponderRelease: (_e, g) => {
        const { group: current, rowKey: key, width: w } = live.current;
        const next = swipeTarget(target.current, g.dx, g.vx, w);
        animateTo(next);
        if (next < 0) {
          current.open(key);
        } else if (current.openKey === key) {
          current.close();
        }
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => animateTo(target.current),
    }),
  ).current;

  return (
    <View style={[styles.wrap, style]}>
      {revealed ? (
        // While sliding shut the buttons stay painted under the row but are inert
        // and hidden from screen readers; they unmount when the slide finishes.
        <View
          style={[styles.actions, { width }]}
          pointerEvents={isOpen ? 'auto' : 'none'}
          accessibilityElementsHidden={!isOpen}
          importantForAccessibility={isOpen ? 'auto' : 'no-hide-descendants'}
        >
          {actions.map(action => (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel ?? action.label}
              accessibilityState={{ disabled: !isOpen }}
              onPress={
                isOpen
                  ? () => {
                      group.close();
                      action.onPress();
                    }
                  : undefined
              }
              style={({ pressed }) => [
                styles.action,
                action.tone === 'danger' ? styles.danger : styles.neutral,
                pressed && styles.pressed,
              ]}
            >
              <Txt variant="callout" weight="600" color={action.tone === 'danger' ? c.white : c.ink}>
                {action.label}
              </Txt>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: x }] }}>
        {children}
        {anyOpen ? (
          <Pressable
            accessibilityLabel={t.common.collapseActions}
            accessibilityRole="button"
            onPress={group.close}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  actions: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  action: { width: SWIPE_ACTION_WIDTH, alignItems: 'center', justifyContent: 'center' },
  neutral: { backgroundColor: c.sunken },
  danger: { backgroundColor: c.conf },
  pressed: { opacity: 0.7 },
});
