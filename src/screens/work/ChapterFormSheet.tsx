/**
 * S06a 章节信息 (shared by S05, S06 and S07a). CONTRACT STUB — the S06 agent
 * implements it; keep the props interface stable.
 */
import React from 'react';
import type { Chapter, ID } from '../../features/types';

export interface ChapterFormSheetProps {
  visible: boolean;
  workId: ID;
  mode: 'create' | 'edit';
  /** edit mode */
  chapterId?: ID;
  /** create mode: preselected volume ("在这里新建"); default = last volume with chapters, else the first */
  volumeId?: ID;
  /** Ask the parent to hide the sheet (cancel, scrim, swipe; after D04 when dirty). */
  onRequestClose: () => void;
  /** create mode: chapters.create succeeded. The parent hides the sheet and pushes Editor. */
  onCreated?: (chapter: Chapter) => void;
  /** edit mode: chapters.update succeeded (the sheet already showed "已保存"). The parent hides the sheet. */
  onSaved?: () => void;
  /** edit mode: chapter was deleted meanwhile (NOT_FOUND). The parent hides the sheet; the editor also goes back. */
  onGone?: () => void;
}

export function ChapterFormSheet(_props: ChapterFormSheetProps): React.ReactElement | null {
  return null;
}
