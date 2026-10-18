/**
 * Startup (G02 §10):
 * 1. open the database and migrate (failure → error page, the app does not start);
 * 2–3. trash purge, job / message recovery (failures are logged, startup continues);
 * 4. route: onboardingDone = false → S01, else S03. Phase 1 has no S01/S02 yet,
 *    so both routes land on the shelf.
 */
import { setDb, type Db } from '../data/db';
import { migrate } from '../data/migrations';
import { runStartupMaintenance } from '../features/maintenance';
import * as prefs from '../features/prefs';

export type BootResult =
  | { ok: true; route: 'Shelf'; onboardingDone: boolean }
  | { ok: false; stage: 'open' | 'migrate'; error: unknown };

export async function boot(open: () => Db): Promise<BootResult> {
  let d: Db;
  try {
    d = open();
  } catch (error) {
    return { ok: false, stage: 'open', error };
  }
  try {
    await migrate(d);
  } catch (error) {
    return { ok: false, stage: 'migrate', error };
  }
  setDb(d);
  await runStartupMaintenance();
  let onboardingDone = false;
  try {
    onboardingDone = await prefs.get('onboardingDone');
  } catch (e) {
    console.warn('[startup] read onboardingDone failed', e);
  }
  // S01 / S02 are not built in phase 1: everyone starts on the shelf.
  return { ok: true, route: 'Shelf', onboardingDone };
}
