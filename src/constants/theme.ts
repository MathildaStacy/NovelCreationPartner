/**
 * 主题配置
 */

import {colors} from './colors';

export const theme = {
  colors,

  // 字体
  fonts: {
    regular: 'System',
    medium: 'System',
    bold: 'System',
    title: 'System',
  },

  // 字体大小 (使用缩放比例以支持响应式)
  fontSizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
  },

  // 间距
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    '2xl': 40,
    '3xl': 48,
  },

  // 圆角
  radii: {
    none: 0,
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    '2xl': 24,
    full: 9999,
  },

  // 阴影
  shadows: {
    sm: {
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.2,
      shadowRadius: 2,
      elevation: 2,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 4,
    },
    lg: {
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 6,
    },
  },

  // 断点（用于响应式）
  breakpoints: {
    sm: 320,
    md: 768,
    lg: 1024,
  },

  // 行高
  lineHeights: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },

  // 字重
  fontWeights: {
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
} as const;

export type Theme = typeof theme;
