/* eslint-disable no-control-regex -- Reject controls before URL normalization or credential storage. */
/** Pure S02 validation. No database or secure-store access. */
import { validation } from './errors';
import type { ModelService, Protocol } from './types';
import { modelServiceText as t } from '../locales/modelServices';

export type ServiceDraft = Pick<ModelService, 'name' | 'protocol' | 'baseUrl' | 'model' | 'options'> & { id?: string; revision?: number };
export const DEFAULT_OPTIONS: ModelService['options'] = {
  maxOutputTokens: null, effort: 'default', authHeader: 'x-api-key', store: false,
  contextBudget: 24000, caps: {},
};
export function normalizeKey(key?: string): string | undefined {
  const value = key?.trim().replace(/^Bearer\s+/i, '');
  if (!value) return undefined;
  if (/\s/.test(value)) throw validation('key', t.validation.keyWhitespace);
  if (value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) throw validation('key', t.validation.keyLength);
  return value;
}
function privateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const octets = host.split('.').map(Number);
  if (octets.some(n => n > 255)) return false;
  const [a, b, c, d] = octets;
  return (a === 127 && b === 0 && c === 0 && d === 1) || a === 10 ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export function normalizeUrl(protocol: Protocol, input: string): string {
  const value = input.trim().replace(/\/+$/, '');
  if (value.length > 500 || !/^https?:\/\//i.test(value)) throw validation('baseUrl', t.validation.url);
  // Reject WHATWG URL's normalization of abbreviated/hex/decimal IPv4 and
  // backslashes before it can turn an untrusted public-looking input private.
  if (/[\u0000-\u0020\u007f\\]/.test(value)) throw validation('baseUrl', t.validation.urlCredentials);
  if (/[?#]/.test(value)) throw validation('baseUrl', t.validation.urlQuery);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw validation('baseUrl', t.validation.url); }
  if (!parsed.hostname) throw validation('baseUrl', t.validation.url);
  if (parsed.username || parsed.password || /@/.test(value.split('/')[2] ?? '')) throw validation('baseUrl', t.validation.urlCredentials);
  const rawHost = value.split('/')[2].split(':')[0].toLowerCase();
  if (parsed.protocol === 'http:' && (!privateHost(parsed.hostname.toLowerCase()) || rawHost !== parsed.hostname.toLowerCase())) throw validation('baseUrl', t.validation.urlHttps);
  const opposite = protocol === 'openai_responses' ? 'messages' : 'responses';
  if (parsed.pathname.endsWith(`/${opposite}`)) throw validation('baseUrl', t.validation.urlProtocol);
  return parsed.href.replace(/\/+$/, '');
}
export function resolveUrl(protocol: Protocol, input: string, kind: 'generate' | 'models'): string {
  const url = new URL(normalizeUrl(protocol, input));
  const endpoint = protocol === 'openai_responses' ? 'responses' : 'messages';
  const target = kind === 'generate' ? endpoint : 'models';
  const path = url.pathname.replace(/\/+$/, '');
  const resolved = path.endsWith(`/${endpoint}`) ? `${path.slice(0, -endpoint.length)}${target}` :
    protocol === 'openai_responses' ? `${path || '/v1'}/${target}` :
      `${path}${/\/v\d+$/.test(path) ? '' : '/v1'}/${target}`;
  return `${url.protocol}//${url.host}${resolved}`;
}
export function validateDraft(input: ServiceDraft, requireModel = true): ServiceDraft {
  if (!['openai_responses', 'anthropic_messages'].includes(input.protocol)) throw validation('protocol', t.validation.protocol);
  const name = input.name.trim();
  if ([...name].length > 30) throw validation('name', t.validation.name);
  const model = input.model.trim();
  if ((requireModel && !model) || [...model].length > 200 || /[\u0000-\u001f\u007f]/.test(model)) throw validation('model', t.validation.model);
  const options = { ...DEFAULT_OPTIONS, ...input.options, caps: { ...input.options.caps } };
  if (options.maxOutputTokens != null && (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 1 || options.maxOutputTokens > 128000)) throw validation('options.maxOutputTokens', t.validation.maxOutput);
  if (!Number.isFinite(options.contextBudget) || options.contextBudget < 8000 || options.contextBudget > 100000) throw validation('options.contextBudget', t.validation.budget);
  options.contextBudget = Math.round(options.contextBudget / 1000) * 1000;
  if (!['default', 'low', 'medium', 'high'].includes(options.effort) || !['x-api-key', 'bearer'].includes(options.authHeader) || typeof options.store !== 'boolean' || Object.values(options.caps).some(v => typeof v !== 'boolean')) throw validation('options', t.validation.options);
  return { ...input, name, model, baseUrl: normalizeUrl(input.protocol, input.baseUrl), options };
}
