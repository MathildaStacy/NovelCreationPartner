/** Pure S02 form helpers: defaults, protocol switching, parsing, validation, dirty checks and S02c failure classes. */
import { DEFAULT_OPTIONS, resolveUrl, type ServiceDetail, type ServiceDraft, type TestResult } from '../../../features/modelServices';
import { normalizeKey, normalizeUrl, validateDraft } from '../../../features/modelServiceConfig';
import { isAppError } from '../../../features/errors';
import type { AiErrorInfo, ModelService, Protocol } from '../../../features/types';
import { modelServiceText } from '../../../locales/modelServices';
import { settingsText } from '../../../locales/settings';

const s = settingsText;
type Options = ModelService['options'];
export type Caps = Options['caps'];

export const OFFICIAL_URL: Record<Protocol, string> = {
  openai_responses: 'https://api.openai.com/v1',
  anthropic_messages: 'https://api.anthropic.com',
};
export const PROTOCOLS: Protocol[] = ['openai_responses', 'anthropic_messages'];
export const DEFAULT_BUDGET = DEFAULT_OPTIONS.contextBudget;

/** Form state is text for numeric inputs; the draft is built only when sent to a service. */
export interface Form {
  name: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  maxOutput: string;
  effort: Options['effort'];
  authHeader: Options['authHeader'];
  store: boolean;
  budget: string;
  caps: Caps;
}

export type Field = 'baseUrl' | 'key' | 'model' | 'name' | 'maxOutput' | 'budget';
export const ADVANCED_FIELDS: Field[] = ['name', 'maxOutput', 'budget'];
export const FIELD_ORDER: Field[] = ['baseUrl', 'key', 'model', 'name', 'maxOutput', 'budget'];

export function newForm(): Form {
  return {
    name: '', protocol: 'openai_responses', baseUrl: OFFICIAL_URL.openai_responses, model: '',
    maxOutput: '', effort: DEFAULT_OPTIONS.effort, authHeader: DEFAULT_OPTIONS.authHeader,
    store: DEFAULT_OPTIONS.store, budget: String(DEFAULT_BUDGET), caps: {},
  };
}

export function formFrom(service: ModelService): Form {
  const o = service.options;
  return {
    name: service.name, protocol: service.protocol, baseUrl: service.baseUrl, model: service.model,
    maxOutput: o.maxOutputTokens == null ? '' : String(o.maxOutputTokens), effort: o.effort,
    authHeader: o.authHeader, store: o.store, budget: String(o.contextBudget), caps: { ...o.caps },
  };
}

/** S02 rule 2: swap only an empty or official address; custom relays usually speak both protocols. */
export function switchProtocol(form: Form, next: Protocol): Form {
  const url = form.baseUrl.trim().replace(/\/+$/, '');
  const official = !url || PROTOCOLS.some(p => p !== next && OFFICIAL_URL[p] === url);
  return { ...form, protocol: next, baseUrl: official ? OFFICIAL_URL[next] : form.baseUrl, caps: {} };
}

const halfWidth = (text: string) => text.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));

/** S02b rule 2: blank → null; full-width digits and thousands separators accepted. */
export function parseMaxOutput(text: string): number | null | undefined {
  const value = halfWidth(text).replace(/[,，]/g, '').trim();
  if (!value) { return null; }
  if (!/^\d+$/.test(value)) { return undefined; }
  const n = Number(value);
  return n >= 1 && n <= 128000 ? n : undefined;
}

/** S02b rule 3: 8000–100000, rounded to the nearest thousand on blur. */
export function parseBudget(text: string): number | undefined {
  const value = halfWidth(text).replace(/[,，]/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(value)) { return undefined; }
  const n = Number(value);
  return n >= 8000 && n <= 100000 ? Math.round(n / 1000) * 1000 : undefined;
}

export function hostOf(baseUrl: string): string {
  try { return new URL(baseUrl.trim()).hostname; } catch { return ''; }
}

/** S02 rule 6 placeholder: the name the service layer generates for an empty name (before de-duplication). */
export function autoName(baseUrl: string): string {
  const host = hostOf(baseUrl);
  return host === 'api.openai.com' ? 'OpenAI' : host === 'api.anthropic.com' ? 'Anthropic' : host;
}

