/** Writing facade: only features read authoritative data and apply author decisions. */
import { db, type Db } from '../data/db';
import { createContextPlan, estimateTokens, fingerprint, stableSerialize, type ContextBlock, type ContextPlan, type PlannedRequest } from '../ai/context';
import { createRequestBudget, executeWritingPlan, type WritingResult } from '../ai/runtime';
import { uuid, nowIso } from '../utils/id';
import { countChars } from '../utils/text';
import { AppError } from './errors';
import * as chapters from './chapters';
import * as works from './works';
import * as entries from './entries';
import { getTaskService } from './taskServices';
import * as modelServices from './modelServices';
import * as prefs from './prefs';
import * as usage from './aiUsage';
import { archiveContextBlocks } from './archiveContext';
import { emit } from './events';

export type QuickOp = 'rewrite' | 'expand' | 'shorten' | 'polish' | 'detail';
export interface WritingAction {
  chapterId: string;
  range: { start: number; end: number };
  task: 'describe' | 'quickEdit';
  op?: QuickOp;
  types?: string[];
  style?: string;
  extra?: string;
  referenceIds?: string[];
  count?: 1 | 2 | 3;
  variantOffset?: number;
}
interface Captured { action: WritingAction; body: string; dependencies: string; }
const captured = new WeakMap<ContextPlan, Captured>();
const active = new Map<string, { plan: ContextPlan; promise: Promise<WritingResult> }>();

/** Conservative local dependency fingerprint includes deletion, ordering and all formal changes. Never exported/logged. */
async function dependencyStamp(workId: string): Promise<string> {
  return db().transaction(tx => dependencyStampIn(tx, workId));
}
async function dependencyStampIn(q: Db, workId: string): Promise<string> {
  return fingerprint({
    work: await q.get('SELECT * FROM works WHERE id = ?', [workId]),
    volumes: await q.all('SELECT * FROM volumes WHERE work_id = ? ORDER BY id', [workId]),
    chapters: await q.all('SELECT id, volume_id, order_index, title, body, summary, deleted_at, finalized_version_id FROM chapters WHERE work_id = ? ORDER BY id', [workId]),
    entries: await q.all('SELECT * FROM entries WHERE work_id = ? ORDER BY id', [workId]),
    facts: await q.all('SELECT f.* FROM entry_facts f JOIN entries e ON e.id = f.entry_id WHERE e.work_id = ? ORDER BY f.id', [workId]),
    relations: await q.all('SELECT * FROM relations WHERE work_id = ? ORDER BY id', [workId]),
    conflicts: await q.all('SELECT * FROM conflicts WHERE work_id = ? ORDER BY id', [workId]),
  });
}

export async function suggestReferences(chapterId: string, range: WritingAction['range']) {
  const ch = await chapters.get(chapterId);
  return entries.findMentions(ch.workId, ch.body.slice(Math.max(0, range.start - 1500), range.end + 1500), { atChapterId: chapterId });
}

