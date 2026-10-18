/** Text helpers shared by services and screens (G02 §1, §4.6, §5.13). */

const WHITESPACE = /[\s　 ﻿]/gu;

/** Characters after removing whitespace (incl. full-width space); an emoji counts as 1. */
export function countChars(text: string): number {
  return Array.from(text.replace(WHITESPACE, '')).length;
}

/**
 * Normalises chapter body text for storage (G02 §4.6): \n line breaks, one line =
 * one paragraph, leading whitespace (incl. full-width spaces) removed from each
 * paragraph. Trailing whitespace of each line is kept so typing is not disturbed.
 */
export function normalizeBody(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/^[\s　 ﻿]+/u, ''))
    .join('\n');
}
