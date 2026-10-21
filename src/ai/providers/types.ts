import type { AiErrorInfo, ISO, ModelService } from '../../features/types';

/** A function tool the model may call (OpenAI Responses `function`, Anthropic `tools`). */
export interface ToolSpec { name: string; description: string; parameters: object; }
/** One tool call returned by the model; `arguments` is the raw JSON text. */
export interface ToolCall { id: string; name: string; arguments: string; }
export interface ToolResult { callId: string; name: string; output: string; }
/**
 * A conversation turn. Plain turns only carry `content`. An assistant turn that asked for
 * tools carries `toolCalls` (and, for Anthropic, the exact content blocks to replay); the
 * following user turn carries `toolResults`.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  /** Protocol-specific assistant content to send back unchanged (thinking signatures, tool_use). */
  replay?: unknown[];
}

/** G03 §2.2.0. Credentials belong to the provider's private configuration snapshot. */
export interface GenerateRequest {
  system: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  effort?: 'low' | 'medium' | 'high';
  jsonSchema?: { name: string; schema: object };
  tools?: readonly ToolSpec[];
  /** 'none' forces a final answer while earlier tool turns stay valid. */
  toolChoice?: 'auto' | 'none';
  /** The system prompt to use if the service rejects tools (prefetch-only fallback). */
  toolsFallbackSystem?: string;
  stream: boolean;
  signal: AbortSignal;
}

/** input/output are totals; cache/reasoning fields are subsets, never added to those totals again. */
export type Usage = { input: number; output: number; cachedInput?: number; cacheWriteInput?: number;
  uncachedInput?: number; reasoningOutput?: number; incompleteInputTotal?: boolean };
export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'done'; text: string; model: string | null; usage: Usage | null; stop: 'end' | 'length' | 'refusal' | 'tool'; toolCalls?: ToolCall[]; replay?: unknown[] }
  | { type: 'error'; error: AiErrorInfo }
  | { type: 'cancelled' };

export interface Provider {
  generate(request: GenerateRequest): AsyncIterable<StreamEvent>;
  listModels(options: { signal: AbortSignal }): Promise<string[]>;
}

export interface TestResult {
  ok: boolean;
  at: ISO;
  latencyMs: number;
  modelCount: number | null;
  modelListed: boolean | null;
  models: string[] | null;
  responseModel: string | null;
  streaming: boolean | null;
  capsPatch: Partial<ModelService['options']['caps']>;
  error: AiErrorInfo | null;
}
