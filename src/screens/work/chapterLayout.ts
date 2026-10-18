import type {
  ChapterKind,
  ChapterListItem,
  ID,
  Volume,
} from '../../features/types';

export type ChapterGroup = { volume: Volume; chapters: ChapterListItem[] };
export type ChapterLayout = { volumeId: ID; chapterIds: ID[] }[];

export const layoutOf = (groups: ChapterGroup[]): ChapterLayout =>
  groups.map(g => ({
    volumeId: g.volume.id,
    chapterIds: g.chapters.map(c => c.id),
  }));
export const sameLayout = (a: ChapterLayout, b: ChapterLayout): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Moves one chapter to the indicated insertion slot; every other chapter retains its order. */
export function moveChapter(
  layout: ChapterLayout,
  id: ID,
  volumeId: ID,
  index: number,
): ChapterLayout {
  const source = layout.find(g => g.chapterIds.includes(id));
  if (!source || !layout.some(g => g.volumeId === volumeId)) {
    return layout;
  }
  const oldIndex = source.chapterIds.indexOf(id);
  const result = layout.map(g => ({
    ...g,
    chapterIds: g.chapterIds.filter(cid => cid !== id),
  }));
  const dest = result.find(g => g.volumeId === volumeId)!;
  const adjusted =
    source.volumeId === volumeId && oldIndex < index ? index - 1 : index;
  dest.chapterIds.splice(
    Math.max(0, Math.min(adjusted, dest.chapterIds.length)),
    0,
    id,
  );
  return sameLayout(layout, result) ? layout : result;
}

/** Global main-chapter numbering; extras and drafts never consume a number. */
export function previewNumbers(
  layout: ChapterLayout,
  chapters: Map<ID, { kind: ChapterKind }>,
): Map<ID, number | null> {
  const numbers = new Map<ID, number | null>();
  let n = 0;
  layout.forEach(g =>
    g.chapterIds.forEach(id =>
      numbers.set(id, chapters.get(id)?.kind === 'main' ? ++n : null),
    ),
  );
  return numbers;
}

/** S06a: existing chapter stays in place unless its volume changes; new/moved chapters append. */
export function mainNumberAt(
  groups: ChapterGroup[],
  volumeId: ID,
  chapterId?: ID,
): number {
  let n = 0;
  for (const g of groups) {
    for (const c of g.chapters) {
      if (g.volume.id === volumeId && c.id === chapterId) {
        return n + 1;
      }
      if (c.id !== chapterId && c.kind === 'main') {
        n++;
      }
    }
    if (g.volume.id === volumeId) {
      return n + 1;
    }
  }
  return n + 1;
}

export function defaultVolume(groups: ChapterGroup[]): ID {
  return (
    [...groups].reverse().find(g => g.chapters.length > 0)?.volume.id ??
    groups[0]?.volume.id ??
    ''
  );
}