/** "实际请求" line and the http warning (S02 #4, rule 3). */
export function addressLine(protocol: Protocol, baseUrl: string): { url: string | null; insecure: boolean } {
  try {
    const url = resolveUrl(protocol, baseUrl, 'generate');
    return { url, insecure: url.startsWith('http://') };
  } catch { return { url: null, insecure: false }; }
}

export function optionsOf(form: Form, lenient = false): Options {
  const max = parseMaxOutput(form.maxOutput);
  const budget = parseBudget(form.budget);
  return {
    maxOutputTokens: max === undefined ? (lenient ? null : NaN) : max,
    effort: form.effort, authHeader: form.authHeader, store: form.store,
    contextBudget: budget ?? (lenient ? DEFAULT_BUDGET : NaN), caps: { ...form.caps },
  };
}

/** The draft sent to features. `lenient` replaces unrelated invalid numbers for model listing. */
export function draftOf(form: Form, base: ServiceDetail | null, lenient = false): ServiceDraft {
  return {
    ...(base ? { id: base.id, revision: base.revision } : null),
    name: form.name, protocol: form.protocol, baseUrl: form.baseUrl, model: form.model,
    options: optionsOf(form, lenient),
  };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Field errors in S02 order (rules 3–6 and S02b rules 2–3). Empty object when valid. */
export function validateForm(form: Form, keyInput: string, keyRequired: boolean, requireModel = true): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  try { normalizeUrl(form.protocol, form.baseUrl); } catch (e) { errors.baseUrl = message(e); }
  try {
    if (!normalizeKey(keyInput) && keyRequired) { errors.key = modelServiceText.validation.keyRequired; }
  } catch (e) { errors.key = message(e); }
  const model = form.model.trim();
  if ((requireModel && !model) || [...model].length > 200) { errors.model = modelServiceText.validation.model; }
  if ([...form.name.trim()].length > 30) { errors.name = modelServiceText.validation.name; }
  if (parseMaxOutput(form.maxOutput) === undefined) { errors.maxOutput = modelServiceText.validation.maxOutput; }
  if (parseBudget(form.budget) === undefined) { errors.budget = modelServiceText.validation.budget; }
  if (Object.keys(errors).length === 0) {
    // Anything the pure service validation still rejects belongs to its own field.
    try { validateDraft(draftOf(form, null), requireModel); } catch (e) {
      const field = fieldOf(isAppError(e) ? e.field : undefined);
      errors[field ?? 'baseUrl'] = message(e);
    }
  }
  return errors;
}

/** Service field names (VALIDATION / DUPLICATE) → form fields. */
export function fieldOf(field: string | undefined): Field | null {
  switch (field) {
    case 'baseUrl': case 'key': case 'model': case 'name': return field;
    case 'options.maxOutputTokens': return 'maxOutput';
    case 'options.contextBudget': return 'budget';
    default: return null;
  }
}

const sameUrl = (a: string, b: string) => a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '');

/** Connection fields except the Key (G02 §5.11.3): protocol, address, model, auth header. */
export function sameConnection(a: Form, b: Form): boolean {
  return a.protocol === b.protocol && sameUrl(a.baseUrl, b.baseUrl) && a.model.trim() === b.model.trim() && a.authHeader === b.authHeader;
}

/** S02 rule 8: test results never count; a revealed but unedited Key does not count. */
export function isDirty(form: Form, base: Form, keyChanged: boolean): boolean {
  const caps = (c: Caps) => JSON.stringify([c.jsonSchema, c.effort, c.streaming]);
  return keyChanged || !sameConnection(form, base) || form.name.trim() !== base.name.trim() ||
    parseMaxOutput(form.maxOutput) !== parseMaxOutput(base.maxOutput) || form.effort !== base.effort ||
    form.store !== base.store || parseBudget(form.budget) !== parseBudget(base.budget) || caps(form.caps) !== caps(base.caps);
}

