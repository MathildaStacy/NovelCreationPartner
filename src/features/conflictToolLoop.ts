/**
 * Bounded history补查 for one conflict-check chunk (phase 2).
 *
 * The planned request is sent with `search_passages` / `read_passage`; the App executes
 * calls against the chunk's fixed PassageSession (work, chapters before this one, temp
 * refs) and sends results back. Limits: at most `maxToolRoundsPerChunk` tool rounds and
 * `maxRequestsPerChunk` model requests per chunk (retries included — the ledger's
 * per-candidate cap), plus the operation-wide tool rounds / result characters stored on
 * `ai_requests`. Every round is persisted before the next request, so cancel and resume
 * continue from the saved turns and never reset a budget. A service that rejects tools
 * falls back to the planned prefetch-only request.
 */
import { executeTaskPlan, type ExecuteWritingOptions, type RequestBudget } from '../ai/runtime';
import type { ContextPlan } from '../ai/context';
import type { ChatMessage, ToolResult } from '../ai/providers/types';
import type { AnalysisSource } from '../ai/tasks/finalization';
import { formatPassages, parseToolCall, READ_TOOL, type ToolLoopLimits } from '../ai/retrieval/tools';
import { AiCallError, AppError } from './errors';
import * as jobs from './jobs';
import type { ToolBudgetState, ToolLoopState } from './jobs';
import { PassageSession, readPassage, searchPassages, SEARCH_LIMITS, type PassageRecord } from './passages';
import { record } from './passageMetrics';
import type { ID } from './types';
import * as usage from './aiUsage';

export interface ToolChunkInput {
  jobId: ID;
  token: string;
  operationId: ID;
  chunkId: ID;
  candidateOffset: number;
  plan: Readonly<ContextPlan>;
  budget: Readonly<RequestBudget>;
  baseSources: readonly AnalysisSource[];
  limits: Readonly<ToolLoopLimits>;
  /** Saved progress (resume) or the session prepared at preview time. */
  state: ToolLoopState;
  /** Fresh attempt count and shared tool budget, read from the database before each request. */
  current(): Promise<{ attempts: number; tools: ToolBudgetState }>;
  signal: AbortSignal;
  providerFactory: ExecuteWritingOptions['providerFactory'];
}
export interface ToolChunkResult { text: string; sources: AnalysisSource[]; rounds: number; toolsDropped: boolean; }

const EXHAUSTED = '补查额度已用完，本次未执行。请根据已有材料直接给出最终 JSON，材料不足时标为 suspected 并说明检查限制。';
const sourceOf = (passage: PassageRecord, entryIds: readonly string[] = passage.entryIds): AnalysisSource => ({
  id: passage.ref, label: `${passage.label}原文`, text: passage.text, entryId: entryIds.length === 1 ? entryIds[0] : null,
  passage: { chapterId: passage.chapterId, start: passage.start, end: passage.end, sourceHash: passage.sourceHash, versionId: passage.versionId, label: passage.label },
});

