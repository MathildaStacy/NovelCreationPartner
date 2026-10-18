/** Core data types from G02 §2. Field names are what the UI sees. */

export type ID = string;
export type ISO = string;

export type Genre =
  | 'xuanhuan'
  | 'xianxia'
  | 'dushi'
  | 'kehuan'
  | 'xuanyi'
  | 'yanqing'
  | 'lishi'
  | 'qihuan'
  | 'other';

export const GENRE_LABELS: Record<Genre, string> = {
  xuanhuan: '玄幻',
  xianxia: '仙侠',
  dushi: '都市',
  kehuan: '科幻',
  xuanyi: '悬疑',
  yanqing: '言情',
  lishi: '历史',
  qihuan: '奇幻',
  other: '其他',
};

export type WorkStatus = 'ongoing' | 'finished';
export type Cover = { kind: 'text' } | { kind: 'image'; path: string };

export interface Work {
  id: ID;
  title: string | null;
  genre: Genre | null;
  premise: string;
  styleNote: string | null;
  status: WorkStatus;
  plannedChapters: number | null;
  cover: Cover;
  createdAt: ISO;
  updatedAt: ISO;
  lastOpenedAt: ISO | null;
  deletedAt: ISO | null;
}

export interface WorkSummary extends Work {
  chapterCount: number;
  charCount: number;
}

export interface Volume {
  id: ID;
  workId: ID;
  title: string;
  order: number;
}

export type ChapterKind = 'main' | 'extra' | 'draft';
export type ChapterState = 'draft' | 'finalized' | 'modified';

export interface Chapter {
  id: ID;
  workId: ID;
  volumeId: ID;
  title: string;
  kind: ChapterKind;
  order: number;
  /** 第 N 章 — only main chapters are numbered (G02 §4.4). */
  number: number | null;
  body: string;
  charCount: number;
  state: ChapterState;
  summary: string | null;
  finalizedVersionId: ID | null;
  openConflictCount: number;
  lastCursor: number;
  updatedAt: ISO;
  deletedAt: ISO | null;
}

export type ChapterListItem = Omit<Chapter, 'body' | 'lastCursor'>;

export type VersionReason = 'auto' | 'finalize' | 'before_ai' | 'manual' | 'before_restore';

export interface ChapterVersion {
  id: ID;
  chapterId: ID;
  reason: VersionReason;
  charCount: number;
  createdAt: ISO;
}

export type EntryType = 'character' | 'world' | 'place' | 'faction' | 'rule' | 'foreshadow';
export type MemoryState = 'PROPOSED' | 'CONFIRMED' | 'ESTABLISHED' | 'CONFLICTED' | 'RETIRED';

export type Protocol = 'openai_responses' | 'anthropic_messages';
export type PartnerScopeKind = 'confirmed' | 'chapter';

export type JobKind = 'summarize' | 'extract_memory' | 'detect_conflicts';
export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
export type PauseReason = 'no_service' | 'no_key' | 'notice' | 'offline';

export interface AiErrorInfo {
  code: string;
  status: number | null;
  message: string;
  providerMessage: string | null;
  requestId: string | null;
  serviceName: string;
  model: string;
  at: ISO;
}

export interface Job {
  id: ID;
  workId: ID;
  chapterId: ID | null;
  kind: JobKind;
  status: JobStatus;
  attempts: number;
  error: AiErrorInfo | null;
  createdAt: ISO;
  updatedAt: ISO;
  pauseReason: PauseReason | null;
}

export interface Overview {
  chapterCount: number;
  charCount: number;
  plannedChapters: number | null;
  lastEdited: { chapterId: ID; number: number | null; title: string; excerpt: string } | null;
  pending: { conflicts: number; proposals: number; activeJobs: number; failedJobs: number };
  archive: { characters: number; others: number; foreshadows: number; foreshadowsOpen: number };
}
