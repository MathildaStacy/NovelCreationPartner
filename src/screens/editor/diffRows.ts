import type { DiffBlock } from '../../features/versions';

export type DiffRow = {
  key: string;
  blocks: DiffBlock[];
  foldable: boolean;
  firstChange: boolean;
};
/** Unchanged paragraphs kept visible next to a change (S07e §6: 改动段及前后最多 2 段). */
export const CONTEXT = 2;

/**
 * Groups paragraph blocks for S07e. A run of unchanged paragraphs keeps up to
 * CONTEXT paragraphs beside each neighbouring change and folds the rest when at
 * least three remain (S07e §5.2); shorter remainders are shown as they are.
 */
export function groupDiff(blocks: DiffBlock[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let hadChange = false;
  const visible = (from: number, to: number) => {
    if (to > from) { rows.push({ key: String(from), blocks: blocks.slice(from, to), foldable: false, firstChange: false }); }
  };
  for (let i = 0; i < blocks.length; ) {
    if (blocks[i].type === 'same') {
      let end = i + 1;
      while (end < blocks.length && blocks[end].type === 'same') {
        end++;
      }
      const lead = i > 0 ? CONTEXT : 0;
      const trail = end < blocks.length ? CONTEXT : 0;
      if (end - i - lead - trail >= 3) {
        visible(i, i + lead);
        rows.push({ key: String(i + lead), blocks: blocks.slice(i + lead, end - trail), foldable: true, firstChange: false });
        visible(end - trail, end);
      } else {
        visible(i, end);
      }
      i = end;
    } else {
      rows.push({
        key: String(i),
        blocks: [blocks[i]],
        foldable: false,
        firstChange: !hadChange,
      });
      hadChange = true;
      i++;
    }
  }
  return rows;
}
