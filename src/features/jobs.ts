/** Durable finalization queue: bound versions, shared budgets and guarded commits (G04 §8). */
import { db, type Db } from '../data/db';
import { nowIso, uuid } from '../utils/id';
import { fingerprint } from '../ai/context';
import { FINALIZATION_POLICIES, finalizationSystem } from '../ai/tasks/finalization';
import type { ContextPlan } from '../ai/context';
import type { PlannedAnalysisChunk } from './finalizationPlans';
import { pruneFinalizationStorageIn } from './finalizationPlans';
import type { RequestBudget } from '../ai/runtime';
import { AppError, notFound } from './errors';
import { emit } from './events';
import * as chapters from './chapters';
import * as works from './works';
import * as modelServices from './modelServices';
import type { AiErrorInfo, ID, Job, JobKind, JobStatus, PauseReason } from './types';
export interface JobRow {
  id: string; work_id: string; chapter_id: string | null; kind: JobKind; status: JobStatus; attempts: number;
  last_error: string | null; created_at: string; updated_at: string; pause_reason: PauseReason | null;
  source_version_id: string | null; input_fingerprint: string | null; dependency_revision: number | null;
  service_id: string | null; service_revision: number | null; policy_version: string | null;
  execution_token: string | null; operation_id: string | null; candidate_offset: number; summary_before: string | null; plan_id:string|null;chunk_count:number;completed_chunks:number;
}
function toJob(r: JobRow): Job {
  let error: AiErrorInfo | null = null;
  try { error = r.last_error ? JSON.parse(r.last_error) : null; } catch { /* old invalid error */ }
  return { id: r.id, workId: r.work_id, chapterId: r.chapter_id, kind: r.kind, status: r.status, attempts: r.attempts,
    error, createdAt: r.created_at, updatedAt: r.updated_at, pauseReason: r.pause_reason,
    sourceVersionId: r.source_version_id, inputFingerprint: r.input_fingerprint, dependencyRevision: r.dependency_revision,
    serviceId: r.service_id, serviceRevision: r.service_revision, policyVersion: r.policy_version,
    executionToken: r.execution_token, operationId: r.operation_id, candidateOffset: r.candidate_offset,totalChunks:r.chunk_count,completedChunks:r.completed_chunks };
}
export const ACTIVE: JobStatus[] = ['queued', 'running', 'paused', 'failed'];
export async function list(workId: ID, options: { active?: boolean } = {}): Promise<Job[]> {
  const where = options.active ? " AND status IN ('queued','running','paused','failed')" : '';
  const rows=await db().all<JobRow>(`SELECT * FROM jobs WHERE work_id = ?${where} ORDER BY created_at,rowid`,[workId]);
  return rows.map(toJob);
}

/** Full local dependency digest; summaries after this chapter cannot leak backwards. */
export async function inputFingerprintIn(tx: Db, workId: string, chapterId: string, versionId: string,previewBody?:string): Promise<string> {
  const order = await chapters.listNumbered(tx, workId);
  const index = order.findIndex(ch => ch.id === chapterId);
  if (index < 0) throw notFound('章节');
  const row = await tx.get<{ context_revision: number }>('SELECT context_revision FROM works WHERE id = ? AND deleted_at IS NULL', [workId]);
  if (!row) throw notFound('作品');
  const version = previewBody===undefined?await tx.get<{ body: string }>('SELECT body FROM chapter_versions WHERE id = ? AND chapter_id = ?', [versionId, chapterId]):{body:previewBody};
  if (!version) throw notFound('定稿版本');
  return fingerprint({ revision: row.context_revision, versionId, body: version.body,
    summaries: order.slice(Math.max(0, index - 3), index).map(ch => ({ id: ch.id, summary: ch.summary })),
    policies:FINALIZATION_POLICIES,systems:Object.fromEntries(Object.keys(FINALIZATION_POLICIES).map(kind=>[kind,finalizationSystem(kind as JobKind)])) });
}

