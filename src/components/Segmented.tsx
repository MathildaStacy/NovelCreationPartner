import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { color as c, radius } from '../theme/tokens';
import { Txt } from './Text';

export interface Segment<K extends string> {
  key: K;
  label: string;
  /** Greyed; pressing calls onDisabledPress instead (S06a 已定稿章节). */
  disabled?: boolean;
}

/** Segmented control on a sunken track (UI §3.1 sunken). */
export function Segmented<K extends string>({
  segments,
  value,
  onChange,
  onDisabledPress,
  locked,
}: {
  segments: Segment<K>[];
  value: K;
  onChange: (k: K) => void;
  onDisabledPress?: (k: K) => void;
  locked?: boolean;
}) {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {segments.map(s => {
        const on = s.key === value;
        return (
          <Pressable
            key={s.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on, disabled: !!s.disabled || locked }}
            onPress={locked ? undefined : () => (s.disabled ? onDisabledPress?.(s.key) : onChange(s.key))}
            style={[styles.seg, on && styles.on]}
          >
            <Txt
              variant="callout"
              color={s.disabled ? c.ink3 : on ? c.ink : c.ink2}
              weight={on ? '600' : undefined}
              numberOfLines={1}
              style={s.disabled ? styles.disabled : null}
            >
              {s.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', backgroundColor: c.sunken, borderRadius: radius.small + 2, padding: 2 },
  seg: { flex: 1, minHeight: 36, borderRadius: radius.small, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  on: { backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
  disabled: { opacity: 0.6 },
});
