/** Wall-clock deadlines include time spent suspended in the background. */
import { AppState } from 'react-native';
import { aiFailure, type ErrorContext, type ProviderFailure } from './errors';

export class RequestLifetime {
  readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private subscription: { remove(): void };
  private due: number;
  private idleDue: number | null = null;
  private firstDue: number | null;
  private terminal = false;
  private disposed = false;
  failure: ProviderFailure | null = null;
  constructor(private readonly external: AbortSignal, private readonly context: ErrorContext, readonly deadline: number, firstByteMs: number | null = 60000, private readonly onDispose?: () => void) {
    this.due = deadline;
    this.firstDue = firstByteMs === null ? null : Date.now() + firstByteMs;
    external.addEventListener('abort', this.cancel, { once: true });
    this.subscription = AppState.addEventListener('change', state => { if (state === 'active') this.check(); });
    if (external.aborted) this.cancel();
    this.schedule();
  }
  readonly cancel = () => this.fail(aiFailure('AI_CANCELLED', this.context));
  private fail(failure: ProviderFailure) {
    if (this.terminal || this.failure) return;
    this.failure = failure;
    this.controller.abort();
    this.dispose();
  }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  check(): void {
    if (this.terminal || this.failure) return;
    const now = Date.now();
    if (now >= this.due || (this.firstDue !== null && now >= this.firstDue)) this.fail(aiFailure('AI_TIMEOUT', this.context));
    else if (this.idleDue !== null && now >= this.idleDue) this.fail(aiFailure('AI_STREAM_INTERRUPTED', this.context));
    else this.schedule();
  }
  private schedule() {
    this.clearTimer();
    if (this.terminal || this.failure) return;
    const due = Math.min(this.due, this.firstDue ?? Infinity, this.idleDue ?? Infinity);
    this.timer = setTimeout(() => this.check(), Math.max(0, due - Date.now()));
  }
  bytes(json: boolean) {
    this.check();
    if (this.failure || this.terminal) return;
    if (this.firstDue !== null) { this.firstDue = null; this.idleDue = Date.now() + 90000; }
    if (json) this.idleDue = Date.now() + 90000;
    this.schedule();
  }
  activity() {
    this.check();
    if (this.failure || this.terminal) return;
    this.idleDue = Date.now() + 90000;
    this.schedule();
  }
  settle(): boolean {
    this.check();
    if (this.failure || this.terminal) return false;
    this.terminal = true;
    this.dispose();
    return true;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.terminal = true;
    this.clearTimer();
    this.external.removeEventListener('abort', this.cancel);
    this.subscription.remove();
    this.controller.abort();
    this.onDispose?.();
  }
}
