/** S14 / S14a shared labels and navigation. */
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../app/navigation/types';
import type { Conflict, ConflictView } from '../../features/types';
import { chapterHeading as formatChapterHeading } from '../../utils/format';

export const CONFLICT_TYPE_LABEL: Record<Conflict['type'], string> = {
  setting: '设定', character: '人物', timeline: '时间线', item: '物品', relation: '关系',
};
export const SEVERITY_LABEL: Record<Conflict['severity'], string> = { high: '高', medium: '中', low: '低' };

/** "{类型}冲突 · {条目名}" (S14 #4, S14a #2). */
export const conflictTitle = (conflict: ConflictView) =>
  `${CONFLICT_TYPE_LABEL[conflict.type] ?? '设定'}冲突${conflict.entryName ? ` · ${conflict.entryName}` : ''}`;

export const chapterHeading = (chapter: ConflictView['chapter']) =>
  chapter ? chapter.number ? formatChapterHeading({ ...chapter, kind: 'main' }) : chapter.title : null;

/** "第 5–11 章有效" / "自第 5 章起" / "设定层面始终有效" (S14a #4). */
export function factInterval(fact: NonNullable<ConflictView['fact']>): string {
  const { fromNumber: from, toNumber: to } = fact;
  if (from && to) { return from === to ? `第 ${from} 章有效` : `第 ${from}–${to} 章有效`; }
  if (from) { return `自第 ${from} 章起`; }
  if (to) { return `至第 ${to} 章有效`; }
  return '设定层面始终有效';
}

export function resolutionLabel(conflict: ConflictView): string {
  switch (conflict.status) {
    case 'fixed_text': return '已改正文';
    case 'updated_entry': return '已更新档案';
    case 'intentional': return `有意为之${conflict.note ? `：${conflict.note}` : ''}`;
    case 'later': return '稍后处理';
    case 'superseded': return '已被后续定稿取代';
    default: return '待处理';
  }
}

/**
 * Open S14a, but if the same conflict is already in the stack (S06 → S14a → S07 → 冲突提示条)
 * go back to it instead of stacking another copy (S14a §6).
 */
export function openConflict(navigation: NavigationProp<RootStackParamList>, conflictId: string) {
  let nav: NavigationProp<RootStackParamList> | undefined = navigation;
  while (nav) {
    const state = nav.getState();
    if (state?.routeNames?.includes('ConflictDetail')) {
      const existing = state.routes.some(route => route.name === 'ConflictDetail' && (route.params as { conflictId?: string } | undefined)?.conflictId === conflictId);
      if (existing) { (nav as unknown as { popTo(name: 'ConflictDetail', params: { conflictId: string }): void }).popTo('ConflictDetail', { conflictId }); return; }
      break;
    }
    nav = nav.getParent() as NavigationProp<RootStackParamList> | undefined;
  }
  navigation.navigate('ConflictDetail', { conflictId });
}
