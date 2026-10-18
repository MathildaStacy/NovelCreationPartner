import type { AiErrorInfo, Protocol } from '../../features/types';
import type { AiErrorCode } from '../../features/errors';
import { aiText } from '../../locales/ai';

export type { AiErrorCode } from '../../features/errors';

export interface ErrorContext {
  protocol: Protocol;
  serviceName: string;
  model: string;
  baseUrl: string;
  /** The request Key and prompt/content values; used only to reject reflected scalar values. */
  sensitiveValues?: readonly string[];
  now?: () => Date;
}

export class ProviderFailure extends Error {
  constructor(
    readonly info: AiErrorInfo,
    readonly retryAfterMs: number | null = null,
    readonly shouldRetry = false,
    readonly unsupported: 'effort' | 'jsonSchema' | null = null,
  ) {
    super(info.message);
    this.name = 'ProviderFailure';
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function reflectsSensitive(value: string, context: ErrorContext): boolean {
  return (context.sensitiveValues ?? []).some(secret => secret.length > 0 && value.includes(secret));
}

/** Only scalar identifiers from documented fields are eligible for display or persistence. */
export function safeResponseScalar(value: unknown, context: ErrorContext, kind: 'model' | 'requestId'): string | null {
  if (typeof value !== 'string' || reflectsSensitive(value, context)) { return null; }
  const pattern = kind === 'model' ? /^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]{0,199}$/ : /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
  return pattern.test(value) ? value : null;
}

function localValue(value: string, fallback: string, context: ErrorContext): string {
  const control = [...value].some(char => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127);
  return value && value.length <= 200 && !control && !reflectsSensitive(value, context) ? value : fallback;
}

export function aiFailure(code: AiErrorCode, context: ErrorContext, status: number | null = null): ProviderFailure {
  let host = aiText.host;
  try { host = localValue(new URL(context.baseUrl).hostname, aiText.host, context); } catch { /* safe fallback */ }
  const model = localValue(context.model, aiText.model, context);
  const messages: Record<AiErrorCode, string> = {
    AI_NETWORK: aiText.network(host), AI_TIMEOUT: aiText.timeout(host), AI_AUTH: aiText.auth,
    AI_PERMISSION: aiText.permission, AI_NOT_FOUND: aiText.notFound(model), AI_CONTEXT_TOO_LONG: aiText.contextTooLong,
    AI_BAD_REQUEST: aiText.badRequest, AI_QUOTA: aiText.quota, AI_RATE_LIMIT: aiText.rateLimit,
    AI_SERVER: aiText.server, AI_STREAM_INTERRUPTED: aiText.interrupted, AI_TRUNCATED: aiText.truncated,
    AI_REFUSAL: aiText.refusal, AI_RESPONSE_TOO_LARGE: aiText.tooLarge, AI_CANCELLED: aiText.cancelled,
    AI_BUDGET_EXCEEDED: '本次请求已达到预算，请调整范围或额度。', AI_RESULT_STALE: '内容已变化，请重新定位或生成。',
    AI_FORMAT: aiText.format, AI_PROTOCOL_MISMATCH: aiText.mismatch(context.protocol === 'openai_responses' ? 'OpenAI Responses' : 'Anthropic Messages'),
  };
  return new ProviderFailure({ code, status, message: messages[code], providerMessage: null, requestId: null,
    serviceName: localValue(context.serviceName, aiText.service, context), model, at: (context.now?.() ?? new Date()).toISOString() });
}

export function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  const key = Object.keys(headers ?? {}).find(candidate => candidate.toLowerCase() === name);
  return key === undefined ? undefined : headers?.[key];
}

/** Retry hints are finite and nonnegative; callers enforce their own deadline and wait limit. */
export function parseRetryAfter(headers: Record<string, string> | undefined, now: number): number | null {
  const milliseconds = headerValue(headers, 'retry-after-ms');
  if (milliseconds !== undefined && /^-?\d+(?:\.\d+)?$/.test(milliseconds.trim())) {
    const result = Number(milliseconds);
    if (Number.isFinite(result)) { return Math.max(0, result); }
  }
  const value = headerValue(headers, 'retry-after')?.trim();
  if (!value) { return null; }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    const result = Number(value) * 1000;
    return Number.isFinite(result) ? Math.max(0, result) : null;
  }
  // Do not let permissive Date.parse interpret arbitrary words or bare integers as dates.
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) { return null; }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}

interface HttpErrorInput { status: number; headers?: Record<string, string>; body?: unknown }

