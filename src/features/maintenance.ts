/** Startup housekeeping (G02 §10 steps 2–3). Each step is independent; a failure is logged and skipped. */
import { db } from '../data/db';
import * as jobs from './jobs';
import * as trash from './trash';
import { retryPendingCleanup } from './modelServices';

export async function runStartupMaintenance(log: (msg: string, e: unknown) => void = console.warn): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ['clean unused model keys', () => retryPendingCleanup()],
    ['purge trash', () => trash.purgeExpired()],
    ['recover jobs', () => jobs.recoverRunning()],
    ['stop streaming messages', () => db().run("UPDATE messages SET status = 'stopped' WHERE status = 'streaming'")],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (e) {
      log(`[startup] ${name} failed`, e);
    }
  }
}
