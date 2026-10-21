/**
 * Background maintenance of the history-passage index. Small batches with idle gaps,
 * only while the app is active, so opening an old work or typing never waits for a
 * full backfill. Queries never depend on this: stale chapters are rebuilt or scanned
 * on demand (features/passages).
 */
import { AppState } from 'react-native';
import { on } from '../features/events';
import { refreshWork } from '../features/passageIndex';
import type { ID } from '../features/types';

const BATCH_CHAPTERS = 4;
const IDLE_MS = 1500;

export function startPassageIndexer(options: { idleMs?: number; batchChapters?: number } = {}): () => void {
  const idle = options.idleMs ?? IDLE_MS;
  const batch = options.batchChapters ?? BATCH_CHAPTERS;
  const dirty = new Set<ID>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let disposed = false;
  let controller = new AbortController();
  const schedule = (delay = idle) => {
    if (disposed || timer || running || !dirty.size) return;
    timer = setTimeout(run, delay);
  };
  const mark = (workId: ID) => { dirty.add(workId); if (timer) { clearTimeout(timer); timer = null; } schedule(); };
  async function run() {
    timer = null;
    if (disposed || AppState.currentState !== 'active') return;
    const workId = dirty.values().next().value as ID | undefined;
    if (!workId) return;
    running = true;
    controller = new AbortController();
    try {
      const { remaining } = await refreshWork(workId, { maxChapters: batch, signal: controller.signal });
      if (!remaining) dirty.delete(workId);
    } catch {
      // Derived data only: a failed batch is retried on the next change; queries scan instead.
      dirty.delete(workId);
    } finally {
      running = false;
      schedule();
    }
  }
  const offs = [
    on('work.opened', e => mark(e.workId)),
    on('chapter.saved', e => mark(e.workId)),
    on('chapters.changed', e => mark(e.workId)),
    on('entries.changed', e => mark(e.workId)),
  ];
  const app = AppState.addEventListener('change', state => {
    if (state === 'active') schedule();
    else { controller.abort(); if (timer) { clearTimeout(timer); timer = null; } }
  });
  return () => { disposed = true; controller.abort(); if (timer) clearTimeout(timer); offs.forEach(off => off()); app.remove(); };
}
