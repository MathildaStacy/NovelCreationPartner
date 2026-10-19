/**
 * Error presentation (G01 §4, G02 §8, D05). Services throw AppError; anything
 * else (a raw SQLite exception) is treated as DB_ERROR.
 */
import Clipboard from '@react-native-clipboard/clipboard';
import { Platform } from 'react-native';
import { AppError, isAppError } from '../features/errors';
import { showDialog, toast } from '../components/overlay/store';
import { toLocalIso } from '../utils/id';
import { formatDateTime, formatTime } from '../utils/format';
import { resolveUrl } from '../features/modelServiceConfig';
import type { AiErrorInfo, Protocol } from '../features/types';
import { aiText } from '../locales/ai';
import { settingsText } from '../locales/settings';
import { t } from '../locales/zh-CN';

import * as appInfo from '../features/appInfo';

export function toAppError(e: unknown): AppError {
  if (isAppError(e)) {
    return e;
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/SQLITE_FULL|database or disk is full|No space left/i.test(msg)) {
    return new AppError('STORAGE_FULL', msg);
  }
  return new AppError('DB_ERROR', msg);
}

/** D05 copy format for a local error: no keys, no body text (D05 §2). */
export function errorDetailText(e: AppError, summary: string, at: Date = new Date()): string {
  const tech = Array.from(e.message).slice(0, 300).join('');
  return [
    t.errors.detailHeader,
    `说明：${summary}`,
    `错误码：${e.code}`,
    `技术信息：${tech}`,
    `时间：${toLocalIso(at).replace('T', ' ').replace(/\.\d{3}/, ' ')}`,
    `App：${appInfo.label()}，${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${String(Platform.Version)}`,
  ].join('\n');
}

/** D05 for local errors: fields + 复制详情. */
export async function showErrorDetail(e: unknown, summary: string, at: Date = new Date()): Promise<void> {
  const err = toAppError(e);
  const key = await showDialog({
    title: t.errors.detailTitle,
    message: summary,
    notes: [`错误码：${err.code}`, `技术信息：${Array.from(err.message).slice(0, 300).join('')}`, `时间：${formatDateTime(at.toISOString())}`],
    buttons: [
      { key: 'copy', label: t.errors.copyDetail },
      { key: 'close', label: t.common.close, style: 'primary' },
    ],
    dismissKey: 'close',
  });
  if (key === 'copy') {
    Clipboard.setString(errorDetailText(err, summary, at));
    toast(t.common.copied);
  }
}

const copyTime = (at: Date) => toLocalIso(at).replace('T', ' ').replace(/\.\d{3}/, ' ');

/** Where an AI error came from; D05 shows protocol and the request address without scheme/query. */
export interface AiErrorSource {
  protocol: Protocol;
  baseUrl: string;
  kind?: 'generate' | 'models';
}

function aiDetailRows(info: AiErrorInfo, source: AiErrorSource): { label: string; value: string }[] {
  const d = settingsText.errorDetail;
  let url = '';
  try { url = resolveUrl(source.protocol, source.baseUrl, source.kind ?? 'generate').replace(/^https?:\/\//, ''); } catch { /* omit the row */ }
  const status = info.status == null ? `${d.noResponse} · ${info.code}` : `${info.status} · ${info.code}`;
  return [
    { label: d.service, value: info.serviceName },
    { label: d.protocol, value: settingsText.form.protocols[source.protocol] },
    { label: d.model, value: info.model },
    { label: d.url, value: url },
    { label: d.status, value: status },
    { label: d.provider, value: info.providerMessage ?? '' },
    { label: d.requestId, value: info.requestId ?? '' },
  ].filter(row => row.value);
}

/** D05 copy format for an AI error (D05 §3). AiErrorInfo is already sanitized; never add Keys or bodies. */
export function aiErrorDetailText(info: AiErrorInfo, source: AiErrorSource): string {
  const d = settingsText.errorDetail;
  const rows = aiDetailRows(info, source).map(row => {
    if (row.label === d.service) { return `${d.service}：${info.serviceName}（${settingsText.form.protocols[source.protocol]}）`; }
    if (row.label === d.protocol) { return null; }
    if (row.label === d.status) { return `${d.status}：${info.status == null ? d.noResponse : info.status}（${info.code}）`; }
    return `${row.label}：${row.value}`;
  }).filter((row): row is string => row !== null);
  const at = new Date(Date.parse(info.at));
  return [
    t.errors.detailHeader,
    `说明：${info.message}`,
    ...rows,
    `${d.time}：${copyTime(Number.isNaN(at.getTime()) ? new Date() : at)}`,
    `App：${appInfo.label()}，${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${String(Platform.Version)}`,
  ].join('\n');
}

/** D05 for AI errors (S02c, S02a, S15a toasts): sanitized fields and 复制详情. */
export async function showAiErrorDetail(info: AiErrorInfo, source: AiErrorSource): Promise<void> {
  const d = settingsText.errorDetail;
  const notes = aiDetailRows(info, source).map(row => `${row.label}：${row.value}`);
  if (info.message === aiText.redirected) { notes.push(d.redirect); }
  notes.push(`${d.time}：${formatTime(info.at)}`);
  const key = await showDialog({
    title: d.title,
    message: info.message,
    notes,
    buttons: [
      { key: 'copy', label: t.errors.copyDetail },
      { key: 'close', label: t.common.close, style: 'primary' },
    ],
    dismissKey: 'close',
  });
  if (key === 'copy') {
    Clipboard.setString(aiErrorDetailText(info, source));
    toast(t.common.copied);
  }
}

/**
 * Shows an error the way G01 §4 grades it. Field errors (VALIDATION / DUPLICATE
 * with a field) should be shown inline by the caller before falling back here.
 * `title` names the failed action for modal errors, e.g. "定稿没有成功".
 */
export async function showError(e: unknown, opts: { title?: string } = {}): Promise<void> {
  const err = toAppError(e);
  switch (err.code) {
    case 'AI_CANCELLED':
      return;
    case 'AI_RESULT_STALE':
    case 'AI_BUDGET_EXCEEDED':
    case 'NO_SERVICE':
    case 'KEY_UNAVAILABLE':
    case 'NOT_FOUND':
    case 'CONFLICT_STATE':
    case 'VALIDATION':
    case 'DUPLICATE':
    case 'BACKUP_INVALID':
    case 'BACKUP_TOO_NEW':
      // Expected, explained outcomes — never the "本机数据库出了问题" dialog.
      toast(err.message);
      return;
    case 'STORAGE_FULL':
      await showDialog({
        title: opts.title ?? t.errors.notSaved,
        message: t.errors.storageFull,
        buttons: [{ key: 'ok', label: t.common.gotIt, style: 'primary' }],
        dismissKey: 'ok',
      });
      return;
    default: {
      const summary = opts.title ?? t.errors.genericTitle;
      const key = await showDialog({
        title: summary,
        message: t.errors.dbError,
        buttons: [
          { key: 'copy', label: t.errors.copyDetail },
          { key: 'ok', label: t.common.gotIt, style: 'primary' },
        ],
        dismissKey: 'ok',
      });
      if (key === 'copy') {
        Clipboard.setString(errorDetailText(err, summary));
        toast(t.common.copied);
      }
    }
  }
}

/** Logs and swallows; for fire-and-forget calls like works.touch (S03 §4). */
export function logError(where: string) {
  return (e: unknown) => console.warn(`[${where}]`, e);
}
