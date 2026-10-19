import React from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import { color as c, radius } from '../theme/tokens';

/** Static grey placeholder bars (G01 §3 加载骨架). Static on purpose: no animation to respect reduce-motion. */
export function SkeletonLines({ lines = 3, widths = ['100%', '92%', '64%'] }: { lines?: number; widths?: DimensionValue[] }) {
  return <View style={styles.lines} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {Array.from({ length: lines }, (_, i) => <View key={i} style={[styles.bar, { width: widths[i % widths.length] }]} />)}
  </View>;
}

/** Card-shaped placeholders while a list loads. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return <View style={styles.cards} testID="skeleton-cards" accessibilityLabel="正在加载">
    {Array.from({ length: count }, (_, i) => <View key={i} style={styles.card}><SkeletonLines /></View>)}
  </View>;
}

const styles = StyleSheet.create({
  lines: { gap: 10 },
  bar: { height: 12, borderRadius: radius.small, backgroundColor: c.sunken },
  cards: { gap: 12 },
  card: { backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: radius.card, padding: 16 },
});
