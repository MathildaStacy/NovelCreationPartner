/** S07b shared by the editor and chapter list. */
import * as chapters from '../../features/chapters';
import * as jobs from '../../features/jobs';
import * as modelServices from '../../features/modelServices';
import type { ChapterKind, ChapterState, ID } from '../../features/types';
import { isAppError } from '../../features/errors';
import { showError } from '../../app/errors';
import { showDialog, toast } from '../../components/overlay/store';
import { t } from '../../locales/zh-CN';
import { editorCopy } from '../../locales/editor';
import { chapterHeading, truncate } from '../../utils/format';

export interface FinalizeTarget {
  id: ID;
  kind: ChapterKind;
  state: ChapterState;
  number: number | null;
  title: string;
  charCount: number;
}

const pending = new Set<ID>();
/** Caller must flush the body first. The set also prevents duplicate dialogs. */
export async function finalizeWithConfirm(c: FinalizeTarget): Promise<boolean> {
  if (pending.has(c.id) || c.kind !== 'main' || c.state === 'finalized') {
    return false;
  }
  if (!c.charCount) {
    toast(t.editor.emptyFinalize);
    return false;
  }
  pending.add(c.id);
  try {
    const service = await modelServices.getDefault();
    const again = c.state === 'modified';
    const heading = chapterHeading({ ...c, title: truncate(c.title, 12) });
    const notes: string[] = [
      again ? t.finalize.againBold : t.finalize.firstBold,
    ];
    if (!service) {
      notes.push(t.finalize.noService);
    } else if (!service.hasKey) {
      notes.push(t.finalize.noKey);
    }
    notes.push(editorCopy.aiPending);
    while (true) {
      try {
        const key = await showDialog({
          title: again ? t.finalize.again(heading) : t.finalize.first(heading),
          message: again ? t.finalize.againBody : t.finalize.firstBody,
          notes,
          buttons: [
            { key: 'cancel', label: t.common.cancel },
            {
              key: 'finalize',
              label: again ? t.finalize.confirmAgain : t.finalize.confirmFirst,
              style: 'primary',
              run: () => chapters.finalize(c.id),
            },
          ],
          dismissKey: 'cancel',
        });
        if (key !== 'finalize') {
          return false;
        }
        // There is no AI runner in this phase. Only pause states implemented by the local queue are reported.
        await jobs.pauseWithoutService().catch(() => {});
        toast(!service ? t.finalize.donePaused : editorCopy.queued, {
          duration: 4000,
        });
        return true;
      } catch (e) {
        if (isAppError(e, 'VALIDATION')) {
          toast(t.editor.emptyFinalize);
          return false;
        }
        await showError(e, { title: t.finalize.failed });
        if (isAppError(e, 'NOT_FOUND')) {
          return false;
        }
        // Reopen the confirmation so a failed transaction can be retried safely.
      }
    }
  } catch (e) {
    await showError(e, { title: t.finalize.failed });
    return false;
  } finally {
    pending.delete(c.id);
  }
}
