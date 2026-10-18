import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { color as c, hitSize, radius } from '../theme/tokens';
import { Txt } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'quiet';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'large' | 'small';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  /** Bold label (e.g. dialog confirm, 定稿本章). */
  strong?: boolean;
}

/**
 * Buttons (UI §4.1): primary = brand fill, 48 high, radius 12; secondary = white
 * with brand border; text = brand text; quiet = ink2 text. Small = 32 high, radius 8.
 * Disabled buttons are 45% opaque (S04).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'large',
  disabled,
  loading,
  icon,
  style,
  accessibilityLabel,
  accessibilityHint,
  testID,
  strong,
}: ButtonProps) {
  const inactive = disabled || loading;
  const fg = variant === 'primary' ? c.white : variant === 'quiet' ? c.ink2 : c.brand;
  const small = size === 'small';
  return (
    <Pressable
      testID={testID}
      onPress={inactive ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      hitSlop={small || variant === 'text' || variant === 'quiet' ? 6 : undefined}
      style={({ pressed }) => [
        styles.base,
        small ? styles.small : styles.large,
        variant === 'primary' && { backgroundColor: pressed && !inactive ? c.brandPress : c.brand },
        variant === 'secondary' && [styles.secondary, pressed && !inactive && { backgroundColor: c.brandTint }],
        (variant === 'text' || variant === 'quiet') && [styles.textual, pressed && !inactive && { opacity: 0.6 }],
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Txt
            variant={small ? 'callout' : 'body'}
            color={fg}
            weight={strong || variant === 'primary' ? '600' : undefined}
            numberOfLines={1}
          >
            {label}
          </Txt>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  large: { minHeight: 48, borderRadius: radius.card, paddingHorizontal: 20 },
  small: { minHeight: 32, borderRadius: radius.small, paddingHorizontal: 12 },
  secondary: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.brand },
  textual: { backgroundColor: 'transparent', minHeight: hitSize, paddingHorizontal: 8 },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
