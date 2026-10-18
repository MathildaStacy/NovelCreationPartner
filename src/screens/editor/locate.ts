import type { Locate } from '../../app/navigation/types';
import type { Selection } from './indent';

const clamp = (n: number, length: number) => Math.max(0, Math.min(n, length));
const punctuation: Record<string, string> = {
  ',': '，',
  '.': '。',
  ':': '：',
  ';': '；',
  '!': '！',
  '?': '？',
  '(': '（',
  ')': '）',
  '"': '“',
  "'": '＇',
};
function loose(text: string) {
  const map: number[] = [];
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (/\s/u.test(text[i])) {
      continue;
    }
    out += punctuation[text[i]] ?? text[i];
    map.push(i);
  }
  return { text: out, map };
}
function nearest(text: string, quote: string, offset?: number) {
  let at = text.indexOf(quote);
  let best = -1;
  while (at >= 0) {
    if (
      best < 0 ||
      (offset !== undefined && Math.abs(at - offset) < Math.abs(best - offset))
    ) {
      best = at;
    }
    if (offset === undefined) {
      break;
    }
    at = text.indexOf(quote, at + 1);
  }
  return best;
}
export function locateSelection(
  body: string,
  lastCursor: number,
  locate?: Locate,
): { selection: Selection; missing?: 'near' | 'missing' } {
  const fallback = clamp(lastCursor, body.length);
  const offset = locate?.offset;
  if (!locate?.quote) {
    const at = clamp(offset ?? fallback, body.length);
    return { selection: { start: at, end: at } };
  }
  const at =
    offset !== undefined &&
    body.slice(offset, offset + locate.quote.length) === locate.quote
      ? offset
      : nearest(body, locate.quote, offset);
  if (at >= 0) {
    return { selection: { start: at, end: at + locate.quote.length } };
  }
  const a = loose(body);
  const b = loose(locate.quote);
  const looseAt = b.text
    ? nearest(
        a.text,
        b.text,
        offset === undefined ? undefined : a.map.findIndex(i => i >= offset),
      )
    : -1;
  if (looseAt >= 0) {
    return {
      selection: {
        start: a.map[looseAt],
        end: a.map[looseAt + b.text.length - 1] + 1,
      },
    };
  }
  const cursor =
    offset === undefined
      ? fallback
      : body.lastIndexOf('\n', clamp(offset, body.length) - 1) + 1;
  return {
    selection: { start: cursor, end: cursor },
    missing: offset === undefined ? 'missing' : 'near',
  };
}
