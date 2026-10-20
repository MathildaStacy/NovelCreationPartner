import { AppError } from '../../features/errors';

/**
 * Foreground concurrency (G03 §1: 前台请求同时最多 3 个；后台任务全局串行，两者互不占用名额).
 *
 * A logical foreground operation takes one slot per planned request before its
 * budget and deadline start, so time spent queued never shortens the request.
 * Waiters are served strictly first-in first-out; an aborted waiter leaves the
 * queue without sending anything or writing a ledger row.
 */
export interface Slots {
  /** Resolves with an idempotent release. `onQueued` runs once, only when the caller has to wait. */
  acquire(count: number, signal: AbortSignal, onQueued?: () => void): Promise<() => void>;
  readonly active: number;
  readonly waiting: number;
}

interface Waiter { count: number; signal: AbortSignal; grant(): void; abort(): void }

export function createSlots(limit: number): Slots {
  let active = 0;
  const queue: Waiter[] = [];
  const releaser = (count: number) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= count;
      pump();
    };
  };
  function pump() {
    while (queue.length && active + queue[0].count <= limit) {
      const next = queue.shift()!;
      active += next.count;
      next.grant();
    }
  }
  return {
    get active() { return active; },
    get waiting() { return queue.length; },
    acquire(requested, signal, onQueued) {
      const count = Math.max(1, Math.min(limit, Math.floor(requested) || 1));
      if (signal.aborted) return Promise.reject(new AppError('AI_CANCELLED', '已停止生成'));
      if (!queue.length && active + count <= limit) {
        active += count;
        return Promise.resolve(releaser(count));
      }
      return new Promise((resolve, reject) => {
        const waiter: Waiter = {
          count, signal,
          grant: () => { signal.removeEventListener('abort', waiter.abort); resolve(releaser(count)); },
          abort: () => {
            const at = queue.indexOf(waiter);
            if (at < 0) return;
            queue.splice(at, 1);
            reject(new AppError('AI_CANCELLED', '已停止生成'));
            // Removing the head can let smaller waiters behind it start.
            pump();
          },
        };
        queue.push(waiter);
        signal.addEventListener('abort', waiter.abort, { once: true });
        try { onQueued?.(); } catch { /* A view callback cannot change queueing. */ }
      });
    },
  };
}

/** Shared by every author-initiated request: S09 versions, S10 伙伴, S12c 补全. Background jobs do not use it. */
export const foregroundSlots = createSlots(3);