export async function prepareWriting(input: WritingAction): Promise<ContextPlan> {
  const action: WritingAction = { ...input, range: { ...input.range }, types: input.types && [...input.types], referenceIds: input.referenceIds && [...input.referenceIds] };
  const ch = await chapters.get(action.chapterId);
  const { start, end } = action.range;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > ch.body.length ||
      countChars(ch.body.slice(start, end)) > 2000 || (action.task === 'quickEdit' && start === end)) {
    throw new AppError('VALIDATION', '请选择 1–2000 字进行改写，或在光标处生成描写。');
  }
  if (action.referenceIds && (action.referenceIds.length > 8 || new Set(action.referenceIds).size !== action.referenceIds.length)) throw new AppError('VALIDATION', '最多选择 8 个不同参考条目。');
  const service = await getTaskService('writing');
  if (!service) throw new AppError('NO_SERVICE', '请先连接模型服务。');
  const detail = await modelServices.get(service.id);
  if (!detail.hasKey) throw new AppError('KEY_UNAVAILABLE', '请先填写模型服务的 API Key。');
  const stamp = await dependencyStamp(ch.workId);
  const work = await works.get(ch.workId);
  const left = Math.max(0, start - 1500);
  const right = Math.min(ch.body.length, end + 1500);
  const before = ch.body.slice(left === 0 ? 0 : ch.body.indexOf('\n', left) >= start || ch.body.indexOf('\n', left) < 0 ? left : ch.body.indexOf('\n', left) + 1, start);
  const lastBreak = ch.body.lastIndexOf('\n', right);
  const after = ch.body.slice(end, right === ch.body.length || lastBreak < end ? right : lastBreak);
  const references = action.task === 'describe' ? action.referenceIds ?? [] :
    (await entries.findMentions(ch.workId, before + ch.body.slice(start, end) + after, { atChapterId: ch.id })).map(item => item.entryId);
  const blocks: ContextBlock[] = [{ sourceId: `work:${work.id}`, sourceVersion: work.updatedAt, state: 'CONFIRMED', atChapterId: ch.id,
    text: `作品：${work.title ?? '未命名'}\n灵感：${work.premise}\n文风：${work.styleNote ?? '遵循正文'}`, required: true, priority: 3 }];
  try { blocks.push(...await archiveContextBlocks(ch.workId, references, { atChapterId: ch.id })); }
  catch (error) { if (error instanceof AppError && error.code === 'NOT_FOUND') throw new AppError('AI_RESULT_STALE', '所选参考已变化，请调整范围并重新预览。'); throw error; }
  if (stamp !== await dependencyStamp(ch.workId) || ch.body !== (await chapters.get(ch.id)).body) throw new AppError('AI_RESULT_STALE', '内容已变化，请重新预览。');
  const plan = createContextPlan({ planId: uuid(), workId: ch.workId, sourceVersion: fingerprint(ch.body), dependencies: { snapshot: stamp, chapterId: ch.id },
    serviceSnapshot: { ...detail, pricingVersion: null }, task: action.task,
    input: { selection: ch.body.slice(start, end), before, after, mode: start === end ? 'insert' : 'replace',
      op: action.op, types: action.types, style: action.style, extra: action.extra, referenceIds: references },
    blocks, count: action.count ?? await prefs.get('candidateCount'), variantOffset: action.variantOffset });
  captured.set(plan, { action, body: ch.body, dependencies: stamp });
  return plan;
}

