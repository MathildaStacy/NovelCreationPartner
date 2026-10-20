import React, { useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { color as c, rowMinHeight } from '../theme/tokens';
import { Sheet } from './Sheet';
import { Txt } from './Text';

export interface ActionItem {
  key: string;
  label: string;
  /** Greyed and not pressable (e.g. the current volume in "移到哪一卷"). */
  disabled?: boolean;
  /** Pressing a greyed item explains why instead (S07a 存为版本 / 导出本章 on an empty chapter); the sheet stays open. */
  onDisabledPress?: () => void;
  checked?: boolean;
  /** Red text for a destructive item where the page design asks for it (S15a 删除). */
  destructive?: boolean;
  /** Screen reader label when it differs, e.g. "删除作品，移到回收站". */
  accessibilityLabel?: string;
}

export interface ActionSheetProps {
  visible: boolean;
  title?: string;
  /** Screen reader text for the title line (S03a "{书名}，作品操作"). */
  titleAccessibilityLabel?: string;
  items: ActionItem[];
  /** Called with the chosen key after the sheet has fully closed, or null for cancel. */
  onDone: (key: string | null) => void;
  /** Ask the parent to close (sets visible = false). */
  onRequestClose: () => void;
}

/**
 * Action sheet (G01 §5): items in a fixed order, destructive items in the default
 * colour (S03a #8), a separate 取消 group on iOS only. The choice is delivered
 * after the close animation so a follow-up sheet or dialog never overlaps.
 */
export function ActionSheet({ visible, title, titleAccessibilityLabel, items, onDone, onRequestClose }: ActionSheetProps) {
  const chosen = useRef<string | null>(null);
  const pick = (key: string | null) => {
    chosen.current = key;
    onRequestClose();
  };
  return (
    <Sheet
      visible={visible}
      onRequestClose={() => pick(null)}
      onClosed={() => {
        const k = chosen.current;
        chosen.current = null;
        onDone(k);
      }}
      subtitle={title}
      headerAccessibilityLabel={titleAccessibilityLabel}
    >
      <ScrollView bounces={false}>
        {items.map((it, i) => (
          <Pressable
            key={it.key}
            onPress={it.disabled ? it.onDisabledPress : () => pick(it.key)}
            accessibilityRole="button"
            accessibilityLabel={it.accessibilityLabel ?? it.label}
            accessibilityState={{ disabled: !!it.disabled, selected: !!it.checked }}
            style={({ pressed }) => [styles.item, i > 0 && styles.sep, pressed && !it.disabled && styles.pressed]}
          >
            <Txt variant="body" color={it.disabled ? c.ink3 : it.destructive ? c.conf : c.ink} style={styles.label} numberOfLines={1}>
              {it.label}
            </Txt>
            {it.checked ? <Check size={20} color={c.brand} /> : null}
          </Pressable>
        ))}
      </ScrollView>
      {Platform.OS === 'ios' ? (
        <View style={styles.cancelGroup}>
          <Pressable
            onPress={() => pick(null)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.item, styles.cancel, pressed && styles.pressed]}
          >
            <Txt variant="body" color={c.ink2} weight="600" align="center" style={styles.label}>
              取消
            </Txt>
          </Pressable>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  item: {
    minHeight: rowMinHeight,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  pressed: { backgroundColor: c.sunken },
  label: { flex: 1 },
  cancelGroup: { marginTop: 8, borderTopWidth: 8, borderTopColor: c.paper },
  cancel: { justifyContent: 'center' },
});
