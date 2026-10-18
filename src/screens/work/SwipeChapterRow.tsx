import React, { useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Button } from '../../components/Button';
import { t } from '../../locales/zh-CN';
import { color as c } from '../../theme/tokens';

/** Horizontal-only responder: vertical movement stays with the SectionList. */
export function SwipeChapterRow({
  children,
  onMore,
  onRemove,
}: {
  children: React.ReactNode;
  onMore: () => void;
  onRemove: () => void;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const origin = useRef(0);
  const [open, setOpen] = useState(false);
  const callbacks = useRef({ onMore, onRemove });
  callbacks.current = { onMore, onRemove };
  const settle = (next: number) => {
    origin.current = next;
    setOpen(next < 0);
    Animated.spring(x, {
      toValue: next,
      useNativeDriver: true,
      bounciness: 0,
    }).start();
  };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) =>
        x.setValue(Math.min(0, Math.max(-144, origin.current + g.dx))),
      onPanResponderRelease: (_e, g) =>
        settle(origin.current + g.dx < -60 ? -144 : 0),
      onPanResponderTerminate: () => settle(origin.current),
    }),
  ).current;
  return (
    <View style={styles.wrap}>
      {open ? (
        <View style={styles.actions}>
          <Button
            label={t.chapters.swipeMore}
            variant="quiet"
            onPress={() => {
              settle(0);
              callbacks.current.onMore();
            }}
            style={styles.action}
          />
          <Button
            label={t.chapters.swipeDelete}
            variant="quiet"
            onPress={() => {
              settle(0);
              callbacks.current.onRemove();
            }}
            style={styles.action}
          />
        </View>
      ) : null}
      <Animated.View
        {...pan.panHandlers}
        style={{ transform: [{ translateX: x }] }}
      >
        {children}
        {open ? (
          <Pressable
            accessibilityLabel={t.common.close}
            accessibilityRole="button"
            onPress={() => settle(0)}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}
const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: c.sunken },
  actions: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 144,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  action: { width: 72, borderRadius: 0, backgroundColor: c.sunken },
});
