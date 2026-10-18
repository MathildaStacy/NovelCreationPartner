/**
 * Model services (G02 §5.11). Phase 1 only needs the read side: S04, S07 and
 * S07b ask for the default service before any AI action. Saving, keys and
 * connection tests come with S02.
 */
import { db } from '../data/db';
import type { ID, ISO, ModelService, Protocol } from './types';

interface ServiceRow {
  id: string;
  name: string;
  protocol: string;
  base_url: string;
  model: string;
  options: string;
  is_default: number;
  has_key: number;
  last_test_at: string | null;
  last_test_ok: number | null;
  last_test_message: string | null;
}

const DEFAULT_OPTIONS: ModelService['options'] = {
  maxOutputTokens: null,
  effort: 'default',
  authHeader: 'x-api-key',
  store: false,
  contextBudget: 24000,
  caps: {},
};

function toService(r: ServiceRow): ModelService {
  let options = DEFAULT_OPTIONS;
  try {
    options = { ...DEFAULT_OPTIONS, ...(JSON.parse(r.options) as Partial<ModelService['options']>) };
  } catch {
    // keep defaults
  }
  return {
    id: r.id,
    name: r.name,
    protocol: r.protocol as Protocol,
    baseUrl: r.base_url,
    model: r.model,
    isDefault: Number(r.is_default) === 1,
    options,
    hasKey: Number(r.has_key) === 1,
    lastTest:
      r.last_test_at != null
        ? { at: r.last_test_at as ISO, ok: Number(r.last_test_ok) === 1, message: r.last_test_message ?? '' }
        : null,
  };
}

/** Default service first, then by creation time. */
export async function list(): Promise<ModelService[]> {
  const rows = await db().all<ServiceRow>('SELECT * FROM model_services ORDER BY is_default DESC, created_at');
  return rows.map(toService);
}

/** null when no service exists; callers then show D03. */
export async function getDefault(): Promise<ModelService | null> {
  const r = await db().get<ServiceRow>('SELECT * FROM model_services WHERE is_default = 1 LIMIT 1');
  return r ? toService(r) : null;
}

export async function get(id: ID): Promise<ModelService | null> {
  const r = await db().get<ServiceRow>('SELECT * FROM model_services WHERE id = ?', [id]);
  return r ? toService(r) : null;
}
