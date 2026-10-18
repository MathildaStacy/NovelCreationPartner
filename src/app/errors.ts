/**
 * Error presentation (G01 §4, G02 §8, D05). Services throw AppError; anything
 * else (a raw SQLite exception) is treated as DB_ERROR.
 */
import Clipboard from '@react-native-clipboard/clipboard';
import { Platform } from 'react-native';
import { AppError, isAppError } from '../features/errors';
import { showDialog, toast } from '../components/overlay/store';
import { toLocalIso } from '../utils/id';
import { t } from '../locales/zh-CN';

export const APP_VERSION = '0.0.1';

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
    `App：${APP_VERSION}，${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${String(Platform.Version)}`,
  ].join('\n');
}

/** D05 for local errors: fields + 复制详情. */
export async function showErrorDetail(e: unknown, summary: string): Promise<void> {
  const err = toAppError(e);
  const key = await showDialog({
    title: t.errors.detailTitle,
    message: summary,
    notes: [`错误码：${err.code}`, `技术信息：${Array.from(err.message).slice(0, 300).join('')}`],
    buttons: [
      { key: 'copy', label: t.errors.copyDetail },
      { key: 'close', label: t.common.close, style: 'primary' },
    ],
    dismissKey: 'close',
  });
  if (key === 'copy') {
    Clipboard.setString(errorDetailText(err, summary));
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
    case 'NOT_FOUND':
    case 'CONFLICT_STATE':
    case 'VALIDATION':
    case 'DUPLICATE':
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
