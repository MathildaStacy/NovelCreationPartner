import type { DiffBlock } from '../../features/versions';

export type DiffRow = {
  key: string;
  blocks: DiffBlock[];
  foldable: boolean;
  firstChange: boolean;
};
/** Fold only contiguous runs of at least three unchanged paragraphs. */
export function groupDiff(blocks: DiffBlock[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let hadChange = false;
  for (let i = 0; i < blocks.length; ) {
    if (blocks[i].type === 'same') {
      let end = i + 1;
      while (end < blocks.length && blocks[end].type === 'same') {
        end++;
      }
      rows.push({
        key: String(i),
        blocks: blocks.slice(i, end),
        foldable: end - i >= 3,
        firstChange: false,
      });
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
