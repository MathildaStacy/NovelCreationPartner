import React, { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { CircleX, TriangleAlert } from 'lucide-react-native';
import { color as c, font, maxFontSizeMultiplier, radius, type } from '../theme/tokens';
import { Txt } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'onChangeText' | 'value' | 'maxLength'> {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  /** Max characters (code points). Longer input, incl. pastes, is cut; onOverflow fires. */
  max?: number;
  onOverflow?: () => void;
  /** Show "n / max": 'always' (top right) or 'near' (bottom right, when < 20% left, G01 §5). */
  counter?: 'always' | 'near' | 'none';
  help?: string;
  error?: string | null;
  /** Serif input for story text (S04 灵感). */
  serif?: boolean;
  /** Multiline: grows up to this many lines, then scrolls. */
  maxLines?: number;
  minLines?: number;
  clearable?: boolean;
  /** Inline trailing control inside the field box (S02 显示 / 从列表选择). */
  accessory?: React.ReactNode;
}

const len = (s: string) => Array.from(s).length;

/**
 * Input (UI §4.2, G01 §4/§5): label above, help below, 48 high, radius 10, 1 px
 * field border, 2 px brand when focused, conf border + message on error.
 */
export const TextField = forwardRef<TextInputInstance, TextFieldProps>(function TextFieldImpl(
  {
    label,
    value,
    onChangeText,
    max,
    onOverflow,
    counter = 'none',
    help,
    error,
    serif,
    multiline,
    maxLines = 6,
    minLines = 1,
    clearable,
    accessory,
    editable = true,
    style,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const n = len(value);
  const t = serif ? type.prose : type.body;
  const lineHeight = t.lineHeight ?? 22;
  const showCounter = max != null && (counter === 'always' || (counter === 'near' && n >= max * 0.8));

  const change = (v: string) => {
    if (max != null && len(v) > max) {
      onChangeText(Array.from(v).slice(0, max).join(''));
      onOverflow?.();
      return;
    }
    onChangeText(v);
  };

  return (
    <View style={styles.wrap}>
      {label || (showCounter && counter === 'always') ? (
        <View style={styles.labelRow}>
          {label ? (
            <Txt variant="callout" color={c.ink2}>
              {label}
            </Txt>
          ) : (
            <View />
          )}
          {showCounter && counter === 'always' ? (
            <Txt variant="caption" color={n > (max ?? 0) ? c.conf : c.ink3} numeric>
              {`${n} / ${max}`}
            </Txt>
          ) : null}
        </View>
      ) : null}
      <View
        // Keep the input's native parent stable when readonly opacity changes
        // during a save. Fabric otherwise reparents the live Android EditText.
        collapsable={false}
        style={[
          styles.box,
          multiline ? { minHeight: Math.max(48, lineHeight * minLines + 24) } : styles.single,
          focused && styles.focused,
          error ? styles.errorBox : null,
          !editable && styles.readonly,
        ]}
      >
        <TextInput
          ref={ref}
          value={value}
          onChangeText={change}
          editable={editable}
          multiline={multiline}
          placeholderTextColor={c.ink3}
          selectionColor={c.brand}
          maxFontSizeMultiplier={maxFontSizeMultiplier}
          textAlignVertical={multiline ? 'top' : 'center'}
          onFocus={e => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={e => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            styles.input,
            { fontSize: t.fontSize, color: c.ink },
            serif ? { fontFamily: font.serif } : null,
            multiline ? [styles.multi, { lineHeight, maxHeight: lineHeight * maxLines + 24 }] : null,
            style,
          ]}
          {...rest}
        />
        {clearable && focused && value !== '' && !multiline ? (
          <Pressable onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel="清除" hitSlop={10}>
            <CircleX size={18} color={c.ink3} />
          </Pressable>
        ) : null}
        {accessory}
      </View>
      {error ? (
        <View style={styles.msgRow}>
          <TriangleAlert size={14} color={c.conf} />
          <Txt variant="caption" color={c.conf} style={styles.msg} accessibilityLiveRegion="polite">
            {error}
          </Txt>
        </View>
      ) : help || (showCounter && counter === 'near') ? (
        <View style={styles.msgRow}>
          <Txt variant="caption" color={c.ink3} style={styles.msg}>
            {help ?? ''}
          </Txt>
          {showCounter && counter === 'near' ? (
            <Txt variant="caption" color={c.ink3} numeric>
              {`${n} / ${max}`}
            </Txt>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  box: {
    borderWidth: 1,
    borderColor: c.field,
    borderRadius: radius.field,
    backgroundColor: c.surface,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  single: { height: 48 },
  focused: { borderWidth: 2, borderColor: c.brand, paddingHorizontal: 11 },
  errorBox: { borderColor: c.conf },
  readonly: { opacity: 0.6 },
  input: { flex: 1, padding: 0, alignSelf: 'stretch' },
  multi: { paddingVertical: 12 },
  msgRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  msg: { flex: 1 },
});
