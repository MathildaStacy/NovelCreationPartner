import { AppError } from '../../features/errors';
import type { ModelService } from '../../features/types';
import type { GenerateRequest } from '../providers/types';
import { candidateInstruction, WRITING_POLICIES, writingDirectInput, writingOutputBudget, writingSystem, type TaskPolicy, type WritingInput, type WritingTask } from '../tasks/writing';
import { fingerprint, stableSerialize } from './fingerprint';
export { fingerprint, stableSerialize } from './fingerprint';
export type { WritingInput, WritingTask } from '../tasks/writing';
export interface ServiceSnapshot extends Pick<ModelService, 'id' | 'name' | 'protocol' | 'baseUrl' | 'model' | 'options'> {
  revision: number;
  pricingVersion: string | null;
}
export interface ContextBlock {
  sourceId: string;
  sourceVersion: string;
  state: string;
  atChapterId: string | null;
  text: string;
  required: boolean;
  /** G03 lower number is higher priority. Stable source IDs break ties. */
  priority?: number;
}
export type PlannedRequest = Omit<GenerateRequest, 'signal'>;
export interface ContextPlan {
  readonly planId: string;
  readonly workId: string;
  readonly task: string;
  readonly sourceVersion: string;
  readonly dependencyFingerprint: string;
  readonly serviceSnapshot: ServiceSnapshot;
  readonly policyVersion: string;
  readonly policy: Readonly<TaskPolicy>;
  readonly blocks: readonly Readonly<ContextBlock>[];
  readonly serializedRequest: string;
  readonly requests: readonly Readonly<PlannedRequest>[];
  readonly estimatedInputTokens: number;
  readonly maxOutputTokens: number;
  readonly omittedReasons: readonly { sourceId: string; reason: 'outside_reference_scope' | 'optional_budget' }[];
}
export interface ContextPlanInput {
  planId: string;
  workId: string;
  sourceVersion: string;
  dependencies: Record<string, string | number | null>;
  serviceSnapshot: ServiceSnapshot;
  task: WritingTask;
  input: WritingInput;
  blocks: readonly ContextBlock[];
  count?: 1 | 2 | 3;
  contextWindowTokens?: number;
  variantOffset?: number;
}
export function estimateTokens(text: string): number {
  let eastAsian = 0, other = 0;
  for (const character of text) {
    if (/[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\u3040-\u30ff]/u.test(character)) eastAsian++;
    else other++;
  }
  return Math.ceil((eastAsian + other / 4) * 1.3);
}
function freeze<T>(object: T): T {
  if (object && typeof object === 'object') {
    Object.values(object).forEach(freeze);
    Object.freeze(object);
  }
  return object;
}
export function createContextPlan(input: ContextPlanInput): Readonly<ContextPlan> {
  const count = input.count ?? 1;
  if (![1, 2, 3].includes(count)) throw new AppError('VALIDATION', '候选数量应为 1–3');
  const policy = WRITING_POLICIES[input.task];
  const snapshot = input.serviceSnapshot;
  // Explicit whitelist: never capture Key, hasKey, or arbitrary caller fields.
  const service: ServiceSnapshot = { id: snapshot.id, revision: snapshot.revision, name: snapshot.name, protocol: snapshot.protocol, baseUrl: snapshot.baseUrl, model: snapshot.model,
    options: { maxOutputTokens: snapshot.options.maxOutputTokens, effort: snapshot.options.effort, authHeader: snapshot.options.authHeader, store: snapshot.options.store, contextBudget: snapshot.options.contextBudget, caps: { ...snapshot.options.caps } }, pricingVersion: snapshot.pricingVersion };
  const maxOutputTokens = service.options.maxOutputTokens ?? writingOutputBudget(input.task, input.input);
  const hardLimit = Math.min(service.options.contextBudget, input.contextWindowTokens === undefined ? Infinity : input.contextWindowTokens - maxOutputTokens - 128);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || !Number.isFinite(hardLimit) || hardLimit < 1) throw new AppError('AI_CONTEXT_TOO_LONG', '当前服务的输入或输出额度不足');
  const system = writingSystem(input.task, input.input);
  const direct = writingDirectInput(input.input);
  const omittedReasons: { sourceId: string; reason: 'outside_reference_scope' | 'optional_budget' }[] = [];
  const references = new Set(input.input.referenceIds ?? []);
  const blocks = input.blocks.filter(block => {
    if (input.task === 'describe' && (block.priority ?? 4) === 4 && !references.has(block.sourceId)) {
      if (block.required) throw new AppError('VALIDATION', '必需参考不在作者选择的范围内');
      omittedReasons.push({ sourceId: block.sourceId, reason: 'outside_reference_scope' }); return false;
    }
    return true;
  }).map(block => ({ ...block })).sort((a, b) => (a.priority ?? 4) - (b.priority ?? 4) || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
  const requestFor = (included: ContextBlock[], index: number): PlannedRequest => ({
    system,
    messages: [{ role: 'user', content: [
      ...included.map(block => `【参考 ${block.sourceId}；状态 ${block.state}；截至章节 ${block.atChapterId ?? '全局'}】\n${block.text}`),
      direct, `【本候选切入点】${candidateInstruction((index + (input.variantOffset ?? 0)) % 3)}`,
    ].join('\n\n') }],
    maxOutputTokens,
    effort: service.options.caps.effort === false ? undefined : service.options.effort === 'default' ? policy.defaultEffort : service.options.effort,
    stream: true,
  });
  // Estimate the exact planned request including protocol overhead; never count via a model call.
  const estimate = (included: ContextBlock[]) => Math.max(...Array.from({ length: count }, (_, index) => estimateTokens(stableSerialize(requestFor(included, index))) + 128));
  const included = blocks.filter(block => block.required);
  if (estimate(included) > hardLimit) throw new AppError('AI_CONTEXT_TOO_LONG', '必要上下文超过服务额度，请缩小范围；明确选择的参考不会自动删减');
  const softLimit = Math.min(policy.targetInputTokens, hardLimit);
  for (const block of blocks.filter(item => !item.required)) {
    if (estimate([...included, block]) <= softLimit) included.push(block);
    else omittedReasons.push({ sourceId: block.sourceId, reason: 'optional_budget' });
  }
  included.sort((a, b) => (a.priority ?? 4) - (b.priority ?? 4) || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
  const requests = Array.from({ length: count }, (_, index) => requestFor(included, index));
  const serializedRequest = stableSerialize(requests);
  const dependencyFingerprint = fingerprint({ workId: input.workId, sourceVersion: input.sourceVersion, dependencies: input.dependencies, task: input.task,
    policy, service, blocks, directInput: input.input, variantOffset: input.variantOffset ?? 0, serializedRequest, contextWindowTokens: input.contextWindowTokens ?? null });
  return freeze({ planId: input.planId, workId: input.workId, task: input.task, sourceVersion: input.sourceVersion, dependencyFingerprint, serviceSnapshot: service,
    policyVersion: policy.contextPolicyVersion, policy, blocks: included, serializedRequest, requests,
    estimatedInputTokens: estimate(included), maxOutputTokens, omittedReasons });
}


export interface TaskContextPlanInput {
  planId: string;
  workId: string;
  sourceVersion: string;
  dependencies: Record<string, string | number | null>;
  serviceSnapshot: ServiceSnapshot;
  policy: TaskPolicy;
  system: string;
  messages: PlannedRequest['messages'];
  blocks: readonly ContextBlock[];
  schema?: PlannedRequest['jsonSchema'];
  stream?: boolean;
  contextWindowTokens?: number;
}
/** Generic single-call plan for partner/structured tasks; policy is owned by its actual task. */
export function createTaskContextPlan(input: TaskContextPlanInput): Readonly<ContextPlan> {
  const snapshot = input.serviceSnapshot;
  const service: ServiceSnapshot = { id: snapshot.id, revision: snapshot.revision, name: snapshot.name, protocol: snapshot.protocol, baseUrl: snapshot.baseUrl, model: snapshot.model,
    options: { maxOutputTokens: snapshot.options.maxOutputTokens, effort: snapshot.options.effort, authHeader: snapshot.options.authHeader, store: snapshot.options.store, contextBudget: snapshot.options.contextBudget, caps: { ...snapshot.options.caps } }, pricingVersion: snapshot.pricingVersion };
  const policy = { ...input.policy };
  const maxOutputTokens = service.options.maxOutputTokens ?? policy.defaultMaxOutputTokens;
  const hardLimit = Math.min(service.options.contextBudget, input.contextWindowTokens === undefined ? Infinity : input.contextWindowTokens - maxOutputTokens - 128);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || !Number.isFinite(hardLimit) || hardLimit < 1 || !input.messages.length) throw new AppError('AI_CONTEXT_TOO_LONG', '当前任务的输入或输出额度不足');
  const blocks = input.blocks.map(block => ({ ...block })).sort((a, b) => (a.priority ?? 4) - (b.priority ?? 4) || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
  const requestFor = (included: ContextBlock[]): PlannedRequest => {
    const messages = input.messages.map(message => ({ ...message }));
    const refs = included.map(block => `【参考 ${block.sourceId}；状态 ${block.state}；截至章节 ${block.atChapterId ?? '全局'}】\n${block.text}`).join('\n\n');
    const lastUser = messages.map(message => message.role).lastIndexOf('user');
    if (lastUser < 0) throw new AppError('VALIDATION', '任务缺少作者的直接输入');
    if (refs) messages[lastUser].content = `${refs}\n\n${messages[lastUser].content}`;
    const promptFallback = input.schema !== undefined && service.options.caps.jsonSchema === false;
    const system = promptFallback ? `${input.system}\n只输出一个 JSON 对象，不输出其他文字。Schema：${JSON.stringify(input.schema!.schema)}` : input.system;
    return { system, messages, maxOutputTokens, effort: service.options.caps.effort === false ? undefined : service.options.effort === 'default' ? policy.defaultEffort : service.options.effort,
      stream: input.stream ?? true, ...(input.schema && !promptFallback ? { jsonSchema: JSON.parse(JSON.stringify(input.schema)) as NonNullable<PlannedRequest['jsonSchema']> } : {}) };
  };
  const estimate = (included: ContextBlock[]) => estimateTokens(stableSerialize(requestFor(included))) + 128;
  const included = blocks.filter(block => block.required);
  if (estimate(included) > hardLimit) throw new AppError('AI_CONTEXT_TOO_LONG', '必要上下文超过服务额度，请缩小范围；明确选择的参考不会自动删减');
  const omittedReasons: ContextPlan['omittedReasons'][number][] = [];
  for (const block of blocks.filter(item => !item.required)) {
    if (estimate([...included, block]) <= Math.min(policy.targetInputTokens, hardLimit)) included.push(block);
    else omittedReasons.push({ sourceId: block.sourceId, reason: 'optional_budget' });
  }
  included.sort((a, b) => (a.priority ?? 4) - (b.priority ?? 4) || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
  const requests = [requestFor(included)];
  const serializedRequest = stableSerialize(requests);
  const dependencyFingerprint = fingerprint({ workId: input.workId, sourceVersion: input.sourceVersion, dependencies: input.dependencies, task: policy.task,
    policy, service, blocks, messages: input.messages, serializedRequest, contextWindowTokens: input.contextWindowTokens ?? null });
  return freeze({ planId: input.planId, workId: input.workId, task: policy.task, sourceVersion: input.sourceVersion, dependencyFingerprint, serviceSnapshot: service,
    policyVersion: policy.contextPolicyVersion, policy, blocks: included, serializedRequest, requests, estimatedInputTokens: estimate(included), maxOutputTokens, omittedReasons });
}
