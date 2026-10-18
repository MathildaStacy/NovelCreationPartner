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

export type SourceKind = 'manual' | 'partner' | 'review' | 'ai_complete';
export interface EntrySource { kind: SourceKind; ref: string | null; }
export interface Entry {
  id: ID; workId: ID; type: EntryType; name: string; aliases: string[]; summary: string;
  state: MemoryState; source: EntrySource; createdAt: ISO; updatedAt: ISO; deletedAt: ISO | null;
}
export interface EntryFact {
  id: ID; entryId: ID; field: string; value: string; state: MemoryState;
  fromChapterId: ID | null; toChapterId: ID | null; source: EntrySource;
  supersedesId: ID | null; createdAt: ISO;
  sourceLabel?: string; sourceChapterId?: ID | null; evidence?: string | null;
}
export interface Relation {
  id: ID; workId: ID; fromEntryId: ID; toEntryId: ID; fromName: string; toName: string;
  kind: string; note: string | null; fromChapterId: ID | null; toChapterId: ID | null; state: MemoryState;
}
export interface EntryListItem {
  id: ID; type: EntryType; name: string; summary: string; state: MemoryState;
  sourceLabel: string; sourceAt: ISO; pendingCount: number; resolved?: boolean; resolvedChapterId?: ID | null;
}
export interface HistoryItem {
  factId: ID; field: string; beforeFactId: ID | null; before: string | null; after: string | null;
  fromChapterId: ID | null; toChapterId: ID | null; sourceKind: SourceKind | 'conflict' | 'revert';
  sourceRef: string | null; sourceChapterId: ID | null; evidence: string | null; at: ISO;
}
export interface EntryDetail extends Entry {
  facts: EntryFact[]; proposedFacts: EntryFact[];
  timeline: { chapterId: ID | null; number: number | null; field: string; value: string;
    kind: 'fact' | 'pending'; factId?: ID; proposalId?: ID }[];
  relations: Relation[]; appearances: { chapterId: ID; number: number | null; kind: ChapterKind; title: string; count: number; firstOffset: number; firstLength: number }[];
  conflicts: Conflict[];
  pendingProposals: { id: ID; field: string | null; after: string; evidence: string; chapterId: ID }[];
  resolved?: boolean; resolvedChapterId?: ID | null;
}

export interface PartnerScope { kind: 'confirmed' | 'chapter'; chapterId: ID | null; includeProposed: boolean; }
export type MessageStatus = 'streaming' | 'done' | 'stopped' | 'error';
export interface IdeationOption {
  title: string; summary: string; direction: string; risks: string; impact: string;
  state: 'open' | 'adopted' | 'stashed' | 'dismissed'; entryIds: ID[]; factIds: ID[];
}
export interface PartnerStructured { known: string[]; questions: string[]; options: IdeationOption[]; }
export interface Message {
  id: ID; conversationId: ID; role: 'user' | 'assistant'; content: string; status: MessageStatus;
  mode: 'chat' | 'more_options' | null; structured: PartnerStructured | null;
  serviceId: ID | null; model: string | null; usage: { input: number; output: number } | null;
  error: AiErrorInfo | null; createdAt: ISO;
}
export interface Conversation {
  id: ID; workId: ID; title: string; scope: PartnerScope; lastMessageAt: ISO;
  preview: { role: 'user' | 'assistant'; text: string; status: MessageStatus } | null; generating: boolean;
}
export interface AdoptItem {
  action: 'create' | 'update'; type: EntryType; name: string; targetEntryId: ID | null; summary: string;
  facts: { field: string; value: string; before: string | null }[];
}
export interface CompareTable {
  dimensions: ('conflict' | 'characters' | 'pacing' | 'risks' | 'followups' | 'fit')[];
  columns: { optionIndex: number; cells: Record<string, string>; fit: 'high' | 'medium' | 'low' }[];
}

export type Protocol = 'openai_responses' | 'anthropic_messages';
export type PartnerScopeKind = 'confirmed' | 'chapter';

export type JobKind = 'summarize' | 'extract_memory' | 'detect_conflicts';
export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
export type PauseReason = 'no_service' | 'no_key' | 'notice' | 'offline' | 'budget' | 'interrupted' | 'legacy_input' | 'stale' | 'batch';

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
  sourceVersionId: ID | null;
  inputFingerprint: string | null;
  dependencyRevision: number | null;
  serviceId: ID | null;
  serviceRevision: number | null;
  policyVersion: string | null;
  executionToken: string | null;
  operationId: ID | null;
  candidateOffset: number;
  totalChunks?:number;
  completedChunks?:number;
  plannedCalls?:number;
  authorizedCalls?:number;
}

export interface Overview {
  chapterCount: number;
  charCount: number;
  plannedChapters: number | null;
  lastEdited: { chapterId: ID; number: number | null; title: string; excerpt: string } | null;
  pending: { conflicts: number; proposals: number; activeJobs: number; failedJobs: number };
  archive: { characters: number; others: number; foreshadows: number; foreshadowsOpen: number };
}

export type ConflictStatus = 'open' | 'fixed_text' | 'updated_entry' | 'intentional' | 'later' | 'superseded';

export interface Conflict {
  id: ID;
  workId: ID;
  chapterId: ID | null;
  entryId: ID | null;
  type: 'setting' | 'character' | 'timeline' | 'item' | 'relation';
  severity: 'high' | 'medium' | 'low';
  a: { label: string; ref: string; quote: string };
  b: { label: string; ref: string; quote: string };
  explanation: string;
  suggestions: string[];
  status: ConflictStatus;
  note: string | null;
  createdAt: ISO;
}

export interface ModelService {
  id: ID;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  isDefault: boolean;
  options: {
    maxOutputTokens: number | null;
    effort: 'default' | 'low' | 'medium' | 'high';
    authHeader: 'x-api-key' | 'bearer';
    store: boolean;
    contextBudget: number;
    caps: { jsonSchema?: boolean; effort?: boolean; streaming?: boolean };
  };
  /** false for services restored from a backup (no key on this device). */
  hasKey: boolean;
  lastTest: { at: ISO; ok: boolean; message: string } | null;
}

export type TrashKind = 'work' | 'chapter' | 'entry';
