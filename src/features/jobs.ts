/**
 * Background jobs (G02 §5.10, §6). Phase 1 has no AI runner yet: only listing,
 * startup recovery and the queue's first check (no model service → paused) are
 * implemented, so jobs enqueued by finalize show a truthful state.
 */
import { db } from '../data/db';
import { nowIso } from '../utils/id';
import { emit } from './events';
import type { AiErrorInfo, ID, Job, JobKind, JobStatus, PauseReason } from './types';

interface JobRow {
  id: string;
  work_id: string;
  chapter_id: string | null;
  kind: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  pause_reason: string | null;
}

const toJob = (r: JobRow): Job => {
  let error: AiErrorInfo | null = null;
  if (r.last_error) {
    try {
      error = JSON.parse(r.last_error) as AiErrorInfo;
    } catch {
      error = null;
    }
  }
  return {
    id: r.id,
    workId: r.work_id,
    chapterId: r.chapter_id,
    kind: r.kind as JobKind,
    status: r.status as JobStatus,
    attempts: Number(r.attempts),
    error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    pauseReason: (r.pause_reason as PauseReason | null) ?? null,
  };
};

export const ACTIVE: JobStatus[] = ['queued', 'running', 'paused', 'failed'];

/** Queue order: created_at, then insert order. `active` keeps queued, running, paused and failed. */
export async function list(workId: ID, opts: { active?: boolean } = {}): Promise<Job[]> {
  const where = opts.active ? ` AND status IN (${ACTIVE.map(s => `'${s}'`).join(',')})` : '';
  const rows = await db().all<JobRow>(
    `SELECT * FROM jobs WHERE work_id = ?${where} ORDER BY created_at, rowid`,
    [workId],
  );
  return rows.map(toJob);
}

/** Startup (G02 §10 step 3): running → queued. */
export async function recoverRunning(): Promise<number> {
  const res = await db().run("UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running'", [nowIso()]);
  return res.changes;
}

/**
 * The queue's service check (G02 §6): with no model service, queued jobs of
 * live works become paused / no_service. Jobs of works in the trash are left
 * alone (the queue skips them). Returns the affected work IDs.
 */
export async function pauseWithoutService(): Promise<ID[]> {
  const affected: ID[] = [];
  await db().transaction(async tx => {
    const svc = await tx.get('SELECT id FROM model_services LIMIT 1');
    if (svc) {
      return;
    }
    const rows = await tx.all<{ work_id: string }>(
      `SELECT DISTINCT j.work_id FROM jobs j JOIN works w ON w.id = j.work_id
       WHERE j.status = 'queued' AND w.deleted_at IS NULL`,
    );
    if (rows.length === 0) {
      return;
    }
    await tx.run(
      `UPDATE jobs SET status = 'paused', pause_reason = 'no_service', updated_at = ?
       WHERE status = 'queued' AND work_id IN (SELECT id FROM works WHERE deleted_at IS NULL)`,
      [nowIso()],
    );
    affected.push(...rows.map(r => r.work_id));
  });
  affected.forEach(workId => emit('jobs.changed', { workId }));
  return affected;
}
