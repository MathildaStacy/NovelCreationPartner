/** Private immutable covers. New bytes are prepared before the reference transaction; old bytes survive failure. */
import { db, type Db } from '../data/db';
import { isoMs, nowIso } from '../utils/id';
import { AppError, notFound } from './errors';
import { emit } from './events';
import type { ID } from './types';

export const MAX_COVER_BYTES = 30 * 1024 * 1024;
export interface CoverAsset { token: string; uri: string; }
export interface CoverStoreDriver {
  pick(): Promise<string | null>; importImage(base64: string): Promise<string>; read(token: string): Promise<string>;
  remove(token: string): Promise<void>; prune(keepTokensJson: string): Promise<void>;
}
let injected: CoverStoreDriver | undefined;
export function setCoverStoreDriver(value: CoverStoreDriver | undefined) { injected = value; }
function driver(): CoverStoreDriver { return injected ?? require('../native/NativeCoverStore').default as CoverStoreDriver; }
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function requireToken(token: string) { if (!validToken(token)) { throw new AppError('VALIDATION', '无效的封面引用'); } }
function imageError(error: unknown): AppError {
  const code = (error as { code?: string })?.code;
  if (code === 'COVER_LARGE') { return new AppError('VALIDATION', '图片太大，请换一张小于 30 MB 的图片'); }
  if (code === 'COVER_FORMAT') { return new AppError('VALIDATION', '这张图片无法使用，请换一张 JPG 或 PNG 图片'); }
  if (code === 'STORAGE_FULL') { return new AppError('STORAGE_FULL', '封面没有保存成功，原封面仍然保留'); }
  return error instanceof AppError ? error : new AppError('VALIDATION', '图片没有读取成功，请稍后重试');
}
function base64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length % 4 || value.length > Math.ceil(MAX_COVER_BYTES / 3) * 4) { return false; }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (!value.length || value.length / 4 * 3 - padding > MAX_COVER_BYTES) { return false; }
  for (let i = 0; i < value.length - padding; i++) {
    const code = value.charCodeAt(i);
    if (!(code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 43 || code === 47)) { return false; }
  }
  return true;
}
function decodeAsset(raw: string): CoverAsset {
  let value: CoverAsset;
  try { value = JSON.parse(raw); } catch { throw imageError(null); }
  if (!validToken(value?.token) || typeof value.uri !== 'string' || !value.uri.startsWith('file:///') || !value.uri.endsWith(`/covers/${value.token}.jpg`)) { throw imageError(null); }
  return { token: value.token, uri: value.uri };
}
async function register(raw: string): Promise<CoverAsset> {
  const asset = decodeAsset(raw);
  try { await db().run('INSERT INTO cover_assets(token,uri,created_at) VALUES(?,?,?)', [asset.token, asset.uri, nowIso()]); }
  catch (error) { try { await driver().remove(asset.token); } catch { /* orphan pruning retries on startup */ } throw error; }
  return asset;
}
/** Backup imports are normalized again by native code and remain unbound until an author-approved transaction. */
export async function importCover(input: { base64: string; mimeType: 'image/jpeg' }): Promise<CoverAsset> {
  if (input.mimeType !== 'image/jpeg' || !base64(input.base64)) { throw new AppError('VALIDATION', '封面文件格式无效或超过 30 MB'); }
  try { return await register(await driver().importImage(input.base64)); } catch (error) { throw imageError(error); }
}
export async function readCover(token: string): Promise<{ base64: string; mimeType: 'image/jpeg' }> {
  requireToken(token);
  if (!await db().get('SELECT token FROM cover_assets WHERE token=?', [token])) { throw notFound('封面'); }
  try { const bytes: unknown = JSON.parse(await driver().read(token));
    if (!bytes || typeof bytes !== 'object' || (bytes as { mimeType?: unknown }).mimeType !== 'image/jpeg' || !base64((bytes as { base64?: unknown }).base64)) { throw imageError(null); }
    return bytes as { base64: string; mimeType: 'image/jpeg' };
  } catch (error) { throw imageError(error); }
}
/** Called in the same transaction that removes an ownership reference (including permanent trash deletion). */
export async function enqueueCleanupIn(tx: Db, token: string): Promise<void> {
  requireToken(token); await tx.run('INSERT OR IGNORE INTO cover_cleanup(token) VALUES(?)', [token]);
}
export async function retryCleanup(): Promise<void> {
  for (const { token } of await db().all<{ token: string }>('SELECT token FROM cover_cleanup')) {
    // A restored/imported reference always wins over cleanup.
    if (await db().get('SELECT id FROM works WHERE cover_token=?', [token])) { continue; }
    try {
      await driver().remove(token);
      await db().transaction(async tx => { await tx.run('DELETE FROM cover_assets WHERE token=?', [token]); await tx.run('DELETE FROM cover_cleanup WHERE token=?', [token]); });
    } catch { /* Keep a durable retry; committed references are never rolled back for cleanup I/O. */ }
  }
}
export async function removeCover(token: string): Promise<void> {
  requireToken(token);
  if (await db().get('SELECT id FROM works WHERE cover_token=?', [token])) { throw new AppError('CONFLICT_STATE', '这张封面仍由作品使用'); }
  await db().transaction(tx => enqueueCleanupIn(tx, token)); await retryCleanup();
}
const active = new Set<ID>();
export async function set(workId: ID, choice: { kind: 'image' } | { kind: 'text' }): Promise<boolean> {
  if (active.has(workId)) { throw new AppError('CONFLICT_STATE', '这部作品正在更换封面'); }
  active.add(workId); let asset: CoverAsset | null = null; let committed = false;
  try {
    if (!await db().get('SELECT id FROM works WHERE id=? AND deleted_at IS NULL', [workId])) { throw notFound('作品'); }
    if (choice.kind === 'image') {
      let raw: string | null;
      try { raw = await driver().pick(); } catch (error) { throw imageError(error); }
      if (raw === null) { return false; }
      asset = await register(raw);
    }
    await db().transaction(async tx => {
      const row = await tx.get<{ cover_token: string | null; cover_path: string | null }>('SELECT cover_token,cover_path FROM works WHERE id=? AND deleted_at IS NULL', [workId]);
      if (!row) { throw notFound('作品'); }
      // Legacy paths have no safe native ownership token. Never delete an arbitrary path.
      await tx.run('UPDATE works SET cover_token=?,cover_path=?,updated_at=? WHERE id=?', [asset?.token ?? null, asset?.uri ?? null, nowIso(), workId]);
      if (row.cover_token) { await enqueueCleanupIn(tx, row.cover_token); }
    });
    committed = true; emit('work.updated', { workId }); await retryCleanup(); return true;
  } finally {
    active.delete(workId);
    if (asset && !committed) { await removeCover(asset.token).catch(() => {}); }
  }
}
export async function reconcile(): Promise<void> {
  // Unbound imported assets are left available for 24h; startup cleans abandoned stages afterward.
  const unbound = await db().all<{ token: string }>("SELECT token FROM cover_assets WHERE julianday(created_at)<julianday(?) AND NOT EXISTS(SELECT 1 FROM works WHERE works.cover_token=cover_assets.token)", [new Date(isoMs(nowIso()) - 86400000).toISOString()]);
  for (const asset of unbound) { await db().transaction(tx => enqueueCleanupIn(tx, asset.token)); }
  await retryCleanup();
  const keep = (await db().all<{ token: string }>('SELECT token FROM cover_assets')).map(asset => asset.token);
  await driver().prune(JSON.stringify(keep));
}
