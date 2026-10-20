import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { color as c, radius } from '../theme/tokens';
import { Txt } from './Text';

/** Full-page blocking mask with a spinner and one line (S15c 恢复中, S15d 清空中). Not cancellable. */
export function BusyOverlay({ label }: { label: string }) {
  return <View style={styles.scrim} accessibilityViewIsModal testID="busy-overlay">
    <View style={styles.card}><ActivityIndicator color={c.brand} /><Txt accessibilityRole="alert">{label}</Txt></View>
  </View>;
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(29,26,43,0.35)', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: c.surface, borderRadius: radius.card, paddingHorizontal: 24, paddingVertical: 20, alignItems: 'center', gap: 12 },
});
