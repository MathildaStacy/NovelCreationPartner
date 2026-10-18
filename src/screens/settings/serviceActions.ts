/** S15a list tests and D02 for model services, shared by S15 and S02. */
import { create } from 'zustand';
import { showAiErrorDetail, showError } from '../../app/errors';
import { showDialog, toast } from '../../components/overlay/store';
import { isAppError } from '../../features/errors';
import * as modelServices from '../../features/modelServices';
import type { ID, ModelService } from '../../features/types';
import { aiText } from '../../locales/ai';
import { settingsText } from '../../locales/settings';
import { t } from '../../locales/zh-CN';
import { resultFailure, seconds } from './model/form';

const a = settingsText.serviceActions;

/** Which saved services are being tested from S15 (IDs only, never configuration or Keys). */
export const useServiceTests = create<{ testing: Record<ID, true> }>(() => ({ testing: {} }));
const controllers = new Map<ID, AbortController>();

function mark(id: ID, on: boolean) {
  useServiceTests.setState(state => {
    const testing = { ...state.testing };
    if (on) { testing[id] = true; } else { delete testing[id]; }
    return { testing };
  });
}

/** Aborts an in-list test (S15a rule: deleting a service being tested stops it first). */
export function abortServiceTest(id: ID): void {
  controllers.get(id)?.abort();
}

/**
 * S15a 测试连接 (S02c list variant): persists lastTest through the service layer.
 * The request keeps running when the page is left; `notify` decides whether the
 * result may still show a toast (only on the same, focused S15).
 */
export async function runServiceTest(service: ModelService, notify: () => boolean): Promise<void> {
  if (controllers.has(service.id)) { return; }
  const controller = new AbortController();
  controllers.set(service.id, controller);
  mark(service.id, true);
  const visible = () => notify() && !controller.signal.aborted;
  try {
    const detail = await modelServices.get(service.id);
    const result = await modelServices.test(detail, undefined, { signal: controller.signal, persist: true });
    if (!visible()) { return; }
    const failure = resultFailure(result);
    if (!failure) {
      toast(a.testOk(detail.name, seconds(result.latencyMs)));
    } else {
      const info = failure.info!;
      toast(a.testFailed(detail.name, failure.title), {
        action: { label: t.common.viewDetail, onPress: () => { showAiErrorDetail(info, detail); } },
      });
    }
  } catch (e) {
    if (!visible() || isAppError(e, 'AI_CANCELLED')) { return; }
    if (isAppError(e, 'KEY_UNAVAILABLE')) { toast(a.keyUnavailable); }
    else if (isAppError(e, 'NOT_FOUND')) { toast(settingsText.form.gone); }
    else { showError(e); }
  } finally {
    if (controllers.get(service.id) === controller) {
      controllers.delete(service.id);
      mark(service.id, false);
    }
  }
}

/** S15 row state (S15a §3). */
export function serviceStatus(service: ModelService, testing: boolean): { text: string; tone: 'plain' | 'warn' | 'error' } {
  const st = a.status;
  if (testing) { return { text: st.testing, tone: 'plain' }; }
  if (!service.hasKey) { return { text: st.noKey, tone: 'warn' }; }
  if (!service.lastTest) { return { text: st.untested, tone: 'plain' }; }
  if (service.lastTest.ok) { return { text: st.ok, tone: 'plain' }; }
  return service.lastTest.message === aiText.auth ? { text: st.badKey, tone: 'error' } : { text: st.failed, tone: 'error' };
}

/**
 * D02 #service. `all` is the list the caller shows (default first, then by
 * creation), so the successor is the first remaining entry, matching the service
 * layer's created_at order. Resolves true when deleted.
 */
export async function removeService(service: ModelService, all: ModelService[]): Promise<boolean> {
  const d = settingsText.deleteService;
  const others = all.filter(item => item.id !== service.id);
  const notes = others.length === 0 ? [d.last] : service.isDefault ? [d.successor(others[0].name)] : undefined;
  let pending = false;
  try {
    const key = await showDialog({
      title: d.title(service.name),
      message: d.body,
      notes,
      buttons: [
        { key: 'cancel', label: t.common.cancel },
        {
          key: 'delete', label: d.button, style: 'primary',
          run: async () => {
            abortServiceTest(service.id);
            pending = (await modelServices.remove(service.id)).keyCleanupPending;
          },
        },
      ],
      dismissKey: 'cancel',
    });
    if (key !== 'delete') { return false; }
    toast(pending ? a.deletedPending : a.deleted);
    return true;
  } catch (e) {
    if (isAppError(e, 'NOT_FOUND')) { toast(settingsText.form.gone); return true; }
    showError(e);
    return false;
  }
}