export async function noticeHost(plan: ContextPlan): Promise<string | null> {
  const host = new URL(plan.serviceSnapshot.baseUrl).host.toLowerCase();
  return (await prefs.get('aiNoticeAcknowledged'))[host] ? null : host;
}
export async function acknowledgeHost(host: string): Promise<void> {
  await prefs.set('aiNoticeAcknowledged', { ...await prefs.get('aiNoticeAcknowledged'), [host.toLowerCase()]: nowIso() });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
/** A new immutable plan from requests of an already previewed plan; it keeps the same captured body and dependencies. */
async function derivePlan(plan: ContextPlan, requests: PlannedRequest[], kind: 'retry' | 'continue'): Promise<ContextPlan> {
  const source = captured.get(plan);
  if (!source) throw new AppError('AI_RESULT_STALE', '编辑会话已结束，请重新定位。');
  if (source.dependencies !== await dependencyStamp(plan.workId)) throw new AppError('AI_RESULT_STALE', '作品内容已变化，请重新预览。');
  const copies = requests.map(request => JSON.parse(JSON.stringify(request)) as PlannedRequest);
  const serializedRequest = stableSerialize(copies);
  const estimatedInputTokens = Math.max(...copies.map(request => estimateTokens(stableSerialize(request)) + 128));
  if (estimatedInputTokens > plan.serviceSnapshot.options.contextBudget) throw new AppError('AI_CONTEXT_TOO_LONG', '已生成的内容加上原有上下文超过服务额度，请先插入或复制这一版。');
  const derived: ContextPlan = deepFreeze({ ...plan, planId: uuid(), requests: copies, serializedRequest, estimatedInputTokens,
    dependencyFingerprint: fingerprint({ base: plan.dependencyFingerprint, kind, serializedRequest }) });
  captured.set(derived, source);
  return derived;
}
/** S09 #10 重试: exactly the request the author already previewed for that version, as a new logical operation. */
export function prepareRetry(plan: ContextPlan, index: number): Promise<ContextPlan> {
  const request = plan.requests[index];
  if (!request) return Promise.reject(new AppError('VALIDATION', '这个版本不存在。'));
  return derivePlan(plan, [request], 'retry');
}
export const CONTINUE_INSTRUCTION = '【续写要求】上一轮输出因长度上限或连接中断停在中途。请从上文最后一个字之后直接接着写，不重复已写内容，不加标题或解释。';
/** S09 继续生成 (G03 §3): the generated prose goes back as the previous assistant turn; new text is appended by the caller. */
export function prepareContinuation(plan: ContextPlan, index: number, text: string): Promise<ContextPlan> {
  const request = plan.requests[index];
  if (!request || !text.trim()) return Promise.reject(new AppError('VALIDATION', '没有可以续写的内容。'));
  return derivePlan(plan, [{ ...request, messages: [...request.messages, { role: 'assistant', content: text }, { role: 'user', content: CONTINUE_INSTRUCTION }] }], 'continue');
}

export function generateWriting(plan: ContextPlan, options: { logicalRequestId?: string; signal: AbortSignal; candidateSignals?: readonly AbortSignal[]; confirmedHost?: string;
  onText?: (index: number, delta: string) => void; onRetry?: (index: number, retry: number, max: number) => void }): Promise<WritingResult> {
  const id = options.logicalRequestId ?? plan.planId;
  const previous = active.get(id);
  if (previous) {
    if (previous.plan !== plan) return Promise.reject(new AppError('CONFLICT_STATE', '操作编号不能用于不同内容。'));
    return previous.promise;
  }
  const promise = (async () => {
    const source = captured.get(plan);
    if (!source) throw new AppError('AI_RESULT_STALE', '请重新打开预览。');
    if (options.signal.aborted) throw new AppError('AI_CANCELLED', '已停止生成。');
    if (source.dependencies !== await dependencyStamp(plan.workId)) throw new AppError('AI_RESULT_STALE', '作品内容已变化，请重新预览。');
    const host = await noticeHost(plan);
    if (host && options.confirmedHost !== host) throw new AppError('CONFLICT_STATE', '发送前需要确认 AI 数据说明。');
    return modelServices.withGeneration(plan.serviceSnapshot.id, plan.serviceSnapshot.revision, options.signal, async scope => {
      const budget = createRequestBudget(id, plan);
      await usage.begin(plan, budget, source.action.chapterId);
      const result = await executeWritingPlan({ logicalRequestId: id, plan, budget, signal: scope.signal, candidateSignals: options.candidateSignals,
        providerFactory: scope.providerFactory, ledger: usage.ledger, onText: options.onText, onRetry: options.onRetry });
      if (source.dependencies !== await dependencyStamp(plan.workId)) throw new AppError('AI_RESULT_STALE', '作品设定或冲突在生成期间已变化，请重新预览。');
      return result;
    });
  })();
  active.set(id, { plan, promise });
  promise.finally(() => { if (active.get(id)?.promise === promise) active.delete(id); }).catch(() => {});
  return promise;
}

export async function applyWriting(plan: ContextPlan, text: string): Promise<{ body: string; cursor: number }> {
  const source = captured.get(plan);
  if (!source) throw new AppError('AI_RESULT_STALE', '编辑会话已结束，请重新定位。');
  const result = await db().transaction(async tx => {
    if (source.dependencies !== await dependencyStampIn(tx, plan.workId)) throw new AppError('AI_RESULT_STALE', '作品设定或冲突已变化，请重新预览后再插入。');
    return chapters.applyAiTextIn(tx, source.action.chapterId, { ...source.action.range, text,
      mode: source.action.range.start === source.action.range.end ? 'insert' : 'replace', expectedBody: source.body });
  });
  emit('versions.changed', { chapterId: source.action.chapterId });
  emit('chapter.saved', { chapterId: source.action.chapterId, workId: result.workId, charCount: result.charCount, state: result.state });
  await usage.markOutcome(plan.planId, 'adopted').catch(() => {});
  return { body: result.body, cursor: result.cursor };
}
