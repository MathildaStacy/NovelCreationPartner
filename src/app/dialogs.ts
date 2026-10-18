/** Shared dialogs D02 (delete), D03 (connect model), D04 (discard changes). */
import { showDialog } from '../components/overlay/store';
import * as modelServices from '../features/modelServices';
import { t } from '../locales/zh-CN';
import { truncate } from '../utils/format';

export interface DiscardCopy {
  title?: string;
  body?: string;
  discard?: string;
}

/** D04. Resolves true when the user chooses to discard. */
export async function confirmDiscard(copy: DiscardCopy = {}): Promise<boolean> {
  const key = await showDialog({
    title: copy.title ?? t.unsaved.title,
    message: copy.body ?? t.unsaved.body,
    buttons: [
      { key: 'keep', label: t.unsaved.keep },
      { key: 'discard', label: copy.discard ?? t.unsaved.discard, style: 'primary' },
    ],
    dismissKey: 'keep',
  });
  return key === 'discard';
}

/**
 * D02 for works, chapters and volumes. `run` is the delete call; the dialog shows
 * a spinner on the button while it runs. Resolves true when deleted, false when
 * cancelled; rejects with the service error.
 */
export async function confirmDelete(opts: {
  name: string | null;
  untitled?: string;
  body: string;
  notes?: string[];
  button: string;
  run: () => Promise<unknown>;
}): Promise<boolean> {
  const key = await showDialog({
    title: opts.name ? t.confirmDelete.title(truncate(opts.name, 12)) : opts.untitled ?? t.confirmDelete.title(''),
    message: opts.body,
    notes: opts.notes,
    buttons: [
      { key: 'cancel', label: t.common.cancel },
      { key: 'delete', label: opts.button, style: 'primary', run: opts.run },
    ],
    dismissKey: 'cancel',
  });
  return key === 'delete';
}

/**
 * AI entry check, step 1 (S07 §5.4, D03). Returns 'ok' when a default service
 * with a key exists. Otherwise shows D03 and returns what the user chose:
 * 'connect' (S02 is not built yet, phase 1 shows a notice) or 'skip'.
 */
export async function ensureModelService(): Promise<'ok' | 'connect' | 'skip'> {
  const svc = await modelServices.getDefault();
  if (svc && svc.hasKey) {
    return 'ok';
  }
  const key = await showDialog({
    title: svc ? t.connectModel.titleB : t.connectModel.titleA,
    message: svc ? t.connectModel.bodyB(svc.name) : t.connectModel.bodyA,
    notes: svc ? undefined : [t.connectModel.noteA],
    buttons: [
      { key: 'connect', label: svc ? t.connectModel.fillKey : t.connectModel.connect, style: 'primary' },
      { key: 'skip', label: t.connectModel.withoutAi },
    ],
    vertical: true,
    dismissKey: 'skip',
  });
  return key === 'connect' ? 'connect' : 'skip';
}
