import type { Protocol } from '../../features/types';
import { aiFailure, normalizeHttpError, ProviderFailure, safeResponseScalar, type ErrorContext } from './errors';
import type { SseFrame } from './sse';
import type { StreamEvent, ToolCall, Usage } from './types';

type ObjectValue = Record<string, unknown>;
type Stop = Extract<StreamEvent, { type: 'done' }>['stop'];
export interface ResponseMetadata { status?: number; headers?: Record<string, string> }
export interface ParsedResponse { events: StreamEvent[]; failure: ProviderFailure | null; usage: Usage | null }
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const openaiEvents = new Set([
  'response.created', 'response.in_progress', 'response.queued', 'response.completed', 'response.incomplete', 'response.failed',
  'response.output_text.delta', 'response.output_text.done', 'response.refusal.delta', 'response.refusal.done',
  'response.content_part.added', 'response.content_part.done', 'response.output_item.added', 'response.output_item.done',
  'response.reasoning_summary_text.delta', 'response.reasoning_summary_text.done', 'response.reasoning_text.delta', 'response.reasoning_text.done',
  'response.reasoning_summary_part.added', 'response.reasoning_summary_part.done', 'response.usage', 'response.model',
]);
const anthropicEvents = new Set(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop', 'ping']);

class ResponseState {
  text = '';
  model: string | null = null;
  refusal = false;
  /** Function/tool calls of the final response, in output order. */
  toolCalls: ToolCall[] = [];
  /** Anthropic assistant content blocks to send back unchanged in the next turn. */
  replay: unknown[] = [];
  private input: number | null = null;
  private output: number | null = null;
  private cachedInput: number | undefined;
  private cacheWriteInput: number | undefined;
  private reasoningOutput: number | undefined;
  private anthropicCacheReported = false;

  constructor(readonly context: ErrorContext, private readonly response: ResponseMetadata = {}) {}

  invalid(): never { throw aiFailure('AI_PROTOCOL_MISMATCH', this.context); }

  readModel(value: unknown): void {
    if (value === undefined || value === null) { return; }
    if (typeof value !== 'string') { this.invalid(); }
    this.model = safeResponseScalar(value, this.context, 'model');
  }

  readUsage(value: unknown): void {
    if (value === undefined || value === null) { return; }
    if (!object(value)) { this.invalid(); }
    if (value.input_tokens !== undefined) {
      if (!count(value.input_tokens)) { this.invalid(); }
      this.input = value.input_tokens;
    }
    if (value.output_tokens !== undefined) {
      if (!count(value.output_tokens)) { this.invalid(); }
      this.output = value.output_tokens;
    }
    const detail = (container: unknown, key: string): number | undefined => {
      if (container === undefined || container === null) return undefined;
      if (!object(container)) return this.invalid();
      const item = container[key];
      if (item === undefined || item === null) return undefined;
      if (!count(item)) return this.invalid();
      return item;
    };
    if (this.context.protocol === 'openai_responses') {
      if (value.input_tokens !== undefined) this.cachedInput = detail(value.input_tokens_details, 'cached_tokens');
      if (value.output_tokens !== undefined) this.reasoningOutput = detail(value.output_tokens_details, 'reasoning_tokens');
      if (this.cachedInput !== undefined && this.input !== null && this.cachedInput > this.input ||
        this.reasoningOutput !== undefined && this.output !== null && this.reasoningOutput > this.output) this.invalid();
    } else {
      for (const [key, assign] of [
        ['cache_read_input_tokens', (n: number) => { this.cachedInput = n; }],
        ['cache_creation_input_tokens', (n: number) => { this.cacheWriteInput = n; }],
      ] as const) {
        if (value[key] !== undefined && value[key] !== null) {
          if (!count(value[key])) this.invalid();
          assign(value[key]); this.anthropicCacheReported = true;
        }
      }
    }
  }

  get usage(): Usage | null {
    if (this.input === null || this.output === null) return null;
    const anthropic = this.context.protocol === 'anthropic_messages';
    const completeCache = this.cachedInput !== undefined && this.cacheWriteInput !== undefined;
    const input = anthropic && completeCache ? this.input + this.cachedInput! + this.cacheWriteInput! : this.input;
    if (!Number.isSafeInteger(input)) return null;
    return { input, output: this.output,
      ...(this.cachedInput === undefined ? {} : { cachedInput: this.cachedInput }),
      ...(this.cacheWriteInput === undefined ? {} : { cacheWriteInput: this.cacheWriteInput }),
      ...(this.reasoningOutput === undefined ? {} : { reasoningOutput: this.reasoningOutput }),
      ...(anthropic && this.anthropicCacheReported ? { uncachedInput: this.input, ...(!completeCache ? { incompleteInputTotal: true } : {}) } : {}),
    };
  }

  append(text: unknown): StreamEvent[] {
    if (typeof text !== 'string') { this.invalid(); }
    this.text += text;
    return text ? [{ type: 'text', delta: text }] : [];
  }

  done(stop: Stop): StreamEvent {
    const final = this.refusal ? 'refusal' : stop;
    // A tool stop needs at least one call; calls alongside a normal end are still returned to the caller.
    if (final === 'tool' && !this.toolCalls.length) { this.invalid(); }
    const tools = this.toolCalls.length && final !== 'refusal' ? { toolCalls: this.toolCalls.map(call => ({ ...call })), ...(this.replay.length ? { replay: this.replay.slice() } : {}) } : {};
    return { type: 'done', text: this.text, model: this.model, usage: this.usage, stop: final, ...tools };
  }

  /** Validates one function call; ids and names are short scalars, arguments stay raw JSON text. */
  toolCall(id: unknown, name: unknown, args: unknown): void {
    if (typeof id !== 'string' || !id || id.length > 200 || typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(name) || typeof args !== 'string' || args.length > 20000) { this.invalid(); }
    if (this.toolCalls.length >= 16) { this.invalid(); }
    this.toolCalls.push({ id, name, arguments: args });
  }

  readOpenaiCalls(value: unknown): void {
    if (!Array.isArray(value)) { this.invalid(); }
    this.toolCalls = [];
    for (const item of value) {
      if (object(item) && item.type === 'function_call') { this.toolCall(item.call_id, item.name, item.arguments); }
    }
  }

  readOpenaiContent(value: unknown, collect: boolean): string {
    if (!Array.isArray(value)) { this.invalid(); }
    let text = '';
    for (const part of value) {
      if (!object(part) || typeof part.type !== 'string') { this.invalid(); }
      if (part.type === 'output_text') {
        if (typeof part.text !== 'string') { this.invalid(); }
        if (collect) { text += part.text; }
      } else if (part.type === 'refusal') {
        if (typeof part.refusal !== 'string') { this.invalid(); }
        this.refusal = true;
      } else if (['text', 'thinking', 'text_delta'].includes(part.type)) { this.invalid(); }
    }
    return text;
  }

  readOpenaiOutput(value: unknown, collect: boolean): string {
    if (!Array.isArray(value)) { this.invalid(); }
    let text = '';
    for (const item of value) {
      if (!object(item) || typeof item.type !== 'string') { this.invalid(); }
      if (item.type === 'message') { text += this.readOpenaiContent(item.content, collect); }
      else if (item.type === 'function_call') {
        if (typeof item.call_id !== 'string' || typeof item.name !== 'string' || (item.arguments !== undefined && typeof item.arguments !== 'string')) { this.invalid(); }
        if (collect) { this.toolCall(item.call_id, item.name, item.arguments ?? ''); }
      }
      else if (['text', 'thinking', 'text_delta'].includes(item.type)) { this.invalid(); }
    }
    return text;
  }

  readAnthropicContent(value: unknown): string {
    if (!Array.isArray(value)) { this.invalid(); }
    let text = '';
    for (const part of value) {
      if (!object(part) || typeof part.type !== 'string') { this.invalid(); }
      if (part.type === 'text') {
        if (typeof part.text !== 'string') { this.invalid(); }
        text += part.text;
        this.replay.push({ type: 'text', text: part.text });
      } else if (part.type === 'thinking') {
        if (typeof part.thinking !== 'string' || (part.signature !== undefined && typeof part.signature !== 'string')) { this.invalid(); }
        this.replay.push({ type: 'thinking', thinking: part.thinking, ...(part.signature !== undefined ? { signature: part.signature } : {}) });
      } else if (part.type === 'redacted_thinking') {
        if (typeof part.data !== 'string') { this.invalid(); }
        this.replay.push({ type: 'redacted_thinking', data: part.data });
      } else if (part.type === 'tool_use') {
        if (!object(part.input)) { this.invalid(); }
        this.toolCall(part.id, part.name, JSON.stringify(part.input));
        this.replay.push({ type: 'tool_use', id: part.id, name: part.name, input: part.input });
      } else if (['output_text', 'refusal', 'text_delta'].includes(part.type)) { this.invalid(); }
    }
    return text;
  }

  openaiStop(response: ObjectValue): Stop {
    if (response.status === 'completed') { return this.toolCalls.length ? 'tool' : 'end'; }
    if (response.status !== 'incomplete' || !object(response.incomplete_details)) { return this.invalid(); }
    if (response.incomplete_details.reason === 'max_output_tokens') { return 'length'; }
    if (response.incomplete_details.reason === 'content_filter') { return 'refusal'; }
    return this.invalid();
  }

  anthropicStop(reason: unknown): Stop {
    if (reason === 'end_turn' || reason === 'stop_sequence') { return 'end'; }
    if (reason === 'tool_use') { return 'tool'; }
    if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') { return 'length'; }
    if (reason === 'refusal') { return 'refusal'; }
    return this.invalid();
  }

  providerError(value: unknown, requestId?: unknown): ProviderFailure {
    if (!object(value) || (typeof value.type !== 'string' && typeof value.code !== 'string') ||
        (value.message !== undefined && typeof value.message !== 'string')) { this.invalid(); }
    return normalizeHttpError(this.context, { status: this.response.status ?? 200, headers: this.response.headers, body: { error: value, request_id: requestId } });
  }
}

/** A physical stream parser owns one terminal. HTTP, abort and deadline owners can settle it too. */
export class ProtocolParser {
  private readonly state: ResponseState;
  private settled = false;
  private terminalFailure: ProviderFailure | null = null;
  private started = false;
  private stop: Stop | null = null;
  private readonly blocks = new Map<number, { type: string; closed: boolean; id?: string; name?: string; json: string; text: string; thinking: string; signature?: string; data?: string }>();

  constructor(private readonly protocol: Protocol, context: ErrorContext, response: ResponseMetadata = {}) { this.state = new ResponseState(context, response); }

  get isTerminal(): boolean { return this.settled; }
  get text(): string { return this.state.text; }
  get usage(): Usage | null { return this.state.usage; }
  /** Retains normalized retry/capability evidence, never the provider's original payload. */
  get failure(): ProviderFailure | null { return this.terminalFailure; }

  push(frame: SseFrame): StreamEvent[] {
    if (this.settled) { return []; }
    try {
      const known = this.protocol === 'openai_responses' ? openaiEvents : anthropicEvents;
      const opposite = this.protocol === 'openai_responses' ? anthropicEvents : openaiEvents;
      if (frame.event && opposite.has(frame.event)) { this.state.invalid(); }
      if (frame.data === null) {
        if (frame.event && (known.has(frame.event) || frame.event === 'error')) { this.state.invalid(); }
        return [];
      }
      if (frame.data.trim() === '[DONE]') {
        if (frame.event && (known.has(frame.event) || frame.event === 'error')) { this.state.invalid(); }
        return [];
      }
      // Unknown named extensions need not be JSON; they cannot assert a terminal.
      if (frame.event && frame.event !== 'message' && frame.event !== 'error' && !known.has(frame.event)) { return []; }
      let body: unknown;
      try { body = JSON.parse(frame.data); } catch { this.state.invalid(); }
      if (!object(body) || typeof body.type !== 'string') { this.state.invalid(); }
      if (opposite.has(body.type)) { this.state.invalid(); }
      if (frame.event && frame.event !== 'message' && frame.event !== body.type) { this.state.invalid(); }
      if (body.type === 'error') { return this.fail(this.state.providerError(body.error ?? body, body.request_id)); }
      if (!known.has(body.type)) { return []; }
      const events = this.protocol === 'openai_responses' ? this.openai(body) : this.anthropic(body);
      if (events.some(event => event.type === 'done')) { this.settled = true; }
      return events;
    } catch (error) {
      return this.fail(error instanceof ProviderFailure ? error : aiFailure('AI_PROTOCOL_MISMATCH', this.state.context));
    }
  }

  finish(): StreamEvent[] {
    return this.fail(aiFailure(this.state.text ? 'AI_STREAM_INTERRUPTED' : 'AI_NETWORK', this.state.context));
  }

  fail(error: ProviderFailure): StreamEvent[] {
    if (this.settled) { return []; }
    this.settled = true;
    this.terminalFailure = error;
    return [{ type: 'error', error: error.info }];
  }

  cancel(): StreamEvent[] {
    if (this.settled) { return []; }
    this.settled = true;
    return [{ type: 'cancelled' }];
  }

  private openai(body: ObjectValue): StreamEvent[] {
    const type = body.type as string;
    for (const index of ['output_index', 'content_index', 'sequence_number']) {
      if (body[index] !== undefined && !count(body[index])) { this.state.invalid(); }
    }
    if (body.item_id !== undefined && typeof body.item_id !== 'string') { this.state.invalid(); }
    if (type === 'response.output_text.delta') { return this.state.append(body.delta); }
    if (type === 'response.output_text.done') {
      if (typeof body.text !== 'string') { this.state.invalid(); }
    } else if (type === 'response.refusal.delta' || type === 'response.refusal.done') {
      if (typeof body[type.endsWith('.delta') ? 'delta' : 'refusal'] !== 'string') { this.state.invalid(); }
      this.state.refusal = true;
    } else if (type === 'response.content_part.added' || type === 'response.content_part.done') {
      this.state.readOpenaiContent([body.part], false);
    } else if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      this.state.readOpenaiOutput([body.item], false);
    } else if (type === 'response.model') {
      if (typeof body.model !== 'string') { this.state.invalid(); }
      this.state.readModel(body.model);
    } else if (type === 'response.usage') {
      if (!object(body.usage)) { this.state.invalid(); }
      this.state.readUsage(body.usage);
    } else if (type.startsWith('response.reasoning')) {
      if (type.endsWith('.delta') && typeof body.delta !== 'string') { this.state.invalid(); }
      if (type.endsWith('_text.done') && typeof body.text !== 'string') { this.state.invalid(); }
      if ((type.endsWith('_part.added') || type.endsWith('_part.done')) && !object(body.part)) { this.state.invalid(); }
    } else {
      if (!object(body.response)) { this.state.invalid(); }
      const response = body.response;
      if ((response.object !== undefined && response.object !== 'response') || response.type === 'message' || response.content !== undefined || response.stop_reason !== undefined) { this.state.invalid(); }
      this.state.readModel(response.model);
      this.state.readUsage(response.usage);
      if (response.output !== undefined) { this.state.readOpenaiOutput(response.output, false); }
      if (type === 'response.failed') {
        if (response.status !== 'failed') { this.state.invalid(); }
        return this.fail(this.state.providerError(response.error));
      }
      if (type === 'response.completed' || type === 'response.incomplete') {
        if (response.status !== type.slice('response.'.length)) { this.state.invalid(); }
        if (response.output !== undefined) { this.state.readOpenaiCalls(response.output); }
        return [this.state.done(this.state.openaiStop(response))];
      }
      if (response.status !== undefined && !['queued', 'in_progress'].includes(response.status as string)) { this.state.invalid(); }
    }
    return [];
  }

  /** Streamed tool_use input arrives as JSON fragments; each block is parsed once at message_stop. */
  private collectAnthropicBlocks(): void {
    for (const [, block] of [...this.blocks.entries()].sort((a, b) => a[0] - b[0])) {
      if (block.type === 'text') { this.state.replay.push({ type: 'text', text: block.text }); }
      else if (block.type === 'thinking') { this.state.replay.push({ type: 'thinking', thinking: block.thinking, ...(block.signature !== undefined ? { signature: block.signature } : {}) }); }
      else if (block.type === 'redacted_thinking') { this.state.replay.push({ type: 'redacted_thinking', data: block.data }); }
      else if (block.type === 'tool_use') {
        let input: unknown;
        try { input = JSON.parse(block.json || '{}'); } catch { this.state.invalid(); }
        if (!object(input)) { this.state.invalid(); }
        this.state.toolCall(block.id, block.name, JSON.stringify(input));
        this.state.replay.push({ type: 'tool_use', id: block.id, name: block.name, input });
      }
    }
  }

  private anthropic(body: ObjectValue): StreamEvent[] {
    if (body.type === 'ping') { return []; }
    if (body.type === 'message_start') {
      if (this.started || !object(body.message)) { this.state.invalid(); }
      const message = body.message;
      if (message.type !== 'message' || !Array.isArray(message.content) || message.output !== undefined || message.status !== undefined ||
          (message.role !== undefined && message.role !== 'assistant') || (message.id !== undefined && typeof message.id !== 'string')) { this.state.invalid(); }
      // A message_start is metadata, not a second source of generated text.
      // Standard Messages streams start with an empty content array; rejecting a populated
      // snapshot prevents silently dropping content or appending it again at block_start.
      if (message.content.length !== 0) { this.state.invalid(); }
      this.state.readModel(message.model);
      this.state.readUsage(message.usage);
      this.started = true;
      return [];
    }
    if (!this.started) { this.state.invalid(); }
    if (body.type === 'message_delta') {
      if (!object(body.delta)) { this.state.invalid(); }
      if (body.delta.stop_reason !== undefined && body.delta.stop_reason !== null) { this.stop = this.state.anthropicStop(body.delta.stop_reason); }
      if (body.delta.stop_sequence !== undefined && body.delta.stop_sequence !== null && typeof body.delta.stop_sequence !== 'string') { this.state.invalid(); }
      this.state.readUsage(body.usage);
    } else if (body.type === 'message_stop') {
      if (this.stop === null || [...this.blocks.values()].some(block => !block.closed)) { this.state.invalid(); }
      this.collectAnthropicBlocks();
      return [this.state.done(this.stop)];
    } else {
      if (!count(body.index)) { this.state.invalid(); }
      const block = this.blocks.get(body.index);
      if (body.type === 'content_block_start') {
        if (block || !object(body.content_block) || typeof body.content_block.type !== 'string') { this.state.invalid(); }
        const content = body.content_block;
        const started = { type: content.type as string, closed: false, json: '', text: '', thinking: '' } as NonNullable<ReturnType<typeof this.blocks.get>>;
        this.blocks.set(body.index, started);
        if (content.type === 'text') { if (typeof content.text === 'string') { started.text = content.text; } return this.state.append(content.text); }
        if (content.type === 'thinking' && typeof content.thinking !== 'string') { this.state.invalid(); }
        if (content.type === 'thinking') { started.thinking = content.thinking as string; }
        if (content.type === 'redacted_thinking') { if (typeof content.data !== 'string') { this.state.invalid(); } started.data = content.data as string; }
        if (content.type === 'tool_use') {
          if (typeof content.id !== 'string' || typeof content.name !== 'string' || (content.input !== undefined && !object(content.input))) { this.state.invalid(); }
          started.id = content.id as string; started.name = content.name as string;
        }
        if (['output_text', 'refusal'].includes(content.type as string)) { this.state.invalid(); }
      } else {
        if (!block || block.closed) { this.state.invalid(); }
        if (body.type === 'content_block_stop') { block.closed = true; return []; }
        if (!object(body.delta) || typeof body.delta.type !== 'string') { this.state.invalid(); }
        const delta = body.delta;
        if (delta.type === 'text_delta') {
          if (block.type !== 'text') { this.state.invalid(); }
          if (typeof delta.text === 'string') { block.text += delta.text; }
          return this.state.append(delta.text);
        }
        if (delta.type === 'thinking_delta' && (block.type !== 'thinking' || typeof delta.thinking !== 'string')) { this.state.invalid(); }
        if (delta.type === 'signature_delta' && (block.type !== 'thinking' || typeof delta.signature !== 'string')) { this.state.invalid(); }
        if (delta.type === 'input_json_delta' && (block.type !== 'tool_use' || typeof delta.partial_json !== 'string')) { this.state.invalid(); }
        if (delta.type === 'thinking_delta') { block.thinking += delta.thinking as string; }
        if (delta.type === 'signature_delta') { block.signature = (block.signature ?? '') + (delta.signature as string); }
        if (delta.type === 'input_json_delta') { block.json += delta.partial_json as string; if (block.json.length > 20000) { this.state.invalid(); } }
        if (delta.type === 'output_text') { this.state.invalid(); }
      }
    }
    return [];
  }
}

