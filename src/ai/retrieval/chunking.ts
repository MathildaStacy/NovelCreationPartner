/**
 * Passage chunks for history retrieval. Not the same thing as the 9000-character
 * finalization analysis chunks (finalizationChunks.ts) — never mix the two.
 *
 * Offsets are JavaScript string indices (UTF-16 code units) into the exact body the
 * chunks were built from; `body.slice(start, end) === text` always holds.
 */
import { countChars } from '../../utils/text';

export interface PassageChunkOptions {
  /** A chunk below this many characters keeps absorbing following paragraphs. */
  minChars: number;
  /** Preferred upper size; paragraphs are merged while they stay under it. */
  maxChars: number;
  /** A single paragraph up to this size is kept whole; longer ones split at sentence ends. */
  hardMaxChars: number;
}
export const PASSAGE_CHUNKING: Readonly<PassageChunkOptions> = Object.freeze({ minChars: 200, maxChars: 400, hardMaxChars: 800 });
/** Stored with each chunk row; a different policy makes the stored index stale. */
export const PASSAGE_POLICY = `passage-1:${PASSAGE_CHUNKING.minChars}-${PASSAGE_CHUNKING.maxChars}-${PASSAGE_CHUNKING.hardMaxChars}`;

export interface PassageChunk { index: number; start: number; end: number; text: string; }
interface Span { start: number; end: number; size: number; }

/** Non-blank lines (one line = one paragraph), without their trailing line break. */
function paragraphSpans(body: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  while (start <= body.length) {
    const lineEnd = body.indexOf('\n', start);
    const end = lineEnd < 0 ? body.length : lineEnd;
    const size = countChars(body.slice(start, end));
    if (size > 0) spans.push({ start, end, size });
    if (lineEnd < 0) break;
    start = lineEnd + 1;
  }
  return spans;
}

const SENTENCE = /[^。！？!?…\n]*(?:[。！？!?]+|…+)[”’」』）)】]*|[^。！？!?…\n]+$/gu;

/** Splits one over-long paragraph at sentence ends; a single huge sentence is the only hard cut. */
function splitLong(body: string, span: Span, options: PassageChunkOptions): Span[] {
  const text = body.slice(span.start, span.end);
  const sentences: Span[] = [];
  SENTENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let covered = 0;
  while ((match = SENTENCE.exec(text)) && match[0]) {
    const start = span.start + match.index;
    sentences.push({ start, end: start + match[0].length, size: countChars(match[0]) });
    covered = match.index + match[0].length;
  }
  if (covered < text.length) sentences.push({ start: span.start + covered, end: span.end, size: countChars(text.slice(covered)) });
  const pieces: Span[] = [];
  for (const sentence of sentences) {
    if (sentence.size > options.hardMaxChars) {
      // No sentence boundary inside: cut on code points so no surrogate pair is broken.
      let start = sentence.start;
      while (start < sentence.end) {
        let end = start, size = 0;
        while (end < sentence.end && size < options.maxChars) {
          const point = body.codePointAt(end)!;
          end += point > 0xffff ? 2 : 1;
          size += /\s/u.test(String.fromCodePoint(point)) ? 0 : 1;
        }
        pieces.push({ start, end, size });
        start = end;
      }
      continue;
    }
    const last = pieces.at(-1);
    if (last && last.end === sentence.start && last.size + sentence.size <= options.maxChars) {
      last.end = sentence.end; last.size += sentence.size;
    } else pieces.push({ ...sentence });
  }
  return pieces.filter(piece => piece.size > 0);
}

/**
 * Merges adjacent short paragraphs into roughly `minChars`–`maxChars` chunks and keeps
 * natural paragraphs whole whenever possible.
 */
export function splitPassageChunks(body: string, options: PassageChunkOptions = PASSAGE_CHUNKING): PassageChunk[] {
  const spans: Span[] = [];
  let current: Span | null = null;
  const flush = () => { if (current) spans.push(current); current = null; };
  for (const paragraph of paragraphSpans(body)) {
    if (paragraph.size > options.hardMaxChars) {
      flush();
      spans.push(...splitLong(body, paragraph, options));
      continue;
    }
    const open = current as Span | null;
    if (!open) { current = { ...paragraph }; continue; }
    const merged = open.size + paragraph.size;
    // A chunk still under the minimum may grow up to 1.5× the preferred maximum to get context.
    if (merged <= options.maxChars || (open.size < options.minChars && merged <= Math.min(options.hardMaxChars, options.maxChars * 1.5))) {
      open.end = paragraph.end; open.size = merged;
    } else { flush(); current = { ...paragraph }; }
  }
  flush();
  // A very short tail joins the previous chunk instead of standing alone.
  const tail = spans.at(-1), previous = spans.at(-2);
  if (tail && previous && tail.size < options.minChars / 2 && previous.size + tail.size <= options.hardMaxChars && body.slice(previous.end, tail.start).trim() === '') {
    previous.end = tail.end; previous.size += tail.size; spans.pop();
  }
  return spans.map((span, index) => ({ index, start: span.start, end: span.end, text: body.slice(span.start, span.end) }));
}
