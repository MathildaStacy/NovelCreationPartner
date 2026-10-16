/**
 * 颜色定义
 * 基于深色主题的分层设计
 */

export const colors = {
  // 背景色 - 从深到浅的层级
  background: {
    base: '#05070C', // 最深层
    layer1: '#0A0D12', // 主容器
    layer2: '#0F131C', // 次级容器
    layer3: '#161D2B', // 卡片
    layer4: '#1E2636', // 悬浮层
  },

  // 主色调 - 青蓝色（适合创作工具）
  primary: {
    50: '#E6F7FF',
    100: '#BAE7FF',
    200: '#91D5FF',
    300: '#69C0FF',
    400: '#40A9FF',
    500: '#38BDF8', // 主色
    600: '#1890FF',
    700: '#096DD9',
    800: '#0050B3',
    900: '#003A8C',
  },

  // 辅助色 - 翡翠绿（成功、完成）
  secondary: {
    50: '#D1FAE5',
    100: '#A7F3D0',
    200: '#6EE7B7',
    300: '#34D399',
    400: '#10B981',
    500: '#059669',
    600: '#047857',
    700: '#065F46',
    800: '#064E3B',
    900: '#022C22',
  },

  // 文本色
  text: {
    primary: '#F8FAFC', // 主文本
    secondary: '#94A3B8', // 次要文本
    tertiary: '#64748B', // 辅助文本
    disabled: '#475569', // 禁用文本
    inverse: '#0F172A', // 反色文本（用于亮色背景）
  },

  // 边框色
  border: {
    default: '#1E293B',
    light: '#334155',
    focus: '#38BDF8',
  },

  // 状态色
  status: {
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#38BDF8',
  },

  // 功能色
  functional: {
    draft: '#64748B', // 草稿
    writing: '#F59E0B', // 创作中
    completed: '#10B981', // 已完成
    archived: '#475569', // 已归档
  },

  // 透明度变体
  alpha: {
    primary10: 'rgba(56, 189, 248, 0.1)',
    primary20: 'rgba(56, 189, 248, 0.2)',
    white10: 'rgba(255, 255, 255, 0.1)',
    white20: 'rgba(255, 255, 255, 0.2)',
    black50: 'rgba(0, 0, 0, 0.5)',
  },
} as const;

export type Colors = typeof colors;