/** HTTP success JSON fallback. A single text event precedes its validated terminal. */
export function parseJsonResponse(protocol: Protocol, value: unknown, context: ErrorContext): StreamEvent[] {
  return parseJsonResponseWithEvidence(protocol, value, context).events;
}

/** The network owner must retain this failure object when deciding a later bounded retry. */
export function parseJsonResponseWithEvidence(protocol: Protocol, value: unknown, context: ErrorContext, metadata: ResponseMetadata = {}): ParsedResponse {
  const state = new ResponseState(context, metadata);
  try {
    let body = value;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { state.invalid(); }
    }
    const response = object(body) ? body : state.invalid();
    state.readUsage(response.usage);
    if (response.type === 'error' || response.error != null) { throw state.providerError(response.error ?? response, response.request_id); }
    let text: string;
    let stop: Stop;
    if (protocol === 'openai_responses') {
      if ((response.object !== undefined && response.object !== 'response') || response.type === 'message' || response.content !== undefined || response.stop_reason !== undefined) { state.invalid(); }
      if (response.status === 'failed') { throw state.providerError(response.error); }
      text = state.readOpenaiOutput(response.output, true);
      stop = state.openaiStop(response);
    } else {
      if (response.type !== 'message' || response.output !== undefined || response.status !== undefined) { state.invalid(); }
      text = state.readAnthropicContent(response.content);
      stop = state.anthropicStop(response.stop_reason);
    }
    state.readModel(response.model);
    state.readUsage(response.usage);
    const events = state.append(text);
    return { events: [...events, state.done(stop)], failure: null, usage: state.usage };
  } catch (error) {
    const failure = error instanceof ProviderFailure ? error : aiFailure('AI_PROTOCOL_MISMATCH', context);
    return { events: [{ type: 'error', error: failure.info }], failure, usage: state.usage };
  }
}