/** S02b collapsed subtitle: defaults list the fields; otherwise the first two non-default values. */
export function advancedSummary(form: Form): string {
  const a = s.advanced;
  const parts: string[] = [];
  const name = form.name.trim();
  if (name && name !== autoName(form.baseUrl)) { parts.push(a.summary.name(name)); }
  const max = parseMaxOutput(form.maxOutput);
  if (max != null) { parts.push(a.summary.maxOutput(max)); }
  if (form.effort !== 'default') { parts.push(a.summary.effort(a.efforts[form.effort])); }
  if (form.protocol === 'anthropic_messages' && form.authHeader === 'bearer') { parts.push(a.summary.auth); }
  if (form.protocol === 'openai_responses' && form.store) { parts.push(a.summary.storeOn); }
  const budget = parseBudget(form.budget);
  if (budget != null && budget !== DEFAULT_BUDGET) { parts.push(a.summary.budget(budget)); }
  if (parts.length === 0) { return form.protocol === 'openai_responses' ? a.summaryOpenai : a.summaryAnthropic; }
  return parts.slice(0, 2).join(' · ');
}

/** S02c rule 3: seconds with one decimal, never below 0.1. */
export function seconds(ms: number): string {
  return Math.max(0.1, Math.round(ms / 100) / 10).toFixed(1);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** "上次测试：M月D日 HH:mm". */
export function testTime(iso: string): string {
  const d = new Date(Date.parse(iso));
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type FixTarget = 'baseUrl' | 'key' | 'model' | 'protocol';
export interface Failure {
  title: string;
  message: string;
  fix: FixTarget | null;
  /** Only AI errors have a D05 detail. */
  info: AiErrorInfo | null;
}

/** S02c §4 failure classes. */
export function classifyFailure(info: AiErrorInfo, models: string[] | null): Failure {
  const c = s.test.categories;
  switch (info.code) {
    case 'AI_NETWORK': case 'AI_TIMEOUT':
      return { title: c.network, message: info.message, fix: 'baseUrl', info };
    case 'AI_AUTH':
      return { title: c.key, message: info.message, fix: 'key', info };
    case 'AI_PERMISSION':
      return { title: c.key, message: info.message, fix: 'model', info };
    case 'AI_NOT_FOUND':
      return models !== null
        ? { title: c.notFound, message: `${info.message}${s.test.listedButNotFound}`, fix: 'model', info }
        : { title: c.notFound, message: info.message, fix: 'baseUrl', info };
    case 'AI_PROTOCOL_MISMATCH':
      return { title: c.protocol, message: info.message, fix: 'protocol', info };
    case 'AI_QUOTA':
      return { title: c.quota, message: info.message, fix: null, info };
    case 'AI_RATE_LIMIT':
      return { title: c.quota, message: s.test.rateLimit, fix: null, info };
    default:
      return { title: c.server, message: info.message, fix: null, info };
  }
}

export const keyUnavailableFailure: Failure = {
  title: s.test.categories.keyUnavailable, message: s.test.keyUnavailable, fix: 'key', info: null,
};

/** Failure for a completed TestResult, or null when it passed. */
export function resultFailure(result: TestResult): Failure | null {
  return result.ok || !result.error ? null : classifyFailure(result.error, result.models);
}

// ---- S02a model list ----

const NON_TEXT = ['embed', 'tts', 'whisper', 'transcribe', 'dall-e', 'gpt-image', 'moderation', 'realtime', 'audio'];
export const isNonText = (id: string) => { const lower = id.toLowerCase(); return NON_TEXT.some(part => lower.includes(part)); };
/** S02a rule 3: lower case, then drop spaces, -, _ and . before a substring match. */
export const searchKey = (text: string) => text.toLowerCase().replace(/[\s\-_.]/g, '');

let collator: Intl.Collator | null | undefined;
/** S02a rule 2: numeric-aware order, e.g. claude-sonnet-4-5 before claude-sonnet-5. */
export function sortModels(models: string[]): string[] {
  if (collator === undefined) {
    try { collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }); } catch { collator = null; }
  }
  const compare = collator ? collator.compare : (a: string, b: string) => a.localeCompare(b);
  return [...models].sort(compare);
}

/** S02a rule 6 cache identity: no Key or Key hash, only the page's Key edit generation. */
export function listCacheKey(form: Form, revision: number | undefined, keyGeneration: number): string | null {
  try {
    const url = resolveUrl(form.protocol, form.baseUrl, 'models');
    return [form.protocol, url, form.protocol === 'anthropic_messages' ? form.authHeader : 'bearer', revision ?? 0, keyGeneration].join('|');
  } catch { return null; }
}
