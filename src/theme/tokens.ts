/** Design tokens (UI_DESIGN.md §3, §8.1). Light mode only in V1; dark values come with P1. */
import { Platform, type TextStyle } from 'react-native';
import type { Genre } from '../features/types';

export const color = {
  ink: '#1D1A2B',
  ink2: '#57536A',
  ink3: '#6F6B85',
  paper: '#F6F5FA',
  surface: '#FFFFFF',
  sunken: '#ECEAF3',
  line: '#E4E1EE',
  field: '#8A85A1',
  brand: '#5847D6',
  brandPress: '#4636B8',
  brandTint: '#EEEBFD',
  brandSelect: '#DCD6FB',
  est: '#0A6E64',
  estTint: '#E3F4F1',
  conf: '#C23B26',
  confTint: '#FBEAE6',
  pend: '#8F5B0E',
  pendTint: '#FBF1DF',
  night: '#1E1A44',
  slip: '#F3EEDF',
  white: '#FFFFFF',
  scrim: 'rgba(29,26,43,0.4)',
} as const;

/** Cover / overview band colour per genre (§3.1). No genre → other. */
export const genre: Record<Genre, string> = {
  xuanhuan: '#3B3384',
  xianxia: '#2D6A5C',
  dushi: '#28466B',
  kehuan: '#1D5A84',
  xuanyi: '#34343F',
  yanqing: '#9C4459',
  lishi: '#774827',
  qihuan: '#4E3A78',
  other: '#55516B',
};

export const genreColor = (g: Genre | null | undefined): string => genre[g ?? 'other'];

/** Multiples of 4 (§3.3). space[5] = 20 = page margin. */
export const space = [0, 4, 8, 12, 16, 20, 24, 32, 40] as const;
export const pageMargin = 20;
export const cardPadding = 16;
export const rowMinHeight = 56;
export const maxContentWidth = 680;

export const radius = { cover: 3, small: 8, field: 10, card: 12, sheet: 20, pill: 999 } as const;

/** Only floating elements (sheets, FAB, selection bar) cast a shadow (§3.3). */
export const shadow = {
  shadowColor: '#1D1A2B',
  shadowOpacity: 0.12,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 8 },
  elevation: 8,
} as const;

/** System fonts (§3.2). serif = Songti SC on iOS, the generic serif family on Android. */
export const font = {
  sans: undefined as string | undefined,
  serif: Platform.select({ ios: 'Songti SC', default: 'serif' }),
};

export const weight = { regular: '400', semibold: '600' } as const;

type Variant =
  | 'display'
  | 'title1'
  | 'title2'
  | 'headline'
  | 'body'
  | 'callout'
  | 'caption'
  | 'manuscript'
  | 'prose';

const v = (fontSize: number, lineHeight: number, fontWeight: TextStyle['fontWeight'], serif = false): TextStyle => ({
  fontSize,
  lineHeight,
  fontWeight,
  ...(serif ? { fontFamily: font.serif } : null),
});

/** Type scale (§3.2), size / line height in pt. */
export const type: Record<Variant, TextStyle> = {
  display: v(34, 44, weight.regular, true),
  title1: v(26, 34, weight.semibold),
  title2: v(20, 28, weight.semibold),
  headline: v(17, 24, weight.semibold),
  body: v(15, 22, weight.regular),
  callout: v(13, 18, weight.regular),
  caption: v(12, 16, weight.regular),
  manuscript: v(18, 34, weight.regular, true),
  prose: v(16, 28, weight.regular, true),
};

export type TypeVariant = Variant;

/** System font scaling cap (§3.2). */
export const maxFontSizeMultiplier = 1.3;

/** Digits in counts and times (§3.2). */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export const motion = { sheetIn: 280, sheetOut: 220, settle: 200 } as const;

/** Minimum touch target (§7). */
export const hitSize = 44;
