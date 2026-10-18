/** Read-only byte counts from fixed private native locations; an unavailable count stays unknown. */
export interface StorageUsage { db: number; covers: number; cache: number; }
export async function usage(): Promise<StorageUsage | null> {
  try {
    const raw: unknown = JSON.parse(await require('../native/NativeAppInfo').default.getStorageUsage());
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return null; }
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).length !== 3 || !['db', 'covers', 'cache'].every(key =>
      typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0)) { return null; }
    const result = { db: value.db as number, covers: value.covers as number, cache: value.cache as number };
    return Number.isSafeInteger(result.db + result.covers + result.cache) ? result : null;
  } catch { return null; }
}
