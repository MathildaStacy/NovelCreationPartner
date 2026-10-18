import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { color as c, hitSize, pageMargin } from '../theme/tokens';
import { Txt } from './Text';

export interface NavBarProps {
  title?: string;
  /** Small line under the title (editor save state). */
  subtitle?: React.ReactNode;
  /** "‹ 书架": label next to the back chevron. Omit for a bare chevron. */
  backLabel?: string;
  onBack?: () => void;
  left?: React.ReactNode;
  right?: React.ReactNode;
  /** Large-title variant for root pages (书架). */
  large?: boolean;
  background?: string;
  /** Draw no bottom hairline. */
  flat?: boolean;
}

/**
 * Standard nav bar (UI §4.8): 44 high below the status bar; large title for the
 * shelf. Screens draw their own bar (native headers are hidden) so Android and
 * iOS look the same; the system back gesture / key still goes through the stack.
 */
export function NavBar({ title, subtitle, backLabel, onBack, left, right, large, background, flat }: NavBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.wrap,
        { paddingTop: insets.top, backgroundColor: background ?? c.paper },
        !flat && !large && styles.hairline,
      ]}
    >
      <View style={styles.bar}>
        <View style={styles.side}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={backLabel ? `返回${backLabel}` : '返回'}
              hitSlop={6}
              style={({ pressed }) => [styles.back, pressed && styles.pressed]}
            >
              <ChevronLeft size={26} color={c.brand} strokeWidth={1.75} />
              {backLabel ? (
                <Txt variant="body" color={c.brand} numberOfLines={1}>
                  {backLabel}
                </Txt>
              ) : null}
            </Pressable>
          ) : (
            left
          )}
        </View>
        <View style={styles.center} pointerEvents="none">
          {!large && title ? (
            <Txt variant="headline" numberOfLines={1} accessibilityRole="header">
              {title}
            </Txt>
          ) : null}
          {!large && subtitle ? subtitle : null}
        </View>
        <View style={[styles.side, styles.right]}>{right}</View>
      </View>
      {large && title ? (
        <Txt variant="title1" style={styles.largeTitle} accessibilityRole="header">
          {title}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {},
  hairline: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
  bar: { height: hitSize, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  side: { minWidth: 88, flexDirection: 'row', alignItems: 'center', zIndex: 1 },
  right: { justifyContent: 'flex-end' },
  center: { position: 'absolute', left: 96, right: 96, alignItems: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', minHeight: hitSize, paddingRight: 8 },
  pressed: { opacity: 0.5 },
  largeTitle: { paddingHorizontal: pageMargin, paddingBottom: 8, paddingTop: 4 },
});
