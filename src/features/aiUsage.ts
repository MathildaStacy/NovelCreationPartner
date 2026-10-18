/** Content-free attempt ledger. Unknown usage/cost is never represented as zero. */
import { db } from '../data/db';
import { nowIso, uuid } from '../utils/id';
import { AppError } from './errors';
import { emit } from './events';
import type { ContextPlan } from '../ai/context';
import type { AttemptLedger, RequestBudget } from '../ai/runtime';

export async function begin(plan: ContextPlan, budget: RequestBudget, chapterId: string | null): Promise<void> {
  await db().transaction(async tx => {
    const existing = await tx.get('SELECT id FROM ai_requests WHERE id = ?', [budget.logicalRequestId]);
    if (existing) throw new AppError('CONFLICT_STATE', '这个操作已执行，请发起新操作。');
    await tx.run(`INSERT INTO ai_requests (id,work_id,chapter_id,task,policy_version,service_id,service_revision,model,
      planned_calls,max_posts,max_output_tokens,max_reserved_output,deadline_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [budget.logicalRequestId, plan.workId, chapterId, plan.task,
      plan.policyVersion, plan.serviceSnapshot.id, plan.serviceSnapshot.revision, plan.serviceSnapshot.model,
      budget.plannedCalls, budget.maxPhysicalPosts, budget.maxOutputTokensPerAttempt,
      budget.maxReservedOutputTokens, budget.deadlineAt, nowIso()]);
  });
}

export const ledger: AttemptLedger = {
  async reserve(attempt, budget) {
    await db().transaction(async tx => {
      if (await tx.get('SELECT id FROM ai_attempts WHERE id = ?', [attempt.id])) return;
      const request = await tx.get<{ physical_posts: number; reserved_output: number; max_posts: number; max_reserved_output: number; deadline_at: number; task: string }>(
        'SELECT * FROM ai_requests WHERE id = ?', [attempt.logicalRequestId]);
      if (!request) throw new AppError('CONFLICT_STATE', '请求预算不存在。');
      const child = await tx.get<{ n: number }>('SELECT count(*) n FROM ai_attempts WHERE request_id = ? AND candidate_index = ?', [attempt.logicalRequestId, attempt.candidateIndex]);
      if (Date.now() >= request.deadline_at || request.physical_posts >= Math.min(request.max_posts, budget.maxPhysicalPosts) ||
          Number(child?.n ?? 0) >= (request.task === 'connection_test' ? 4 : 3) || request.reserved_output + attempt.reservedOutputTokens > Math.min(request.max_reserved_output, budget.maxReservedOutputTokens)) {
        throw new AppError('AI_BUDGET_EXCEEDED', '本次请求已达到预算，请调整范围或额度。');
      }
      await tx.run(`INSERT INTO ai_attempts (id,request_id,candidate_index,ordinal,status,estimated_input,reserved_output,started_at)
        VALUES (?,?,?,?,'started',?,?,?)`, [attempt.id, attempt.logicalRequestId, attempt.candidateIndex,
        attempt.attemptNumber, attempt.estimatedInputTokens, attempt.reservedOutputTokens, attempt.startedAt]);
      await tx.run('UPDATE ai_requests SET physical_posts = physical_posts + 1, reserved_output = reserved_output + ? WHERE id = ?', [attempt.reservedOutputTokens, attempt.logicalRequestId]);
    });
    emit('usage.changed', {});
  },
  async settle(outcome) {
    await db().transaction(async tx => {
      const attempt = await tx.get<{ request_id: string; reserved_output: number; status: string }>('SELECT * FROM ai_attempts WHERE id = ?', [outcome.attemptId]);
      if (!attempt || attempt.status !== 'started') return;
      const valid = (n: number | undefined) => n !== undefined && Number.isFinite(n) && n >= 0 ? n : null;
      const input = valid(outcome.usage?.input);
      const output = valid(outcome.usage?.output);
      await tx.run(`UPDATE ai_attempts SET status = ?,actual_input = ?,actual_output = ?,ended_at = ?,error_code = ? WHERE id = ?`,
        [outcome.status, input, output, outcome.finishedAt, outcome.errorCode, outcome.attemptId]);
      // Missing usage remains conservatively reserved, including cancellation.
      if (output !== null) await tx.run('UPDATE ai_requests SET reserved_output = reserved_output - ? + ? WHERE id = ?', [attempt.reserved_output, output, attempt.request_id]);
    });
    emit('usage.changed', {});
  },
};

export async function markOutcome(requestId: string, outcome: 'adopted' | 'discarded'): Promise<void> {
  await db().run('UPDATE ai_requests SET outcome = ? WHERE id = ?', [outcome, requestId]);
  emit('usage.changed', {});
}

/** Crash recovery records uncertainty and never launches a replacement request. */
export async function recoverInterrupted(): Promise<void> {
  await db().run("UPDATE ai_attempts SET status = 'interrupted', ended_at = ?, error_code = 'AI_STREAM_INTERRUPTED' WHERE status = 'started'", [nowIso()]);
}

export async function summary(workId?: string): Promise<{ requests: number; attempts: number; input: number; output: number; unknown: number; cost: null }> {
  const where = workId ? 'WHERE r.work_id = ?' : '';
  const args = workId ? [workId] : [];
  const row = await db().get<{ requests: number; attempts: number; input: number; output: number; unknown: number }>(`SELECT
    count(DISTINCT r.id) requests, count(a.id) attempts,
    coalesce(sum(a.actual_input),0) input, coalesce(sum(a.actual_output),0) output,
    sum(CASE WHEN a.id IS NOT NULL AND (a.actual_input IS NULL OR a.actual_output IS NULL) THEN 1 ELSE 0 END) unknown
    FROM ai_requests r LEFT JOIN ai_attempts a ON a.request_id = r.id ${where}`, args);
  return { requests: Number(row?.requests ?? 0), attempts: Number(row?.attempts ?? 0), input: Number(row?.input ?? 0), output: Number(row?.output ?? 0), unknown: Number(row?.unknown ?? 0), cost: null };
}

/** Connection-test POSTs share the existing stricter 20s / ping64 / four-attempt gate. GETs are excluded. */
export async function connectionTestLedger(service: { id?: string; revision?: number; model: string }) {
  const id = uuid();
  const budget: RequestBudget = { logicalRequestId: id, plannedCalls: 1, maxPhysicalPosts: 4, maxOutputTokensPerAttempt: 64,
    maxReservedOutputTokens: 256, deadlineAt: Date.now() + 20000, estimatedCostCeiling: null, currency: null };
  await db().run(`INSERT INTO ai_requests (id,task,policy_version,service_id,service_revision,model,planned_calls,max_posts,max_output_tokens,max_reserved_output,deadline_at,created_at)
    VALUES (?,'connection_test','connection-test-1',?,?,?,1,4,64,256,?,?)`, [id, service.id ?? 'unsaved', service.revision ?? 0, service.model, budget.deadlineAt, nowIso()]);
  return {
    async begin(ordinal: number) {
      const attemptId = uuid();
      await ledger.reserve({ id: attemptId, logicalRequestId: id, workId: '', task: 'connection_test', serviceId: service.id ?? 'unsaved',
        serviceRevision: service.revision ?? 0, model: service.model, candidateIndex: 0, attemptNumber: ordinal,
        reason: ordinal === 1 ? 'initial' : 'retry', startedAt: nowIso(), estimatedInputTokens: 32, reservedOutputTokens: 64 }, budget);
      return attemptId;
    },
    async end(attemptId: string, result: { status: 'succeeded' | 'failed' | 'cancelled'; usage: import('../ai/providers/types').Usage | null; errorCode: string | null }) {
      await ledger.settle({ attemptId, finishedAt: nowIso(), ...result, requestId: null, responseModel: null });
    },
  };
}
