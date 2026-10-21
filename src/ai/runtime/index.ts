/** Bounded foreground writing execution. Each Provider.generate is exactly one physical POST. */
import { AiCallError, AppError } from '../../features/errors';
import type { AiErrorInfo, ModelService } from '../../features/types';
import { uuid } from '../../utils/id';
import type { ContextPlan } from '../context';
import { aiFailure, ProviderFailure, type ErrorContext } from '../providers/errors';
import type { AttemptEvidence } from '../providers/httpProvider';
import { RequestLifetime } from '../providers/lifecycle';
import type { ChatMessage, Provider, ToolCall, Usage } from '../providers/types';
import { normalizeWritingOutput } from '../tasks/writing';
export interface RequestBudget {
  logicalRequestId: string;
  plannedCalls: number;
  maxPhysicalPosts: number;
  maxOutputTokensPerAttempt: number;
  maxReservedOutputTokens: number;
  deadlineAt: number;
  estimatedCostCeiling: number | null;
  currency: string | null;
  /** Extra posts the operation reserved for bounded tool rounds (finalization conflict check). */
  maxToolRounds?: number;
}
export interface AttemptReservation {
  id: string;
  logicalRequestId: string;
  workId: string;
  task: string;
  policyVersion?: string;
  serviceId: string;
  serviceRevision: number;
  model: string;
  candidateIndex: number;
  attemptNumber: number;
  reason: 'initial' | 'retry' | 'effort_downgrade' | 'schema_downgrade' | 'tools_downgrade';
  startedAt: string;
  estimatedInputTokens: number;
  reservedOutputTokens: number;
}
export interface AttemptOutcome {
  attemptId: string;
  finishedAt: string;
  status: 'succeeded' | 'failed' | 'cancelled' | 'truncated' | 'refused';
  usage: Usage | null;
  errorCode: string | null;
  requestId: string | null;
  responseModel: string | null;
}
export interface AttemptLedger {
  /** Persist the reservation atomically before sending. Never do network/Key I/O in its transaction. */
  reserve(attempt: AttemptReservation, budget: Readonly<RequestBudget>): Promise<void>;
  /** A missing usage is unknown, including failures and cancellations, and never means zero cost. */
  settle(outcome: AttemptOutcome): Promise<void>;
}
export interface WritingCandidate {
  index: number;
  text: string;
  /** 'tool' only when the request offered tools and the model asked for some (see toolCalls). */
  stop: 'end' | 'length' | 'tool';
  error: AiErrorInfo | null;
  toolCalls?: ToolCall[];
  /** Protocol content to replay in the next assistant turn (Anthropic). */
  replay?: unknown[];
  /** The service rejected tools and this candidate was answered with the prefetch-only request. */
  toolsDropped?: boolean;
}
export interface WritingResult {
  logicalRequestId: string;
  planId: string;
  candidates: WritingCandidate[];
  capsPatch: Partial<ModelService['options']['caps']>;
}
export interface ExecuteWritingOptions {
  logicalRequestId: string;
  /** A child job has its own lifecycle while spending a persisted parent budget. */
  operationKey?: string;
  budgetCandidateOffset?: number;
  /** Already persisted child attempts; author resume cannot reset the child cap. */
  attemptNumberOffset?: number;
  plan: Readonly<ContextPlan>;
  budget?: Readonly<RequestBudget>;
  signal: AbortSignal;
  candidateSignals?: readonly AbortSignal[];
  providerFactory(evidence: AttemptEvidence, deadline: number): Provider;
  ledger: AttemptLedger;
  onText?(candidateIndex: number, delta: string): void;
  /** Waiting before automatic retry n of max (S09 "服务繁忙，正在重试（1/2）"); only before any prose arrived. */
  onRetry?(candidateIndex: number, retry: number, max: number): void;
  /**
   * One step of a bounded tool loop: turns appended after the planned messages and the tool
   * choice for this request. `withoutTools` sends the planned prefetch-only fallback instead.
   */
  conversation?: { turns: readonly ChatMessage[]; toolChoice: 'auto' | 'none'; withoutTools?: boolean };
}
export function createRequestBudget(logicalRequestId: string, plan: Readonly<ContextPlan>, overrides: Partial<Omit<RequestBudget, 'logicalRequestId' | 'plannedCalls'>> = {}): Readonly<RequestBudget> {
  const plannedCalls = plan.requests.length;
  const maxPhysicalPosts = Math.min(plannedCalls + 2, overrides.maxPhysicalPosts ?? plannedCalls + 2);
  const budget: RequestBudget = {
    logicalRequestId, plannedCalls, maxPhysicalPosts,
    maxOutputTokensPerAttempt: Math.min(plan.maxOutputTokens, overrides.maxOutputTokensPerAttempt ?? plan.maxOutputTokens),
    maxReservedOutputTokens: overrides.maxReservedOutputTokens ?? plan.maxOutputTokens * maxPhysicalPosts,
    deadlineAt: Math.min(Date.now() + 300000, overrides.deadlineAt ?? Infinity),
    estimatedCostCeiling: overrides.estimatedCostCeiling ?? null,
    currency: overrides.currency ?? null,
  };
  return Object.freeze(budget);
}
const budgetExceeded = () => new AppError('AI_BUDGET_EXCEEDED', '本次 AI 操作已达到请求或 token 预算，请调整范围或额度');
function errorContext(plan: Readonly<ContextPlan>): ErrorContext {
  const service = plan.serviceSnapshot;
  return { protocol: service.protocol, serviceName: service.name, model: service.model, baseUrl: service.baseUrl };
}
function cancelled(): AppError { return new AppError('AI_CANCELLED', '已停止生成'); }
function wait(delay: number, signal: AbortSignal): Promise<void> {
  if (delay === 0) return signal.aborted ? Promise.reject(cancelled()) : Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => { if (timer !== undefined) clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { release(); reject(cancelled()); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    timer = setTimeout(() => { release(); resolve(); }, delay);
  });
}
interface Subscriber { signal: AbortSignal; onText?: ExecuteWritingOptions['onText']; onRetry?: ExecuteWritingOptions['onRetry'] }
interface Inflight {
  fingerprint: string;
  controller: AbortController;
  promise: Promise<WritingResult>;
  subscribers: Map<symbol, Subscriber>;
}
const inflight = new Map<string, Inflight>();
/** Duplicate clicks share the same operation; every subscriber must stop before the shared request aborts. */
export function executeWritingPlan(options: ExecuteWritingOptions): Promise<WritingResult> {
  return execute(options, normalizeWritingOutput);
}
/** Structured/partner callers receive exact raw text and own local schema validation. */
export function executeTaskPlan(options: ExecuteWritingOptions): Promise<WritingResult> {
  return execute(options, text => text);
}
function execute(options: ExecuteWritingOptions, normalizeOutput: (text: string) => string): Promise<WritingResult> {
  if (options.signal.aborted) return Promise.reject(cancelled());
  const operationKey = options.operationKey ?? options.logicalRequestId;
  let operation = inflight.get(operationKey);
  if (operation && operation.fingerprint !== options.plan.dependencyFingerprint) return Promise.reject(new AppError('AI_RESULT_STALE', '同一操作的预览已改变，请重新预览'));
  if (!operation) {
    operation = { fingerprint: options.plan.dependencyFingerprint, controller: new AbortController(), promise: null as unknown as Promise<WritingResult>, subscribers: new Map() };
    const owned = operation;
    inflight.set(operationKey, owned);
    // Start after the subscription is installed, so a synchronous close cannot send a POST.
    const broadcast = (notify: (subscriber: Subscriber) => void) => {
      for (const subscriber of owned.subscribers.values()) {
        if (!subscriber.signal.aborted) {
          try { notify(subscriber); } catch { /* A view cannot change request execution. */ }
        }
      }
    };
    owned.promise = Promise.resolve().then(() => run(options, owned.controller.signal, normalizeOutput,
      (index, delta) => broadcast(subscriber => subscriber.onText?.(index, delta)),
      (index, retry, max) => broadcast(subscriber => subscriber.onRetry?.(index, retry, max)))).finally(() => { if (inflight.get(operationKey) === owned) inflight.delete(operationKey); });
  }
  const shared = operation;
  return new Promise((resolve, reject) => {
    const subscription = Symbol();
    const release = () => { options.signal.removeEventListener('abort', abort); shared.subscribers.delete(subscription); };
    const abort = () => {
      release();
      if (shared.subscribers.size === 0) shared.controller.abort();
      reject(cancelled());
    };
    shared.subscribers.set(subscription, { signal: options.signal, onText: options.onText, onRetry: options.onRetry });
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) { abort(); return; }
    shared.promise.then(result => { release(); resolve(result); }, error => { release(); reject(error); });
  });
}
async function run(options: ExecuteWritingOptions, signal: AbortSignal, normalizeOutput: (text: string) => string, onText: (index: number, delta: string) => void,
  onRetry: (index: number, retry: number, max: number) => void = () => {}): Promise<WritingResult> {
  const { plan } = options;
  const budget = options.budget ?? createRequestBudget(options.logicalRequestId, plan);
  if (!Number.isInteger(options.attemptNumberOffset ?? 0) || (options.attemptNumberOffset ?? 0) < 0 || (options.attemptNumberOffset ?? 0) > 3) throw budgetExceeded();
  if (!Number.isInteger(options.budgetCandidateOffset ?? 0) || (options.budgetCandidateOffset ?? 0) < 0 || (options.budgetCandidateOffset ?? 0) + plan.requests.length > budget.plannedCalls) throw budgetExceeded();
  if (budget.logicalRequestId !== options.logicalRequestId || budget.plannedCalls < plan.requests.length || !Number.isInteger(budget.maxPhysicalPosts) || budget.maxPhysicalPosts < 1 || budget.maxPhysicalPosts > budget.plannedCalls + 2 + Math.max(0, Math.min(8, budget.maxToolRounds ?? 0)) || budget.maxOutputTokensPerAttempt < plan.maxOutputTokens || budget.maxReservedOutputTokens < 0 || !Number.isFinite(budget.maxReservedOutputTokens) || !Number.isFinite(budget.deadlineAt)) throw budgetExceeded();
  const context = errorContext(plan);
  const deadline = Math.min(budget.deadlineAt, Date.now() + 300000);
  const lifetime = new RequestLifetime(signal, context, deadline, null);
  let posts = 0, reservedOutput = 0;
  const capsPatch: WritingResult['capsPatch'] = {};
  const check = () => { lifetime.check(); if (lifetime.failure) throw new AiCallError(lifetime.failure.info); };
  const candidate = async (index: number): Promise<WritingCandidate> => {
    const controller = new AbortController();
    const stop = () => controller.abort();
    lifetime.controller.signal.addEventListener('abort', stop, { once: true });
    const ownSignal = options.candidateSignals?.[index];
    ownSignal?.addEventListener('abort', stop, { once: true });
    if (lifetime.controller.signal.aborted || ownSignal?.aborted) stop();
    let text = '', stopReason: WritingCandidate['stop'] = 'end';
    let toolCalls: ToolCall[] | undefined, replay: unknown[] | undefined;
    let reason: AttemptReservation['reason'] = options.attemptNumberOffset ? 'retry' : 'initial';
    let effort = plan.requests[index].effort;
    let downgraded = false, schemaDowngraded = false, retries = 0;
    let schema = plan.requests[index].jsonSchema;
    const planned = plan.requests[index];
    const conversation = options.conversation;
    let tools = conversation?.withoutTools ? undefined : planned.tools;
    let toolsDropped = !!(conversation?.withoutTools && planned.tools);
    let system = toolsDropped && planned.toolsFallbackSystem !== undefined ? planned.toolsFallbackSystem : planned.system;
    try {
      for (let attemptNumber = (options.attemptNumberOffset ?? 0) + 1; attemptNumber <= 3; attemptNumber++) {
        check();
        if (controller.signal.aborted) throw new AiCallError(aiFailure('AI_CANCELLED', context).info);
        // Synchronous reservation stops concurrent children from spending the same last allowance.
        if (posts >= budget.maxPhysicalPosts || reservedOutput + plan.maxOutputTokens > budget.maxReservedOutputTokens) throw budgetExceeded();
        posts++; reservedOutput += plan.maxOutputTokens;
        const reservation: AttemptReservation = { id: uuid(), logicalRequestId: options.logicalRequestId, workId: plan.workId, task: plan.task, policyVersion: plan.policyVersion,
          serviceId: plan.serviceSnapshot.id, serviceRevision: plan.serviceSnapshot.revision, model: plan.serviceSnapshot.model,
          candidateIndex: index + (options.budgetCandidateOffset ?? 0), attemptNumber, reason, startedAt: new Date().toISOString(), estimatedInputTokens: plan.estimatedInputTokens, reservedOutputTokens: plan.maxOutputTokens };
        await options.ledger.reserve(reservation, budget);
        const evidence: AttemptEvidence = { streaming: null, failure: null };
        let failure: ProviderFailure | null = null;
        let usage: Usage | null = null, responseModel: string | null = null;
        let status: AttemptOutcome['status'] = 'failed';
        let requestId: string | null = null;
        try {
          check();
          if (controller.signal.aborted) throw aiFailure('AI_CANCELLED', context);
          const request = { ...plan.requests[index] };
          delete request.toolsFallbackSystem;
          let terminal = false;
          const messages = [...request.messages, ...(tools ? conversation?.turns ?? [] : [])].map(message => ({ ...message }));
          for await (const event of options.providerFactory(evidence, deadline).generate({ ...request, messages, tools, toolChoice: tools ? conversation?.toolChoice ?? request.toolChoice : undefined,
            effort, jsonSchema: schema, system, signal: controller.signal })) {
            if (event.type === 'text') { text += event.delta; onText(index, event.delta); }
            else if (event.type === 'done') {
              terminal = true; usage = event.usage; responseModel = event.model;
              if (event.stop === 'refusal') { status = 'refused'; failure = aiFailure('AI_REFUSAL', context); text = ''; }
              else {
                status = event.stop === 'length' ? 'truncated' : 'succeeded';
                // A tool stop is only meaningful when this request offered tools.
                stopReason = event.stop === 'tool' && !tools ? 'end' : event.stop;
                text = event.text;
                if (tools && event.toolCalls?.length) { toolCalls = event.toolCalls; replay = event.replay; }
                if (event.stop === 'length') failure = aiFailure('AI_TRUNCATED', context);
              }
              break;
            } else {
              terminal = true;
              failure = evidence.failure ?? (event.type === 'error' ? new ProviderFailure(event.error) : aiFailure('AI_CANCELLED', context));
              status = failure.info.code === 'AI_CANCELLED' ? 'cancelled' : 'failed';
              break;
            }
          }
          if (!terminal) failure = aiFailure(text ? 'AI_STREAM_INTERRUPTED' : 'AI_NETWORK', context);
        } catch (error) {
          failure = error instanceof ProviderFailure ? error : lifetime.failure ?? aiFailure(controller.signal.aborted ? 'AI_CANCELLED' : 'AI_NETWORK', context);
          status = failure.info.code === 'AI_CANCELLED' ? 'cancelled' : 'failed';
        } finally {
          usage ??= evidence.usage ?? null;
          requestId = failure?.info.requestId ?? null;
          await options.ledger.settle({ attemptId: reservation.id, finishedAt: new Date().toISOString(), status, usage,
            errorCode: failure?.info.code ?? null, requestId, responseModel });
          // Unknown usage keeps the entire conservative reservation, including cancelled requests.
          if (usage) reservedOutput += Math.max(0, usage.output) - plan.maxOutputTokens;
        }
        if (status === 'succeeded' || status === 'truncated' || status === 'refused') return { index, text: normalizeOutput(text), stop: stopReason, error: failure?.info ?? null,
          ...(toolCalls ? { toolCalls, ...(replay ? { replay } : {}) } : {}), ...(toolsDropped ? { toolsDropped } : {}) };
        failure ??= aiFailure('AI_NETWORK', context);
        check();
        if (controller.signal.aborted) throw new AiCallError(aiFailure('AI_CANCELLED', context).info);
        // Once prose exists, preserve it and never spend another automatic request.
        if (text || attemptNumber >= 3) return { index, text: normalizeOutput(text), stop: stopReason, error: failure.info };
        if (failure.unsupported === 'effort' && effort !== undefined && !downgraded) {
          downgraded = true; effort = undefined; capsPatch.effort = false; reason = 'effort_downgrade'; continue;
        }
        // Tools rejected before any tool turn: answer this chunk with the planned prefetch-only request.
        if (failure.unsupported === 'tools' && tools !== undefined && !conversation?.turns.length) {
          tools = undefined; toolsDropped = true; capsPatch.tools = false; reason = 'tools_downgrade';
          system = planned.toolsFallbackSystem ?? system;
          if (schemaDowngraded && schema === undefined && planned.jsonSchema) system = `${system}\n只输出一个 JSON 对象，不输出其他文字。Schema：${JSON.stringify(planned.jsonSchema.schema)}`;
          continue;
        }
        if (failure.unsupported === 'jsonSchema' && schema !== undefined && !schemaDowngraded) {
          schemaDowngraded = true; system = `${system}\n只输出一个 JSON 对象，不输出其他文字。Schema：${JSON.stringify(schema.schema)}`; schema = undefined; capsPatch.jsonSchema = false; reason = 'schema_downgrade'; continue;
        }
        if (!failure.shouldRetry || !['AI_RATE_LIMIT', 'AI_SERVER'].includes(failure.info.code) || retries >= 2) return { index, text: '', stop: stopReason, error: failure.info };
        const delay = failure.retryAfterMs ?? (retries === 0 ? 1000 : 3000);
        if (delay > 20000 || delay >= deadline - Date.now()) return { index, text: '', stop: stopReason, error: failure.info };
        retries++; reason = 'retry';
        onRetry(index, retries, 2);
        await wait(delay, controller.signal);
      }
      throw budgetExceeded();
    } catch (error) {
      if (error instanceof AiCallError) return { index, text: normalizeOutput(text), stop: stopReason, error: error.info };
      if (error instanceof AppError && error.code === 'AI_BUDGET_EXCEEDED') return { index, text: normalizeOutput(text), stop: stopReason, error: { ...aiFailure('AI_QUOTA', context).info, code: error.code, message: error.message } };
      if (error instanceof AppError && error.code === 'AI_CANCELLED') return { index, text: normalizeOutput(text), stop: stopReason, error: aiFailure('AI_CANCELLED', context).info };
      throw error;
    } finally {
      lifetime.controller.signal.removeEventListener('abort', stop);
      ownSignal?.removeEventListener('abort', stop);
    }
  };
  try {
    check();
    const candidates = await Promise.all(plan.requests.map((_, index) => candidate(index)));
    return { logicalRequestId: options.logicalRequestId, planId: plan.planId, candidates, capsPatch };
  } finally { lifetime.dispose(); }
}
