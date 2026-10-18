/** Document interaction stays behind a bounded, content-only native port. */
import { AppError } from '../features/errors';
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
export interface PickedDocument { name: string; base64: string; }
export type ShareResult = 'completed' | 'cancelled' | 'opened';
export interface FileStoreDriver {
  writeAndShare(name: string, base64: string, mime: string): Promise<string>;
  cleanupExports(): Promise<void>;
  pick(): Promise<string | null>;
}
let injected: FileStoreDriver | undefined;
export function setFileStoreDriver(next: FileStoreDriver | undefined): void { injected = next; }
function driver(): FileStoreDriver { return injected ?? require('../native/NativeDocumentStore').default as FileStoreDriver; }
export function safeDocumentName(name: string): string {
  // eslint-disable-next-line no-control-regex -- Reject path separators and control bytes before native I/O.
  const safe = name.normalize('NFC').replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/g, '_').replace(/^\.+/, '').trim();
  return [...safe].slice(0, 120).join('') || 'document';
}
function validateBase64(value: string): void {
  if (value.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 || value.length % 4 !== 0) throw new AppError('VALIDATION', '文件格式无效或超过 50 MiB');
  // Scan in constant stack space; a repeated regex over a 67 MiB payload can overflow native engines.
  const payloadEnd = value.endsWith('==') ? value.length - 2 : value.endsWith('=') ? value.length - 1 : value.length;
  for (let index = 0; index < payloadEnd; index++) {
    const code = value.charCodeAt(index);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47)) throw new AppError('VALIDATION', '文件格式无效');
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (value.length / 4 * 3 - padding > MAX_DOCUMENT_BYTES) throw new AppError('VALIDATION', '文件超过 50 MiB');
}
export async function writeAndShare(name: string, base64: string, mime: string): Promise<ShareResult> {
  validateBase64(base64);
  if (!['application/zip', 'application/json', 'text/plain', 'text/markdown', 'application/octet-stream'].includes(mime)) throw new AppError('VALIDATION', '不支持的导出格式');
  try {
    const result = await driver().writeAndShare(safeDocumentName(name), base64, mime);
    if (result !== 'completed' && result !== 'cancelled' && result !== 'opened') throw new Error('Unknown share result');
    return result;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'STORAGE_FULL') {
      throw new AppError('STORAGE_FULL', '手机存储空间不足，没有生成导出文件。请清理空间后重试。');
    }
    throw new AppError('DB_ERROR', '没有打开分享面板，请重试');
  }
}
export async function cleanupExports(): Promise<void> { await driver().cleanupExports(); }
export async function pick(): Promise<PickedDocument | null> {
  let raw: string | null;
  try { raw = await driver().pick(); } catch { throw new AppError('BACKUP_INVALID', '未能读取所选文件，请确认大小不超过 50 MiB'); }
  if (raw === null) return null;
  if (raw.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 4096) throw new AppError('BACKUP_INVALID', '所选文件超过 50 MiB');
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const document = value as Record<string, unknown>;
    if (typeof document.name !== 'string' || typeof document.base64 !== 'string') throw new Error();
    validateBase64(document.base64);
    return { name: safeDocumentName(document.name), base64: document.base64 };
  } catch { throw new AppError('BACKUP_INVALID', '所选文件格式无效或超过 50 MiB'); }
}
