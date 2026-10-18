import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { color as c } from '../theme/tokens';
import { Button } from './Button';
import { Txt } from './Text';

export interface EmptyStateProps {
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' };
  secondary?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
}

/**
 * Empty / error state (UI §4.11, G01 §3): says what to do next, one primary
 * button, no illustration.
 */
export function EmptyState({ title, message, action, secondary, style }: EmptyStateProps) {
  return (
    <View style={[styles.wrap, style]}>
      <Txt variant="body" weight="600" align="center">
        {title}
      </Txt>
      {message ? (
        <Txt variant="callout" color={c.ink2} align="center">
          {message}
        </Txt>
      ) : null}
      {action ? (
        <Button label={action.label} onPress={action.onPress} variant={action.variant ?? 'primary'} style={styles.btn} />
      ) : null}
      {secondary ? <Button label={secondary.label} onPress={secondary.onPress} variant="text" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 32, gap: 8 },
  btn: { marginTop: 12, minWidth: 160 },
});
