import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { color as c } from '../theme/tokens';

/** Shows a spinner only after `delay` ms (G01 §3: local reads rarely need one). */
export function DelayedSpinner({ delay = 300 }: { delay?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return <View style={styles.center}>{show ? <ActivityIndicator color={c.ink3} /> : null}</View>;
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return <View accessibilityLabel="正在加载" style={styles.skeleton}>{Array.from({ length: count }, (_, index) => <View key={index} style={styles.card}><View style={styles.line} /><View style={[styles.line, styles.short]} /></View>)}</View>;
}

const styles = StyleSheet.create({
  skeleton: { padding: 16, gap: 16 }, card: { padding: 16, borderRadius: 12, backgroundColor: c.surface, gap: 12 }, line: { height: 14, borderRadius: 4, backgroundColor: c.line }, short: { width: '60%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
