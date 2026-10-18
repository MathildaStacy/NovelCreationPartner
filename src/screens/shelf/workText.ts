/** Shelf / search / menu text for a work (S03 §5 第 7 条, S03a #2, S03b #5). */
import type { WorkSummary } from '../../features/types';
import { t } from '../../locales/zh-CN';
import { formatChars, formatTime, genreLabel } from '../../utils/format';

export const workName = (w: { title: string | null }) => w.title ?? t.common.untitledWork;

/** "玄幻 12 章 已完结" / "玄幻 构思中". Items separated by spaces, never a middle dot. */
export function workMeta(w: WorkSummary): string {
  const parts = [genreLabel(w.genre), w.chapterCount > 0 ? t.shelf.chapters(w.chapterCount) : t.shelf.planning];
  if (w.status === 'finished') {
    parts.push(t.shelf.finished);
  }
  return parts.filter(Boolean).join(' ');
}

/** S03a title meta: "{题材} {N 章}" without the status. */
export function workMenuMeta(w: WorkSummary): string {
  return [genreLabel(w.genre), w.chapterCount > 0 ? t.shelf.chapters(w.chapterCount) : t.shelf.planning]
    .filter(Boolean)
    .join(' ');
}

/** S03b second line: "{题材} · {N} 章 · {字数}"（· 已完结）. */
export function searchMeta(w: WorkSummary): string {
  const parts = [genreLabel(w.genre), t.shelf.chapters(w.chapterCount), formatChars(w.charCount)];
  if (w.status === 'finished') {
    parts.push(t.shelf.finished);
  }
  return parts.filter(Boolean).join(' · ');
}

export const workTime = (w: WorkSummary, now?: Date) => formatTime(w.updatedAt, now);
