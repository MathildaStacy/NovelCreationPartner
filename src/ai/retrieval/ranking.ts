/**
 * Merges entity-mention and keyword candidates, scores, deduplicates and fits a
 * length budget. Pure and deterministic: no recency preference — earlier passages
 * compete on relevance, and the first mention of each queried entity gets a bonus so
 * an early, important introduction is not crowded out by many later appearances.
 */
import { bigrams } from './keywords';
import { foldCase } from './matcher';

export interface PassageCandidate {
  /** Stable identity (index row id, or chapter:index for a temporary scan). */
  key: string;
  chapterId: string;
  /** Narrative position of the chapter (reading order), not story time. */
  chapterRank: number;
  chunkIndex: number;
  start: number;
  end: number;
  text: string;
  entryIds: readonly string[];
}
export interface PassageQuery {
  entryIds: readonly string[];
  keywords: readonly string[];
  /** Optional task text for bigram overlap (selection, analysis block). */
  queryText?: string;
  /** Names of the queried entities, used to center excerpts. */
  names?: readonly string[];
}
export interface RankOptions {
  limit: number;
  /** Total characters (UTF-16) of all returned excerpts. */
  maxChars: number;
  excerptChars: number;
  perChapter: number;
  minScore: number;
}
export interface RankedPassage extends PassageCandidate {
  score: number;
  matchedEntryIds: string[];
  matchedKeywords: string[];
  /** Excerpt range inside the chapter body. */
  excerptStart: number;
  excerptEnd: number;
  excerpt: string;
}

const SENTENCE_END = /[。！？!?…”」』]/u;
/** An exact slice of the candidate around `focus`, widened to sentence ends where it fits. */
export function excerptOf(candidate: Pick<PassageCandidate, 'start' | 'end' | 'text'>, focus: number, size: number): { start: number; end: number; text: string } {
  const { text } = candidate;
  if (text.length <= size) return { start: candidate.start, end: candidate.end, text };
  let from = Math.max(0, Math.min(focus - Math.floor(size / 3), text.length - size));
  let to = Math.min(text.length, from + size);
  // Snap the start forward to just after a sentence end, the end back to one, when close.
  for (let i = from; i > 0 && i > from - 40; i--) if (SENTENCE_END.test(text[i - 1])) { from = i; break; }
  for (let i = to; i < text.length && i < to + 40; i++) if (SENTENCE_END.test(text[i - 1])) { to = i; break; }
  if (to - from > size + 80) to = from + size;
  // Never split a surrogate pair.
  if (from > 0 && /[\udc00-\udfff]/.test(text[from])) from--;
  if (to < text.length && /[\udc00-\udfff]/.test(text[to])) to++;
  return { start: candidate.start + from, end: candidate.start + to, text: text.slice(from, to) };
}

export function rankPassages(candidates: readonly PassageCandidate[], query: PassageQuery, options: RankOptions): RankedPassage[] {
  const wanted = new Set(query.entryIds);
  const keywords = [...new Set(query.keywords.map(keyword => foldCase(keyword.trim())).filter(Boolean))];
  const queryGrams = query.queryText ? bigrams(query.queryText) : new Set<string>();
  const byKey = new Map<string, PassageCandidate>();
  for (const candidate of candidates) {
    const known = byKey.get(candidate.key);
    byKey.set(candidate.key, known ? { ...known, entryIds: [...new Set([...known.entryIds, ...candidate.entryIds])] } : candidate);
  }
  const ordered = [...byKey.values()].sort((a, b) => a.chapterRank - b.chapterRank || a.start - b.start);
  // First mention of each queried entity in narrative order.
  const first = new Map<string, string>();
  for (const candidate of ordered) for (const id of candidate.entryIds) if (wanted.has(id) && !first.has(id)) first.set(id, candidate.key);
  const firstKeys = new Set(first.values());
  const names = (query.names ?? []).map(name => foldCase(name)).filter(name => name.length >= 2);
  const scored: RankedPassage[] = [];
  for (const candidate of ordered) {
    const folded = foldCase(candidate.text);
    const matchedEntryIds = candidate.entryIds.filter(id => wanted.has(id));
    const matchedKeywords = keywords.filter(keyword => folded.includes(keyword));
    let overlap = 0;
    if (queryGrams.size) {
      let shared = 0;
      for (const gram of bigrams(candidate.text)) if (queryGrams.has(gram)) shared++;
      overlap = Math.min(1, shared / 6);
    }
    let score = 2 * Math.min(matchedEntryIds.length, 3) + 3 * Math.min(matchedKeywords.length, 4) + 2 * overlap + (firstKeys.has(candidate.key) ? 0.5 : 0);
    if (wanted.size && !matchedEntryIds.length) score *= 0.4;
    if (score < options.minScore || (!matchedEntryIds.length && !matchedKeywords.length)) continue;
    const focusTerms = [...matchedKeywords, ...names];
    const positions = focusTerms.map(term => folded.indexOf(term)).filter(index => index >= 0);
    const focus = positions.length ? Math.min(...positions) : 0;
    const excerpt = excerptOf(candidate, focus, options.excerptChars);
    scored.push({ ...candidate, score, matchedEntryIds, matchedKeywords, excerptStart: excerpt.start, excerptEnd: excerpt.end, excerpt: excerpt.text });
  }
  // Highest relevance first; ties go to the earlier narrative position for determinism.
  scored.sort((a, b) => b.score - a.score || a.chapterRank - b.chapterRank || a.start - b.start);
  const perChapter = new Map<string, number>();
  const seenText = new Set<string>();
  const selected: RankedPassage[] = [];
  let total = 0;
  for (const passage of scored) {
    if (selected.length >= options.limit) break;
    const count = perChapter.get(passage.chapterId) ?? 0;
    if (count >= options.perChapter || seenText.has(passage.excerpt)) continue;
    if (total + passage.excerpt.length > options.maxChars) continue;
    selected.push(passage); total += passage.excerpt.length;
    perChapter.set(passage.chapterId, count + 1); seenText.add(passage.excerpt);
  }
  // Presented in narrative order so a later recovery reads after the earlier injury.
  return selected.sort((a, b) => a.chapterRank - b.chapterRank || a.start - b.start);
}
