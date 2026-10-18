/** Display-only paragraph indents. All persisted selections remain UTF-16 body offsets. */
import { normalizeBody } from '../../utils/text';

const INDENT = '　　';
const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));
export const toBody = normalizeBody;
export const toDisplay = (body: string): string =>
  body
    .split('\n')
    .map(p => INDENT + p)
    .join('\n');

export function toDisplayOffset(body: string, offset: number): number {
  const at = clamp(offset, body.length);
  return at + 2 * body.slice(0, at).split('\n').length;
}

/** Also accepts unnormalised native input while it is being pasted / indented. */
export function toBodyOffset(display: string, offset: number): number {
  const at = clamp(offset, display.length);
  return normalizeBody(display.slice(0, at)).length;
}

export interface Selection {
  start: number;
  end: number;
}
export interface EditResult {
  body: string;
  selection: Selection;
}

/** Normalise native edits, including backspace at an indented paragraph start. */
export function displayEdit(
  body: string,
  selection: Selection,
  raw: string,
): EditResult {
  const previous = toDisplay(body);
  let start = 0;
  while (
    start < previous.length &&
    start < raw.length &&
    previous[start] === raw[start]
  ) {
    start++;
  }
  let end = 0;
  while (
    end < previous.length - start &&
    end < raw.length - start &&
    previous[previous.length - end - 1] === raw[raw.length - end - 1]
  ) {
    end++;
  }
  const next = toBody(raw);
  if (
    next === body &&
    raw.length === previous.length - 1 &&
    selection.start === selection.end &&
    selection.start > 0 &&
    body[selection.start - 1] === '\n'
  ) {
    const at = selection.start - 1;
    return {
      body: body.slice(0, at) + body.slice(at + 1),
      selection: { start: at, end: at },
    };
  }
  const at = toBodyOffset(raw, raw.length - end);
  return { body: next, selection: { start: at, end: at } };
}
