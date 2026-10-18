import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { color as c, radius } from '../theme/tokens';
import { Txt } from './Text';

/** Filter / single-choice pill (S03 筛选标签, S04 题材): selected = brand border on brand tint. */
export function Chip({
  label,
  selected,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.on : styles.off,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Txt variant="callout" color={selected ? c.brand : c.ink2} weight={selected ? '600' : undefined} numeric>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { height: 32, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: 'center', borderWidth: 1 },
  on: { backgroundColor: c.brandTint, borderColor: c.brand },
  off: { backgroundColor: c.surface, borderColor: c.line },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
