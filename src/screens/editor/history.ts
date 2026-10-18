import type { Selection } from './indent';

interface Step {
  start: number;
  removed: string;
  inserted: string;
  before: Selection;
  after: Selection;
  at: number;
  merge: boolean;
}
const sameSelection = (a: Selection, b: Selection) =>
  a.start === b.start && a.end === b.end;

/** Compact text patches, bounded to 100 steps. Native IME input may merge within one second. */
export class EditHistory {
  private past: Step[] = [];
  private future: Step[] = [];
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  breakGroup() {
    const last = this.past[this.past.length - 1];
    if (last) {
      last.merge = false;
    }
  }

  record(
    old: string,
    next: string,
    before: Selection,
    after: Selection,
    at = Date.now(),
  ) {
    if (old === next) {
      return;
    }
    let start = 0;
    while (
      start < old.length &&
      start < next.length &&
      old[start] === next[start]
    ) {
      start++;
    }
    let tail = 0;
    while (
      tail < old.length - start &&
      tail < next.length - start &&
      old[old.length - tail - 1] === next[next.length - tail - 1]
    ) {
      tail++;
    }
    const removed = old.slice(start, old.length - tail);
    const inserted = next.slice(start, next.length - tail);
    const step: Step = {
      start,
      removed,
      inserted,
      before: { ...before },
      after: { ...after },
      at,
      merge:
        before.start === before.end &&
        !removed.includes('\n') &&
        !inserted.includes('\n') &&
        Math.max(removed.length, inserted.length) <= 2 &&
        (!removed || !inserted),
    };
    const prev = this.past[this.past.length - 1];
    if (
      step.merge &&
      prev?.merge &&
      at - prev.at < 1000 &&
      sameSelection(prev.after, before)
    ) {
      if (
        !removed &&
        !prev.removed &&
        start === prev.start + prev.inserted.length
      ) {
        prev.inserted += inserted;
        prev.after = step.after;
        prev.at = at;
        this.future = [];
        return;
      }
      if (
        !inserted &&
        !prev.inserted &&
        start + removed.length === prev.start
      ) {
        prev.start = start;
        prev.removed = removed + prev.removed;
        prev.after = step.after;
        prev.at = at;
        this.future = [];
        return;
      }
      if (!inserted && !prev.inserted && start === prev.start) {
        prev.removed += removed;
        prev.after = step.after;
        prev.at = at;
        this.future = [];
        return;
      }
    }
    this.past.push(step);
    if (this.past.length > 100) {
      this.past.shift();
    }
    this.future = [];
  }
  undo(body: string) {
    const step = this.past.pop();
    if (!step) {
      return null;
    }
    this.future.push(step);
    this.breakGroup();
    return {
      body:
        body.slice(0, step.start) +
        step.removed +
        body.slice(step.start + step.inserted.length),
      selection: step.before,
    };
  }
  redo(body: string) {
    const step = this.future.pop();
    if (!step) {
      return null;
    }
    this.past.push(step);
    return {
      body:
        body.slice(0, step.start) +
        step.inserted +
        body.slice(step.start + step.removed.length),
      selection: step.after,
    };
  }
}
