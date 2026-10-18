import { isAppError } from '../../features/errors';

export type SaveStatus = 'saved' | 'saving' | 'failed';

/** One writer per editor. flush drains edits arriving during a write before resolving. */
export class Autosave<T> {
  body: string;
  cursor: number;
  status: SaveStatus = 'saved';
  private savedBody: string;
  private savedCursor: number;
  private debounce?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private running: Promise<void> | null = null;
  private disposed = false;
  private error: unknown = null;
  private lastSuccess = Date.now();

  constructor(
    body: string,
    cursor: number,
    private save: (body: string, cursor: number) => Promise<T>,
    private changed: (status: SaveStatus, result?: T, error?: unknown) => void,
  ) {
    this.body = this.savedBody = body;
    this.cursor = this.savedCursor = cursor;
  }
  private publish(status: SaveStatus, result?: T, error?: unknown) {
    this.status = status;
    if (!this.disposed) {
      this.changed(status, result, error);
    }
  }
  edit(body: string, cursor: number) {
    if (this.disposed) {
      return;
    }
    this.body = body;
    this.cursor = cursor;
    if (this.debounce) {
      clearTimeout(this.debounce);
    }
    if (body === this.savedBody && !this.running) {
      this.clearTimers();
      this.publish('saved');
      return;
    }
    // DB errors require an explicit retry; storage errors retry at ten-second intervals.
    if (this.error && !isAppError(this.error, 'STORAGE_FULL')) {
      this.publish('failed');
      return;
    }
    this.publish(this.error ? 'failed' : 'saving');
    if (!this.error) {
      this.debounce = setTimeout(() => {
        this.flush().catch(() => {});
      }, 2000);
    }
    this.ensureDeadline();
  }
  private ensureDeadline() {
    if (!this.deadline) {
      const delay = this.error
        ? 10_000
        : Math.max(0, 10_000 - (Date.now() - this.lastSuccess));
      this.deadline = setTimeout(() => {
        this.deadline = undefined;
        this.flush().catch(() => {});
      }, delay);
    }
  }
  private clearTimers() {
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = undefined;
    }
    if (this.deadline) {
      clearTimeout(this.deadline);
      this.deadline = undefined;
    }
  }
  async flush(): Promise<void> {
    this.clearTimers();
    if (this.disposed) {
      return;
    }
    if (this.running) {
      await this.running;
      if (
        !this.disposed &&
        (this.body !== this.savedBody || this.cursor !== this.savedCursor)
      ) {
        await this.flush();
      }
      return;
    }
    const write = async () => {
      // Force one write even if unchanged: last_cursor must persist on leaving/backgrounding.
      do {
        const body = this.body;
        const cursor = this.cursor;
        this.publish('saving');
        try {
          const result = await this.save(body, cursor);
          this.savedBody = body;
          this.savedCursor = cursor;
          this.error = null;
          this.lastSuccess = Date.now();
          this.publish(
            this.body === body ? 'saved' : 'saving',
            this.body === body ? result : undefined,
          );
        } catch (e) {
          this.error = e;
          this.publish('failed', undefined, e);
          if (!this.disposed && isAppError(e, 'STORAGE_FULL')) {
            this.ensureDeadline();
          }
          throw e;
        }
      } while (
        !this.disposed &&
        (this.body !== this.savedBody || this.cursor !== this.savedCursor)
      );
      this.clearTimers();
    };
    this.running = write();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }
  dispose() {
    this.disposed = true;
    this.clearTimers();
  }
}
