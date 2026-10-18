/** One captured configuration/key snapshot; no database access and no retries. */
import type { ModelService } from '../../features/types';
import { resolveUrl } from '../../features/modelServiceConfig';
import { nativeTransport, TransportFailure, type HttpEvent, type HttpTransport } from '../transport/native';
import { aiFailure, headerValue, normalizeHttpError, ProviderFailure, safeResponseScalar, type ErrorContext } from './errors';
import { RequestLifetime } from './lifecycle';
import { parseJsonResponseWithEvidence, ProtocolParser } from './parse';
import { MAX_RESPONSE_BYTES, SseDecoder, SseFailure } from './sse';
import type { GenerateRequest, Provider, StreamEvent } from './types';

export interface AttemptEvidence {
  streaming: boolean | null;
  failure: ProviderFailure | null;
}
export interface ProviderOptions {
  transport?: HttpTransport;
  deadline?: number;
  evidence?: AttemptEvidence;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function createProvider(service: Pick<ModelService, 'name' | 'protocol' | 'baseUrl' | 'model' | 'options'>, secret: string, options: ProviderOptions = {}): Provider {
  const snapshot = { ...service, options: { ...service.options, caps: { ...service.options.caps } } };
  const transport = options.transport ?? nativeTransport;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (snapshot.protocol === 'openai_responses' || snapshot.options.authHeader === 'bearer') headers.Authorization = `Bearer ${secret}`;
  else headers['x-api-key'] = secret;
  if (snapshot.protocol === 'anthropic_messages') headers['anthropic-version'] = '2023-06-01';
  const baseContext: ErrorContext = { protocol: snapshot.protocol, serviceName: snapshot.name, model: snapshot.model, baseUrl: snapshot.baseUrl, sensitiveValues: [secret] };
  const deadline = () => options.deadline ?? Date.now() + 300000;
  function fromTransport(error: unknown, context: ErrorContext): ProviderFailure {
    if (error instanceof ProviderFailure) return error;
    if (error instanceof SseFailure) return aiFailure('AI_RESPONSE_TOO_LARGE', context);
    if (error instanceof TransportFailure && error.code === 'redirect') return normalizeHttpError(context, { status: 302 });
    return aiFailure(error instanceof TransportFailure && error.code === 'too_large' ? 'AI_RESPONSE_TOO_LARGE' : error instanceof TransportFailure && error.code === 'encoding' ? 'AI_PROTOCOL_MISMATCH' : 'AI_NETWORK', context);
  }
  async function* generate(request: GenerateRequest, release: () => void): AsyncGenerator<StreamEvent, void, unknown> {
    const context = { ...baseContext, sensitiveValues: [secret, request.system, ...request.messages.map(message => message.content)] };
    let physical: AsyncIterator<HttpEvent> | undefined;
    const owner = new RequestLifetime(request.signal, context, deadline(), 60000, () => {
      release();
      // Cleanup never delays or replaces a terminal that already won. Abort
      // wakes a pending read; return also releases a transport paused at yield.
      try { physical?.return?.().catch(() => {}); } catch { /* best effort */ }
    });
    const metadata = { status: 200, headers: {} as Record<string, string> };
    const parser = new ProtocolParser(snapshot.protocol, context, metadata);
    const sse = new SseDecoder();
    let response = '';
    let status = 0;
    let responseHeaders: Record<string, string> = {};
    let json = false;
    let bodyBytes = 0;
    let textDeliveries = 0;
    let settled = false;
    const finish = (events: StreamEvent[]): StreamEvent[] => {
      const terminal = events.find(event => event.type === 'done' || event.type === 'error' || event.type === 'cancelled');
      if (!terminal) return events;
      if (!owner.settle()) return [];
      settled = true;
      if (options.evidence) {
        options.evidence.streaming = json ? false : textDeliveries >= 2 ? true : null;
        if (terminal.type === 'error' && !options.evidence.failure) options.evidence.failure = parser.failure ?? new ProviderFailure(terminal.error, null, ['AI_RATE_LIMIT', 'AI_SERVER'].includes(terminal.error.code));
      }
      return events;
    };
    try {
      owner.check();
      if (owner.failure) throw owner.failure;
      const effort = snapshot.options.caps.effort === false ? undefined : request.effort;
      const schema = snapshot.options.caps.jsonSchema === false ? undefined : request.jsonSchema;
      const body = snapshot.protocol === 'openai_responses' ? {
        model: snapshot.model, instructions: request.system, input: request.messages,
        max_output_tokens: request.maxOutputTokens, stream: request.stream, store: snapshot.options.store,
        ...(effort ? { reasoning: { effort } } : {}),
        ...(schema ? { text: { format: { type: 'json_schema', name: schema.name, schema: schema.schema, strict: true } } } : {}),
      } : {
        model: snapshot.model, system: request.system, messages: request.messages,
        max_tokens: request.maxOutputTokens, stream: request.stream,
        ...(effort || schema ? { output_config: { ...(effort ? { effort } : {}), ...(schema ? { format: { type: 'json_schema', schema: schema.schema } } : {}) } } : {}),
      };
      physical = transport({ url: resolveUrl(snapshot.protocol, snapshot.baseUrl, 'generate'), method: 'POST', headers: { ...headers, ...(request.stream ? { Accept: 'text/event-stream' } : {}) }, body: JSON.stringify(body), signal: owner.controller.signal })[Symbol.asyncIterator]();
      for await (const event of { [Symbol.asyncIterator]: () => physical! }) {
        owner.check();
        if (owner.failure) throw owner.failure;
        if (event.type === 'headers') {
          if (status) throw aiFailure('AI_PROTOCOL_MISMATCH', context);
          status = event.status;
          responseHeaders = event.headers;
          metadata.status = status;
          metadata.headers = responseHeaders;
          json = /^application\/json(?:\s*;|$)/i.test(headerValue(event.headers, 'content-type') ?? '');
          if (status >= 200 && status < 300 && !json && !/^text\/event-stream(?:\s*;|$)/i.test(headerValue(event.headers, 'content-type') ?? '')) throw aiFailure('AI_PROTOCOL_MISMATCH', context);
          continue;
        }
        if (!status) throw aiFailure('AI_PROTOCOL_MISMATCH', context);
        owner.bytes(json || status < 200 || status >= 300);
        if (owner.failure) throw owner.failure;
        bodyBytes += event.bytes;
        if (bodyBytes > MAX_RESPONSE_BYTES) throw aiFailure('AI_RESPONSE_TOO_LARGE', context);
        if (json || status < 200 || status >= 300) { response += event.text; continue; }
        let delivered = false;
        for (const frame of sse.push(event.text, event.bytes)) {
          owner.activity();
          if (owner.failure) throw owner.failure;
          const events = parser.push(frame);
          if (options.evidence) options.evidence.failure = parser.failure;
          if (events.some(part => part.type === 'text') && !delivered) { textDeliveries++; delivered = true; }
          for (const output of finish(events)) yield output;
          if (settled) return;
          if (owner.failure) throw owner.failure;
        }
      }
      owner.check();
      if (owner.failure) throw owner.failure;
      if (!status) throw aiFailure('AI_NETWORK', context);
      if (status < 200 || status >= 300) {
        let errorBody: unknown;
        try { errorBody = JSON.parse(response); } catch { /* HTML errors are categorized by status. */ }
        const failure = normalizeHttpError(context, { status, headers: responseHeaders, body: errorBody });
        if (options.evidence) options.evidence.failure = failure;
        throw failure;
      }
      if (json) {
        const parsed = parseJsonResponseWithEvidence(snapshot.protocol, response, context, metadata);
        if (options.evidence) options.evidence.failure = parsed.failure;
        for (const output of finish(parsed.events)) yield output;
      } else {
        for (const frame of sse.finish()) {
          for (const output of finish(parser.push(frame))) yield output;
          if (settled) return;
        }
        for (const output of finish(parser.finish())) yield output;
      }
    } catch (error) {
      const transportFailure = fromTransport(error, context);
      const failure = owner.failure ?? (parser.text && transportFailure.info.code === 'AI_NETWORK' ? aiFailure('AI_STREAM_INTERRUPTED', context) : transportFailure);
      if (options.evidence) options.evidence.failure = failure;
      if (!settled) {
        settled = true;
        owner.dispose();
        yield failure.info.code === 'AI_CANCELLED' ? { type: 'cancelled' } : { type: 'error', error: failure.info };
      }
    } finally {
      owner.dispose();
      owner.controller.abort();
    }
  }
  async function listModels({ signal }: { signal: AbortSignal }): Promise<string[]> {
    // One call may contain Anthropic pagination, but shares the caller deadline.
    const owner = new RequestLifetime(signal, baseContext, options.deadline ?? Date.now() + 20000, null);
    const results: string[] = [];
    const seen = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    try {
      for (let page = 0; page < 5; page++) {
        owner.check();
        if (owner.failure) throw owner.failure;
        const base = resolveUrl(snapshot.protocol, snapshot.baseUrl, 'models');
        const url = snapshot.protocol === 'anthropic_messages' ? `${base}?limit=1000${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ''}` : base;
        let body = '';
        let bytes = 0;
        let status = 0;
        let responseHeaders: Record<string, string> = {};
        for await (const event of transport({ url, method: 'GET', headers, signal: owner.controller.signal })) {
          owner.check();
          if (owner.failure) throw owner.failure;
          if (event.type === 'headers') { status = event.status; responseHeaders = event.headers; }
          else {
            bytes += event.bytes;
            if (bytes > MAX_RESPONSE_BYTES) throw aiFailure('AI_RESPONSE_TOO_LARGE', baseContext);
            body += event.text;
          }
        }
        owner.check();
        if (owner.failure) throw owner.failure;
        let parsed: unknown;
        if (!status) throw aiFailure('AI_NETWORK', baseContext);
        try { parsed = JSON.parse(body); } catch { /* status mapping wins */ }
        if (status < 200 || status >= 300) throw normalizeHttpError(baseContext, { status, headers: responseHeaders, body: parsed });
        if (!/^application\/json(?:\s*;|$)/i.test(headerValue(responseHeaders, 'content-type') ?? '') || !object(parsed) || !Array.isArray(parsed.data)) throw aiFailure('AI_PROTOCOL_MISMATCH', baseContext);
        for (const item of parsed.data) {
          if (!object(item) || typeof item.id !== 'string') throw aiFailure('AI_PROTOCOL_MISMATCH', baseContext);
          const model = safeResponseScalar(item.id, baseContext, 'model');
          if (!model) throw aiFailure('AI_PROTOCOL_MISMATCH', baseContext);
          if (!seen.has(model)) { seen.add(model); results.push(model); }
        }
        if (snapshot.protocol === 'openai_responses') return results;
        if (typeof parsed.has_more !== 'boolean') throw aiFailure('AI_PROTOCOL_MISMATCH', baseContext);
        if (!parsed.has_more) return results;
        const next = safeResponseScalar(parsed.last_id, baseContext, 'model');
        if (!next || cursors.has(next)) throw aiFailure('AI_PROTOCOL_MISMATCH', baseContext);
        cursors.add(next); cursor = next;
      }
      return results;
    } catch (error) { throw owner.failure ?? fromTransport(error, baseContext); }
    finally { owner.dispose(); owner.controller.abort(); }
  }
  return {
    generate(request) {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      request.signal.addEventListener('abort', cancel, { once: true });
      if (request.signal.aborted) cancel();
      let released = false;
      const release = () => { if (!released) { released = true; request.signal.removeEventListener('abort', cancel); } };
      const iterator = generate({ ...request, messages: request.messages.map(message => ({ ...message })), signal: controller.signal }, release);
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() { const result = await iterator.next(); if (result.done || result.value.type !== 'text') release(); return result; },
            async return() { cancel(); release(); return iterator.return(); },
            async throw(error: unknown) { cancel(); release(); return iterator.throw(error); },
          };
        },
      };
    },
    listModels,
  };
}