/** Unknown provider text is inspected transiently for known categories, and never retained. */
export function normalizeHttpError(context: ErrorContext, input: HttpErrorInput): ProviderFailure {
  let body = input.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const root = record(body);
  const error = record(root?.error) ?? root;
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  const type = typeof error?.type === 'string' ? error.type.toLowerCase() : '';
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  const param = typeof error?.param === 'string' ? error.param : '';
  const names = [code, type];
  const has = (...values: string[]) => values.some(value => names.includes(value));
  const quota = has('insufficient_quota', 'billing_error', 'quota_exceeded', 'usage_limit_reached', 'spend_limit_exceeded', 'spending_limit_exceeded', 'budget_exceeded') ||
    (input.status === 429 && /(?:quota|(?:spend(?:ing)?|billing|credit|usage|budget)[_-](?:limit|cap|exceeded))/.test(code)) ||
    (input.status === 429 && context.protocol === 'anthropic_messages' && headerValue(input.headers, 'retry-after') === undefined && /(?:spend(?:ing)?|cost|billing|credit|usage)\s+(?:limit|cap)|monthly\s+limit/.test(message));
  const contextTooLong = [400, 413].includes(input.status) && (has('context_length_exceeded', 'request_too_large', 'prompt_too_long') || /context (?:length|window)|too many tokens|prompt is too long|maximum context|input.*token.*limit/.test(message));
  let mapped: AiErrorCode;
  if (quota || input.status === 402) { mapped = 'AI_QUOTA'; }
  else if (input.status === 401 || has('authentication_error', 'invalid_api_key')) { mapped = 'AI_AUTH'; }
  else if (input.status === 403 || has('permission_error', 'permission_denied', 'unsupported_country_region_territory')) { mapped = 'AI_PERMISSION'; }
  else if (input.status === 404 || has('not_found_error', 'model_not_found')) { mapped = 'AI_NOT_FOUND'; }
  else if (contextTooLong) { mapped = 'AI_CONTEXT_TOO_LONG'; }
  else if (input.status === 429 || has('rate_limit_error', 'rate_limit_exceeded')) { mapped = 'AI_RATE_LIMIT'; }
  else if (input.status >= 500 || has('overloaded_error', 'api_error', 'server_error')) { mapped = 'AI_SERVER'; }
  else if (input.status >= 300 && input.status < 400) { mapped = 'AI_NETWORK'; }
  else { mapped = 'AI_BAD_REQUEST'; }

  let unsupported: ProviderFailure['unsupported'] = null;
  if (input.status === 400 && mapped === 'AI_BAD_REQUEST' && error && /unsupported|not supported|does not support|unknown parameter|unrecognized|not allowed/.test(`${code} ${type} ${message}`)) {
    const quotedParameter = (parameter: string) => [`'${parameter}'`, `"${parameter}"`, `\`${parameter}\``].some(quoted => message.includes(quoted));
    if (['reasoning.effort', 'output_config.effort'].includes(param) || ['reasoning.effort', 'output_config.effort'].some(quotedParameter)) { unsupported = 'effort'; }
    else if (['text.format', 'output_config.format', 'json_schema'].includes(param) || ['text.format', 'output_config.format', 'json_schema'].some(quotedParameter)) { unsupported = 'jsonSchema'; }
  }
  const base = aiFailure(mapped, context, input.status);
  const diagnostics: Partial<Record<AiErrorCode, string>> = {
    AI_AUTH: aiText.diagnostics.auth, AI_PERMISSION: aiText.diagnostics.permission, AI_NOT_FOUND: aiText.diagnostics.notFound,
    AI_CONTEXT_TOO_LONG: aiText.diagnostics.context, AI_QUOTA: aiText.diagnostics.quota, AI_RATE_LIMIT: aiText.diagnostics.rate,
    AI_SERVER: aiText.diagnostics.server,
  };
  const requestId = headerValue(input.headers, 'x-request-id') ?? headerValue(input.headers, 'request-id') ?? root?.request_id;
  const info = { ...base.info, requestId: safeResponseScalar(requestId, context, 'requestId'),
    message: input.status >= 300 && input.status < 400 ? aiText.redirected : base.info.message,
    providerMessage: unsupported === 'effort' ? aiText.diagnostics.effort : unsupported === 'jsonSchema' ? aiText.diagnostics.jsonSchema : diagnostics[mapped] ?? null };
  return new ProviderFailure(info, parseRetryAfter(input.headers, (context.now?.() ?? new Date()).getTime()),
    ['AI_RATE_LIMIT', 'AI_SERVER'].includes(mapped) && headerValue(input.headers, 'x-should-retry')?.trim().toLowerCase() !== 'false', unsupported);
}
