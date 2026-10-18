import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { hitSize } from '../theme/tokens';

export interface IconButtonProps {
  /** Required: icon-only buttons must have a screen reader label (UI §3.4). */
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** 44×44 touch target around a 24 pt icon. */
export function IconButton({ label, onPress, disabled, children, style, testID }: IconButtonProps) {
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.btn, pressed && !disabled && styles.pressed, disabled && styles.disabled, style]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: hitSize, height: hitSize, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  disabled: { opacity: 0.35 },
});
