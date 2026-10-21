/**
 * Service events (G02 §7). Services emit after a successful write; screens
 * subscribe to refresh instead of guessing what changed.
 */
import type { ChapterState, ID, Job } from './types';

export interface EventMap {
  'work.created': { workId: ID };
  'work.updated': { workId: ID };
  'work.removed': { workId: ID };
  /** Entering a work (S04); background index maintenance may start. */
  'work.opened': { workId: ID };
  'chapters.changed': { workId: ID };
  'chapter.saved': { chapterId: ID; workId: ID; charCount: number; state: ChapterState };
  'versions.changed': { chapterId: ID };
  'entries.changed': { workId: ID; entryIds: ID[]; sourceMessageId?: ID };
  'messages.changed': { conversationId: ID; adoptionOnly?: boolean };
  'conversations.changed': { workId: ID; conversationId: ID };
  'proposals.changed': { workId: ID };
  'conflicts.changed': { workId: ID };
  'jobs.changed': { workId: ID; job?: Job };
  /** A background job ended as failed (not paused): S05b entry toast (G01 提示条). */
  'jobs.failed': { workId: ID; jobId: ID; chapterId: ID | null };
  'services.changed': {};
  'usage.changed': {};
  'prefs.changed': { key: string };
}

export type EventName = keyof EventMap;
type Handler<K extends EventName> = (payload: EventMap[K]) => void;

type AnyHandler = (payload: never) => void;
const handlers = new Map<EventName, Set<AnyHandler>>();

export function on<K extends EventName>(name: K, handler: Handler<K>): () => void {
  let set = handlers.get(name);
  if (!set) {
    set = new Set();
    handlers.set(name, set);
  }
  set.add(handler as AnyHandler);
  return () => {
    set.delete(handler as AnyHandler);
  };
}

/** Services call `emit` only after their transaction committed, so subscribers never read a half-written state. */
export function emit<K extends EventName>(name: K, payload: EventMap[K]): void {
  const set = handlers.get(name) as Set<Handler<K>> | undefined;
  set?.forEach(h => {
    try {
      h(payload);
    } catch (e) {
      console.warn(`[events] ${name} handler failed`, e);
    }
  });
}

/** Test helper. */
export function clearAllHandlers(): void {
  handlers.clear();
}
