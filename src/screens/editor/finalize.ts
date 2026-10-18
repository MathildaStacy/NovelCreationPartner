/**
 * S07b 定稿本章 (shared by S07 and S06b). CONTRACT STUB — the S07 agent
 * implements it; keep the signature stable.
 */
import type { ChapterKind, ChapterState, ID } from '../../features/types';

export interface FinalizeTarget {
  id: ID;
  kind: ChapterKind;
  state: ChapterState;
  number: number | null;
  title: string;
  charCount: number;
}

/**
 * Shows the S07b dialog (first / re-finalize copy, pause-reason note), runs
 * chapters.finalize on confirm and shows the result toast. The caller must have
 * flushed the editor first. Resolves true when the chapter was finalized.
 * Empty body: shows the "正文为空…" toast and resolves false without a dialog.
 */
export async function finalizeWithConfirm(_c: FinalizeTarget): Promise<boolean> {
  return false;
}
