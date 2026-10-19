/** Shared dialogs D02 (delete), D03 (connect model), D04 (discard changes). */
import { showDialog } from '../components/overlay/store';
import type { ModelServiceParams } from './navigation/types';
import { getTaskService, type TaskRoute } from '../features/taskServices';
import * as modelServices from '../features/modelServices';
import type { ModelService } from '../features/types';
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

const D01_ROWS = [
  '描写与改写：选中文字、前后约 1500 字和相关设定。',
  'AI 伙伴：你的消息、最近对话和参考范围内的设定。',
  '条目补全：该条目字段和相关条目摘要。',
  '定稿整理：本章正文、相关设定和最近章节摘要。',
];
const D01_KEY = 'API Key 只用于这个服务的请求，不会发往其他地方。';
const hostOf = (url: string) => { try { return new URL(url).host.toLowerCase(); } catch { return ''; } };

/** D01 #3: the OpenAI 不在服务端保存 line for the services that use `host`; null when none speaks OpenAI Responses. */
export function storeNote(services: Pick<ModelService, 'protocol' | 'options'>[]): string | null {
  const openai = services.filter(service => service.protocol === 'openai_responses');
  if (!openai.length) { return null; }
  return openai.some(service => service.options.store)
    ? '这个服务允许 OpenAI 在服务端保存请求，可以在高级设置中更改'
    : '已设置请求不在 OpenAI 服务端保存';
}

/**
 * D01 confirm mode: explicit acknowledgement before work content first leaves this
 * device for `host`. Resolves true on 知道了，继续. `readonly` is kept for older
 * callers and shows the settings variant instead.
 */
export async function confirmAiData(host: string, readonly = false): Promise<boolean> {
  if (readonly) { await showAiDataNotice(); return false; }
  const services = await modelServices.list().catch(() => [] as ModelService[]);
  const note = storeNote(services.filter(service => hostOf(service.baseUrl) === host.toLowerCase()));
  const key = await showDialog({
    title: '发送前请确认',
    message: `为了生成内容，App 会把下面这些内容从你的手机直接发送到 ${host}，由该服务商按其政策处理。App 没有自己的服务器。`,
    notes: [...D01_ROWS, ...(note ? [note] : []), D01_KEY],
    buttons: [
      { key: 'continue', label: '知道了，继续', style: 'primary' },
      { key: 'cancel', label: '取消' },
    ],
    dismissKey: 'cancel',
  });
  return key === 'continue';
}

/** D01 read-only mode (S15 #8, S15f #4): every added service as "名称：域名", one per line. */
export async function showAiDataNotice(): Promise<void> {
  const services = await modelServices.list().catch(() => [] as ModelService[]);
  const lines = services.length ? services.map(service => `${service.name}：${hostOf(service.baseUrl)}`) : ['你还没有连接模型服务'];
  await showDialog({
    title: 'AI 会发送哪些内容',
    message: `使用 AI 功能时，App 会把下面这些内容从你的手机直接发送到你配置的模型服务，由该服务商按其政策处理。App 没有自己的服务器。\n${lines.join('\n')}`,
    notes: [...D01_ROWS, D01_KEY],
    buttons: [{ key: 'close', label: '关闭', style: 'primary' }],
    dismissKey: 'close',
  });
}
