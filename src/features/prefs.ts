/** Preferences (G02 §5.12). Values are JSON in the preferences table. */
import { db } from '../data/db';
import { emit } from './events';
import type { ISO, PartnerScopeKind, Protocol } from './types';

export interface Prefs {
  onboardingDone: boolean;
  /** serviceHost → when D01 was acknowledged. */
  aiNoticeAcknowledged: Record<string, ISO>;
  editorFont: 'serif' | 'sans';
  editorFontSize: 16 | 18 | 20;
  candidateCount: 1 | 2 | 3;
  partnerScope: PartnerScopeKind;
  shelfFilter: 'all' | 'ongoing' | 'finished';
  recentModels: { protocol: Protocol; model: string; at: ISO }[];
}

export const DEFAULTS: Prefs = {
  onboardingDone: false,
  aiNoticeAcknowledged: {},
  editorFont: 'serif',
  editorFontSize: 18,
  candidateCount: 1,
  partnerScope: 'confirmed',
  shelfFilter: 'all',
  recentModels: [],
};

export async function get<K extends keyof Prefs>(key: K): Promise<Prefs[K]> {
  const r = await db().get<{ value: string }>('SELECT value FROM preferences WHERE key = ?', [key]);
  if (!r) {
    return DEFAULTS[key];
  }
  try {
    return JSON.parse(r.value) as Prefs[K];
  } catch {
    return DEFAULTS[key];
  }
}

export async function set<K extends keyof Prefs>(key: K, value: Prefs[K]): Promise<void> {
  await db().run(
    'INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
  emit('prefs.changed', { key });
}
