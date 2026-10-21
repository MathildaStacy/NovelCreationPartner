/**
 * Aho–Corasick multi-pattern name matching for entity mentions. Matching is
 * case-insensitive per UTF-16 unit (so offsets stay aligned with the original text)
 * and keeps the leftmost-longest non-overlapping matches, like the archive's
 * `findMentions`: "张三丰" never also counts as "张三".
 */
export interface NamePattern<T> { name: string; value: T; }
export interface NameMatch<T> { start: number; end: number; name: string; values: readonly T[]; }

interface Node { next: Map<string, number>; fail: number; output: number[]; depth: number; }

export const lowerUnit = (unit: string) => { const lower = unit.toLowerCase(); return lower.length === 1 ? lower : unit; };
export function foldCase(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) result += lowerUnit(text[i]);
  return result;
}
/** Single-character names are too ambiguous for automatic mention matching. */
export const matchableName = (name: string) => [...name.trim()].length >= 2;

export class NameMatcher<T> {
  private readonly nodes: Node[] = [{ next: new Map(), fail: 0, output: [], depth: 0 }];
  private readonly names: string[] = [];
  private readonly values: T[][] = [];

  constructor(patterns: readonly NamePattern<T>[]) {
    const byName = new Map<string, number>();
    for (const pattern of patterns) {
      const name = foldCase(pattern.name.trim());
      if (!matchableName(name)) continue;
      let id = byName.get(name);
      if (id === undefined) {
        id = this.names.length; byName.set(name, id); this.names.push(name); this.values.push([]);
        let node = 0;
        for (const unit of name) {
          // Iterate by UTF-16 unit so node depth equals string length.
          for (let i = 0; i < unit.length; i++) {
            const key = unit[i];
            let child = this.nodes[node].next.get(key);
            if (child === undefined) {
              child = this.nodes.length;
              this.nodes.push({ next: new Map(), fail: 0, output: [], depth: this.nodes[node].depth + 1 });
              this.nodes[node].next.set(key, child);
            }
            node = child;
          }
        }
        this.nodes[node].output.push(id);
      }
      if (!this.values[id].includes(pattern.value)) this.values[id].push(pattern.value);
    }
    const queue: number[] = [];
    for (const child of this.nodes[0].next.values()) queue.push(child);
    while (queue.length) {
      const node = queue.shift()!;
      for (const [key, child] of this.nodes[node].next) {
        let fail = this.nodes[node].fail;
        while (fail !== 0 && !this.nodes[fail].next.has(key)) fail = this.nodes[fail].fail;
        const target = this.nodes[fail].next.get(key);
        this.nodes[child].fail = target !== undefined && target !== child ? target : 0;
        this.nodes[child].output.push(...this.nodes[this.nodes[child].fail].output);
        queue.push(child);
      }
    }
  }

  get size(): number { return this.names.length; }

  /** Leftmost-longest, non-overlapping matches in text order. */
  find(text: string): NameMatch<T>[] {
    if (!this.names.length) return [];
    const folded = foldCase(text);
    const candidates: { start: number; end: number; id: number }[] = [];
    let node = 0;
    for (let i = 0; i < folded.length; i++) {
      const key = folded[i];
      while (node !== 0 && !this.nodes[node].next.has(key)) node = this.nodes[node].fail;
      node = this.nodes[node].next.get(key) ?? 0;
      for (const id of this.nodes[node].output) candidates.push({ start: i + 1 - this.names[id].length, end: i + 1, id });
    }
    candidates.sort((a, b) => a.start - b.start || b.end - a.end);
    const result: NameMatch<T>[] = [];
    let cursor = 0;
    for (const candidate of candidates) {
      if (candidate.start < cursor) continue;
      result.push({ start: candidate.start, end: candidate.end, name: this.names[candidate.id], values: this.values[candidate.id] });
      cursor = candidate.end;
    }
    return result;
  }

  /** Distinct matched values (e.g. entry ids) in first-match order. */
  valuesIn(text: string): T[] {
    const seen = new Set<T>();
    for (const match of this.find(text)) for (const value of match.values) seen.add(value);
    return [...seen];
  }
}
