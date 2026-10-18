import React from 'react';
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { color as c, maxFontSizeMultiplier, tabular, type, type TypeVariant } from '../theme/tokens';

export interface TxtProps extends TextProps {
  variant?: TypeVariant;
  color?: string;
  /** Tabular digits for counts and times (UI §3.2). */
  numeric?: boolean;
  weight?: TextStyle['fontWeight'];
  align?: TextStyle['textAlign'];
}

/** App text: type scale, ink colour and the 1.3× font scaling cap. */
export function Txt({ variant = 'body', color, numeric, weight, align, style, ...rest }: TxtProps) {
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...rest}
      style={[
        type[variant],
        { color: color ?? c.ink },
        numeric ? tabular : null,
        weight ? { fontWeight: weight } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