export async function runToolChunk(input: ToolChunkInput): Promise<ToolChunkResult> {
  const state: ToolLoopState = { ...input.state, turns: [...input.state.turns], sources: [...input.state.sources] };
  let chunkChars = state.turns.reduce((n, turn) => n + (turn.toolResults ?? []).reduce((m, result) => m + result.output.length, 0), 0);
  for (;;) {
    if (input.signal.aborted) throw new AppError('AI_CANCELLED', '已停止分析');
    const { attempts, tools } = await input.current();
    if (attempts >= input.limits.maxRequestsPerChunk) throw new AppError('AI_BUDGET_EXCEEDED', '该请求块的补查请求次数已用尽，请重新预览并确认后分析。');
    const opCharsLeft = tools.maxResultChars - tools.resultChars;
    // The last allowed request of this chunk is always the final judgement.
    const final = !!state.fallback || state.rounds >= input.limits.maxToolRoundsPerChunk || input.limits.maxRequestsPerChunk - attempts <= 1
      || tools.rounds >= tools.maxRounds || opCharsLeft < 200 || input.limits.maxResultCharsPerChunk - chunkChars < 200;
    const generated = await executeTaskPlan({ logicalRequestId: input.operationId, operationKey: `${input.chunkId}:${state.rounds}`, budgetCandidateOffset: input.candidateOffset,
      attemptNumberOffset: attempts, plan: input.plan, budget: input.budget, signal: input.signal, providerFactory: input.providerFactory, ledger: usage.ledger,
      conversation: state.fallback ? { turns: [], toolChoice: 'none', withoutTools: true } : { turns: state.turns, toolChoice: final ? 'none' : 'auto' } });
    const candidate = generated.candidates[0];
    if (candidate.error) throw new AiCallError(candidate.error);
    if (candidate.toolsDropped && !state.fallback) {
      state.fallback = true;
      await jobs.recordToolRound(input.jobId, input.token, input.chunkId, state, 0, false);
    }
    if (candidate.stop !== 'tool' || !candidate.toolCalls?.length) {
      return { text: candidate.text, sources: [...input.baseSources, ...state.sources], rounds: state.rounds, toolsDropped: !!state.fallback };
    }
    if (final) throw new AppError('AI_FORMAT', '补查次数用尽后模型仍在请求工具，未写入冲突列表。');
    const started = Date.now();
    const session = new PassageSession(state.session);
    const results: ToolResult[] = [];
    let used = 0;
    for (const [index, call] of candidate.toolCalls.entries()) {
      const left = Math.min(input.limits.maxResultCharsPerCall, input.limits.maxResultCharsPerChunk - chunkChars - used, opCharsLeft - used);
      let output: string;
      if (index >= input.limits.maxCallsPerRound) output = `本轮最多执行 ${input.limits.maxCallsPerRound} 个工具调用，这一个未执行。`;
      else if (left < 200) output = EXHAUSTED;
      else {
        const parsed = parseToolCall(call.name, call.arguments);
        if ('error' in parsed) output = parsed.error;
        else {
          try {
            if (parsed.name === READ_TOOL) {
              const passage = await readPassage(session, parsed.args, { maxReadChars: Math.min(SEARCH_LIMITS.maxReadChars, left - 120) });
              const formatted = formatPassages([{ ref: passage.ref, label: passage.label, text: passage.text }], left);
              output = formatted.text;
              if (formatted.included.length) state.sources.push(sourceOf(passage));
            } else {
              const limit = Math.min(parsed.args.limit ?? input.limits.maxResultsPerCall, input.limits.maxResultsPerCall);
              const found = await searchPassages(session, { ...parsed.args, limit }, { limits: { maxResults: limit, maxChars: Math.max(0, left - 160) } });
              const note = found.unknownEntities.length ? `未识别的条目：${found.unknownEntities.join('、')}（只能按本作品的条目 ID、名称或别名检索）。` : '';
              const formatted = formatPassages(found.passages.map(passage => ({ ref: passage.ref, label: passage.label, text: passage.text })), left, note);
              output = formatted.text;
              const included = new Set(formatted.included.map(passage => passage.ref));
              for (const passage of found.passages) if (included.has(passage.ref) && !state.sources.some(source => source.id === passage.ref)) state.sources.push(sourceOf(passage, passage.matchedEntryIds));
            }
          } catch (error) {
            if (!(error instanceof AppError) || !['VALIDATION', 'AI_RESULT_STALE', 'NOT_FOUND'].includes(error.code)) throw error;
            output = error.message;
          }
        }
      }
      used += output.length;
      results.push({ callId: call.id, name: call.name, output });
    }
    const assistant: ChatMessage = { role: 'assistant', content: candidate.text, toolCalls: candidate.toolCalls.map(call => ({ ...call })), ...(candidate.replay ? { replay: candidate.replay } : {}) };
    state.turns.push(assistant, { role: 'user', content: '', toolResults: results });
    state.rounds++;
    state.session = session.toJSON();
    // Persist the round and charge the shared budget before the next request is sent.
    if (!await jobs.recordToolRound(input.jobId, input.token, input.chunkId, state, used, true)) throw new AppError('AI_BUDGET_EXCEEDED', '本次定稿的补查额度已用尽，请重新预览并确认后分析。');
    chunkChars += used;
    record({ kind: 'tool_round', ms: Date.now() - started, results: state.sources.length });
  }
}