/** Running requests with any send evidence remain interrupted, never automatically billed again. */
export async function recoverRunning(): Promise<number> {
  return db().transaction(async tx => {
    const rows = await tx.all<JobRow>("SELECT * FROM jobs WHERE status='running'");
    for (const row of rows) {
      const pending=await tx.get<{candidate_offset:number}>("SELECT candidate_offset FROM job_chunks WHERE job_id=? AND status!='done' ORDER BY chunk_index LIMIT 1",[row.id]);
      const chunks=await tx.get<{n:number}>('SELECT count(*) n FROM job_chunks WHERE job_id=?',[row.id]);
      const sent = !(Number(chunks?.n)>0&&!pending)&&row.operation_id && await tx.get('SELECT id FROM ai_attempts WHERE request_id = ? AND candidate_index = ? LIMIT 1', [row.operation_id, pending?.candidate_offset??row.candidate_offset]);
      const legacy = !row.source_version_id || !row.input_fingerprint;
      const reason = legacy ? 'legacy_input' : sent ? 'interrupted' : !row.service_id ? 'no_service' : !await validIn(tx, row) ? 'stale' : null;
      await tx.run('UPDATE jobs SET status=?,pause_reason=?,execution_token=NULL,updated_at=? WHERE id=?',
        [reason ? 'paused' : 'queued', reason, nowIso(), row.id]);
    }
    return rows.length;
  });
}
export async function pauseWithoutService(): Promise<ID[]> {
  const affected: ID[] = [];
  await db().transaction(async tx => {
    if (await tx.get('SELECT id FROM model_services LIMIT 1')) return;
    const rows = await tx.all<{ work_id: string }>("SELECT DISTINCT j.work_id FROM jobs j JOIN works w ON w.id=j.work_id WHERE j.status='queued' AND w.deleted_at IS NULL");
    await tx.run("UPDATE jobs SET status='paused',pause_reason='no_service',updated_at=? WHERE status='queued' AND work_id IN (SELECT id FROM works WHERE deleted_at IS NULL)", [nowIso()]);
    affected.push(...rows.map(r => r.work_id));
  });
  affected.forEach(workId => emit('jobs.changed', { workId })); return affected;
}

