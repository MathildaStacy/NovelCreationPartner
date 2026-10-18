/** Display formats shared by screens (G01 §5 时间与数字, S03 题签, S06a 标题显示). */
import type { ChapterKind, ChapterState, Genre } from '../features/types';
import { GENRE_LABELS } from '../features/types';

const pad = (n: number) => String(n).padStart(2, '0');

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * G01: 1 分钟内"刚刚"；今天"今天 HH:mm"；昨天"昨天 HH:mm"；今年"M月D日"；跨年"YYYY年M月D日".
 * Uses the device time zone, like the stored ISO strings.
 */
export function formatTime(iso: string, now: Date = new Date()): string {
  const d = new Date(Date.parse(iso));
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const diff = now.getTime() - d.getTime();
  if (diff >= 0 && diff < 60_000) {
    return '刚刚';
  }
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  if (days === 0) {
    return `今天 ${hm}`;
  }
  if (days === 1) {
    return `昨天 ${hm}`;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** Date group title (S07d): 今天 / 昨天 / 10月12日 / 2025年12月3日. */
export function formatDay(iso: string, now: Date = new Date()): string {
  const d = new Date(Date.parse(iso));
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  if (days === 0) {
    return '今天';
  }
  if (days === 1) {
    return '昨天';
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export const formatClock = (iso: string): string => {
  const d = new Date(Date.parse(iso));
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 时间 with the date always shown, for version info (S07e): 今天 14:32 / 10月12日 14:32. */
export function formatDateTime(iso: string, now: Date = new Date()): string {
  const day = formatDay(iso, now);
  return `${day} ${formatClock(iso)}`;
}

/** Count without unit: < 10,000 exact ("7204"), otherwise "8.2 万" (one decimal, rounded). */
export function formatCount(n: number): string {
  if (n < 10_000) {
    return String(n);
  }
  const w = Math.round(n / 1000) / 10;
  return `${Number.isInteger(w) ? w.toFixed(0) : w.toFixed(1)} 万`;
}

/** "7204 字" / "8.2 万字". */
export const formatChars = (n: number): string => (n < 10_000 ? `${n} 字` : `${formatCount(n)}字`);

export const genreLabel = (g: Genre | null | undefined): string | null => (g ? GENRE_LABELS[g] : null);

const SLIP_STRIP = /[\p{P}\p{Z}\s]/gu;
export const SLIP_MAX = 8;

/** 题签 text (S03 §5): punctuation and whitespace removed, first 8 characters, no ellipsis. Empty → null. */
export function slipText(title: string | null | undefined): string[] | null {
  const chars = Array.from((title ?? '').replace(SLIP_STRIP, ''));
  return chars.length ? chars.slice(0, SLIP_MAX) : null;
}

/** 题签 font size: 13 up to 5 characters, then shrinks so the column stays within 80% of the cover; min 10. */
export function slipFontSize(chars: number, coverHeight: number, lineFactor = 1.2): number {
  if (chars <= 5) {
    return 13;
  }
  const fit = Math.floor((coverHeight * 0.8) / (chars * lineFactor) - 1);
  return Math.max(10, Math.min(13, fit));
}

/** Truncates to `max` characters (code points) and appends "…". */
export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : s;
}

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 1–99 in Chinese numerals (S06c 默认卷名); null above 99. */
export function chineseNumeral(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 99) {
    return null;
  }
  if (n < 10) {
    return DIGITS[n];
  }
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? '' : DIGITS[tens]}十${ones ? DIGITS[ones] : ''}`;
}

/** Default name for the X-th volume: 第三卷 … 第九十九卷, then 第 100 卷. */
export function defaultVolumeTitle(x: number): string {
  const c = chineseNumeral(x);
  return c ? `第${c}卷` : `第 ${x} 卷`;
}

export const KIND_LABEL: Record<ChapterKind, string> = { main: '正文', extra: '番外', draft: '草稿' };
export const STATE_LABEL: Record<ChapterState, string> = { draft: '草稿', finalized: '已定稿', modified: '有修改未定稿' };

/** "第 N 章" for main chapters, "番外" / "草稿" otherwise. */
export function chapterPrefix(c: { kind: ChapterKind; number: number | null }): string {
  return c.kind === 'main' && c.number != null ? `第 ${c.number} 章` : KIND_LABEL[c.kind];
}

const squash = (s: string) => s.replace(/\s/g, '');

/**
 * List / editor heading (S06a §5): "第 12 章 海边的相遇". A title that is just the
 * prefix ("第 12 章", "番外") is shown once, never "第 12 章 第 12 章".
 */
export function chapterHeading(c: { kind: ChapterKind; number: number | null; title: string }): string {
  const prefix = chapterPrefix(c);
  return squash(c.title) === squash(prefix) ? prefix : `${prefix} ${c.title}`;
}

/** Title for the editor nav bar: the title only, unless it merely repeats the prefix. */
export function isDefaultTitle(c: { kind: ChapterKind; number: number | null; title: string }): boolean {
  return squash(c.title) === squash(chapterPrefix(c));
}
