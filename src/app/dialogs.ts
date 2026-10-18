/** Shared dialogs D02 (delete), D03 (connect model), D04 (discard changes). */
import { showDialog } from '../components/overlay/store';
import type { ModelServiceParams } from './navigation/types';
import { getTaskService, type TaskRoute } from '../features/taskServices';
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

/** Where D03 sends the author (S02 §2): no service → new service; missing Key → edit it with the Key focused. */
export interface ConnectNavigation {
  navigate(name: 'ModelService', params: ModelServiceParams): void;
}

/**
 * AI entry check, step 1 (S07 §5.4, D03). Checks the author's task binding,
 * falling back to the default only when no explicit binding exists.
 * With no service or Key, shows D03 and returns what the user chose:
 * 'connect' (S02 opened on top of the calling page when `navigation` is given)
 * or 'skip'. A screen can discard late results with `isActive`; cancelled
 * checks show no UI. Returning from S02 never auto-resumes a model operation.
 */
export async function ensureModelService(
  isActive: () => boolean = () => true,
  navigation?: ConnectNavigation,
  route: TaskRoute = 'writing',
): Promise<'ok' | 'connect' | 'skip' | 'cancelled'> {
  const svc = await getTaskService(route);
  if (!isActive()) {
    return 'cancelled';
  }
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
  if (!isActive()) {
    return 'cancelled';
  }
  if (key !== 'connect') {
    return 'skip';
  }
  navigation?.navigate('ModelService', svc
    ? { mode: 'edit', from: 'd03', serviceId: svc.id, focus: 'key' }
    : { mode: 'guide', from: 'd03' });
  return 'connect';
}

/** D01: explicit acknowledgement before any work content leaves this device. */
export async function confirmAiData(host: string, readonly = false): Promise<boolean> {
  const key = await showDialog({
    title: readonly ? 'AI 会发送哪些内容' : '发送前请确认',
    message: `App 会将所选内容从本机直接发送到 ${host}，由服务商按其政策处理。App 没有自己的服务器。`,
    notes: [
      '描写与改写：选中文字、前后文和相关设定。',
      'AI 伙伴：你的消息、最近对话和参考范围内的设定。',
      '条目补全：该条目字段和相关摘要。',
      '定稿整理：本章正文、相关设定和最近章节摘要。',
      'API Key 只用于所选服务。正式内容始终由你确认。',
    ],
    buttons: readonly ? [{ key: 'close', label: '关闭', style: 'primary' }] : [
      { key: 'continue', label: '知道了，继续', style: 'primary' },
      { key: 'cancel', label: '取消' },
    ],
    dismissKey: readonly ? 'close' : 'cancel',
  });
  return key === 'continue';
}