async function validIn(tx: Db, row: JobRow): Promise<boolean> {
  if (!row.chapter_id || !row.source_version_id || !row.input_fingerprint || !row.operation_id || !row.service_id) return false;
  const ch = await tx.get<{ finalized_version_id: string }>(`SELECT c.finalized_version_id FROM chapters c JOIN works w ON w.id=c.work_id WHERE c.id=? AND c.work_id=? AND c.deleted_at IS NULL AND c.state='finalized' AND w.deleted_at IS NULL`, [row.chapter_id, row.work_id]);
  const svc = await tx.get<{ revision: number }>('SELECT revision FROM model_services WHERE id=?', [row.service_id]);
  return ch?.finalized_version_id === row.source_version_id && svc?.revision === row.service_revision &&
    row.input_fingerprint === await inputFingerprintIn(tx, row.work_id, row.chapter_id, row.source_version_id);
}
export async function claim(id: ID): Promise<Job | null> {
  let workId = '';let changed=false;
  const job = await db().transaction(async tx => {
    const row = await tx.get<JobRow>('SELECT * FROM jobs WHERE id=?', [id]);
    if (!row || row.status !== 'queued') return null;
    workId = row.work_id;
    const pause = async (reason: PauseReason) => {changed=true;await tx.run("UPDATE jobs SET status='paused',pause_reason=?,execution_token=NULL,updated_at=? WHERE id=?", [reason, nowIso(), id]); return null; };
    if (!row.source_version_id || !row.input_fingerprint) return pause('legacy_input');
    if (!row.service_id || !await tx.get('SELECT id FROM model_services WHERE id=?', [row.service_id])) return pause('no_service');
    if (!await validIn(tx, row)) return pause('stale');
    const svc = await tx.get<{ has_key: number; base_url: string }>('SELECT has_key,base_url FROM model_services WHERE id=?', [row.service_id!]);
    if (!svc?.has_key) return pause('no_key');
    const notice = await tx.get<{ value: string }>("SELECT value FROM preferences WHERE key='aiNoticeAcknowledged'");
    let hosts: Record<string, string> = {};
    try { hosts = JSON.parse(notice?.value ?? '{}'); } catch { /* remain unacknowledged */ }
    if (!hosts[new URL(svc.base_url).host.toLowerCase()]) return pause('notice');
    const earlier = await tx.get("SELECT id FROM jobs WHERE operation_id=? AND rowid<(SELECT rowid FROM jobs WHERE id=?) AND status!='done' AND NOT(kind='extract_memory' AND status='cancelled')", [row.operation_id!, row.id]);
    if (earlier) return null;
    const budget = await tx.get<{ deadline_at: number; physical_posts: number; max_posts: number;planned_calls:number }>('SELECT * FROM ai_requests WHERE id=?', [row.operation_id!]);
    const pending=await tx.get("SELECT id FROM job_chunks WHERE job_id=? AND status!='done' LIMIT 1",[id]);
    if (!budget || pending&&budget.physical_posts >= budget.max_posts) return pause('budget');
    // A deadline starts when the first confirmed job claims, not while waiting offline.
    if (pending&&!budget.physical_posts && budget.deadline_at === 0) await tx.run('UPDATE ai_requests SET deadline_at=? WHERE id=?', [Date.now() + Math.min(5*budget.planned_calls,30) * 60000, row.operation_id!]);
    else if (pending&&budget.deadline_at <= Date.now()) return pause('budget');
    const token = uuid();
    await tx.run("UPDATE jobs SET status='running',pause_reason=NULL,execution_token=?,attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'", [token, nowIso(), id]);
    changed=true;
    return toJob({ ...row, status: 'running', pause_reason: null, execution_token: token, attempts: row.attempts + 1 });
  });
  if (workId&&changed) emit('jobs.changed', { workId }); return job;
}
export async function claimNext(): Promise<Job | null> {
  const rows = await db().all<{ id: string }>("SELECT j.id FROM jobs j JOIN works w ON w.id=j.work_id WHERE j.status='queued' AND w.deleted_at IS NULL ORDER BY j.created_at,j.rowid");
  for (const row of rows) { const job = await claim(row.id); if (job) return job; }
  return null;
}
export async function capture(id: ID) {
  const row = await db().transaction(async tx => {
    const r = await tx.get<JobRow>('SELECT * FROM jobs WHERE id=?', [id]);
    if (!r || r.status !== 'running' || !await validIn(tx, r)) throw new AppError('AI_RESULT_STALE', '定稿任务依赖已变化。');
    const budget = await tx.get<{ planned_calls: number; max_posts: number; max_output_tokens: number; max_reserved_output: number; deadline_at: number }>('SELECT * FROM ai_requests WHERE id=?', [r.operation_id!]);
    const version = await tx.get<{ body: string }>('SELECT body FROM chapter_versions WHERE id=?', [r.source_version_id!]);
    if (!budget || !version) throw notFound('任务输入');
    const requestBudget: RequestBudget = { logicalRequestId: r.operation_id!, plannedCalls: budget.planned_calls, maxPhysicalPosts: budget.max_posts,
      maxOutputTokensPerAttempt: budget.max_output_tokens, maxReservedOutputTokens: budget.max_reserved_output, deadlineAt: budget.deadline_at, estimatedCostCeiling: null, currency: null };
    const chunks=await tx.all<{id:string;chunk_index:number;candidate_offset:number;context_plan:string;analysis_context:string;status:string;result:string|null}>('SELECT * FROM job_chunks WHERE job_id=? ORDER BY chunk_index',[id]);
    const decoded=await Promise.all(chunks.map(async chunk=>{
      const attempts=await tx.get<{n:number;first_started_at:string|null}>('SELECT count(*) n,min(started_at) first_started_at FROM ai_attempts WHERE request_id=? AND candidate_index=?',[r.operation_id!,chunk.candidate_offset]);
      return {id:chunk.id,index:chunk.chunk_index,candidateOffset:chunk.candidate_offset,plan:JSON.parse(chunk.context_plan) as ContextPlan,
        context:JSON.parse(chunk.analysis_context) as Omit<PlannedAnalysisChunk,'index'|'contextPlan'>,status:chunk.status,result:chunk.result?JSON.parse(chunk.result):null,
        attempts:Number(attempts?.n??0),firstStartedAt:attempts?.first_started_at??null};
    }));
    return { job: toJob(r), sourceVersionBody: version.body, summaryBefore: r.summary_before, budget: requestBudget,chunks:decoded,childAttempts:decoded.find(c=>c.status!=='done')?.attempts??0 };
  });
  return { ...row, chapter: await chapters.get(row.job.chapterId!), work: await works.get(row.job.workId), service: await modelServices.get(row.job.serviceId!) };
}
/** Only validated chunk output is checkpointed; incomplete jobs never publish derived business results. */
export async function checkpoint(id:ID,token:string,chunkId:ID,result:unknown):Promise<void> {
  await db().transaction(async tx=>{
    const row=await tx.get<JobRow>('SELECT * FROM jobs WHERE id=?',[id]);
    if(!row||row.status!=='running'||row.execution_token!==token||!await validIn(tx,row))throw new AppError('AI_RESULT_STALE','分块结果已过期，未保存。');
    const updated=await tx.run("UPDATE job_chunks SET status='done',result=?,last_used_at=? WHERE id=? AND job_id=? AND status='pending'",[JSON.stringify(result),nowIso(),chunkId,id]);
    if(updated.changes)await tx.run('UPDATE jobs SET completed_chunks=completed_chunks+1 WHERE id=?',[id]);
  });
}
/** Callback writes verified derived data; this guard and completion share one transaction. */
export async function commit(id: ID, token: string, write: (tx: Db) => Promise<void>): Promise<void> {
  let row!: JobRow;
  await db().transaction(async tx => {
    const found = await tx.get<JobRow>('SELECT * FROM jobs WHERE id=?', [id]);
    if (!found || found.status !== 'running' || found.execution_token !== token || !await validIn(tx, found)) throw new AppError('AI_RESULT_STALE', '定稿已变化，旧结果未写入。');
    row = found;
    await write(tx);
    await tx.run("UPDATE jobs SET status='done',execution_token=NULL,pause_reason=NULL,last_error=NULL,updated_at=? WHERE id=?", [nowIso(), id]);
    await pruneFinalizationStorageIn(tx);
  });
  emit('jobs.changed', { workId: row.work_id });
  emit('chapters.changed', { workId: row.work_id });
  if (row.kind === 'extract_memory') emit('proposals.changed', { workId: row.work_id });
  if (row.kind === 'detect_conflicts') emit('conflicts.changed', { workId: row.work_id });
}
export async function fail(id: ID, token: string, error: AiErrorInfo | null, options: { interrupted?: boolean; reason?: PauseReason } = {}): Promise<void> {
  let workId = '';
  await db().transaction(async tx => {
    const row = await tx.get<JobRow>("SELECT * FROM jobs WHERE id=? AND status='running' AND execution_token=?", [id, token]);
    if (!row) return; workId = row.work_id;
    const pause = options.reason ?? (options.interrupted ? 'interrupted' : null);
    await tx.run('UPDATE jobs SET status=?,pause_reason=?,execution_token=NULL,last_error=?,updated_at=? WHERE id=?', [pause ? 'paused' : 'failed', pause, error ? JSON.stringify(error) : null, nowIso(), id]);
  });
  if (workId) emit('jobs.changed', { workId });
}
export async function cancel(id: ID): Promise<void> {
  const row = await db().get<JobRow>('SELECT * FROM jobs WHERE id=?', [id]);
  if (!row) throw notFound('任务');
  await db().run("UPDATE jobs SET status='cancelled',execution_token=NULL,updated_at=? WHERE id=? AND status!='done'", [nowIso(), id]);
  emit('jobs.changed', { workId: row.work_id });
}
/** Resume never upgrades legacy inputs or clears spent parent budgets. Interrupted retry requires explicit author intent. */
export async function resume(id: ID, options: { confirmInterrupted?: boolean } = {}): Promise<void> {
  let workId = '';
  await db().transaction(async tx => {
    const row = await tx.get<JobRow>('SELECT * FROM jobs WHERE id=?', [id]);
    if (!row) throw notFound('任务'); workId = row.work_id;
    if (!['paused', 'failed'].includes(row.status)) return;
    if (!row.source_version_id || row.pause_reason === 'legacy_input') throw new AppError('CONFLICT_STATE', '旧任务没有绑定输入，请重新确认定稿。');
    if (row.pause_reason === 'interrupted' && !options.confirmInterrupted) throw new AppError('CONFLICT_STATE', '中断请求可能已计费，请确认后再重试。');
    if (!await validIn(tx, row)) throw new AppError('AI_RESULT_STALE', '请重新定稿以使用最新内容。');
    if (row.pause_reason === 'budget') throw new AppError('AI_BUDGET_EXCEEDED', '请缩小范围并重新确认定稿，原预算不能自动扩大。');
    await tx.run("UPDATE jobs SET status='queued',pause_reason=NULL,last_error=NULL,updated_at=? WHERE id=?", [nowIso(), id]);
  });
  if (workId) emit('jobs.changed', { workId });
}
