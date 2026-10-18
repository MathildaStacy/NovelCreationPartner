/** S07b shared by the editor and chapter list. */
import * as chapters from '../../features/chapters';
import { previewFinalization } from '../../features/finalizationPlans';
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
    const again = c.state === 'modified';
    const heading = chapterHeading({ ...c, title: truncate(c.title, 12) });
    while (true) {
      try {
        const plan = await previewFinalization(c.id);
        const labels = { summarize: '章节摘要', extract_memory: '设定变化', detect_conflicts: '冲突检查' };
        const notes = [again ? t.finalize.againBold : t.finalize.firstBold,
          ...plan.routes.map(route => `${labels[route.kind]}：${route.name} · ${route.model || '未绑定模型'} · ${route.calls} 个请求块`),
          `整个定稿操作计划 ${plan.plannedCalls} 次请求，含重试最多 ${plan.maxPosts} 次；预计输入合计约 ${plan.estimatedInputTokens} token，输出总预留上限 ${plan.maxReservedOutputTokens} token。服务价格未知，费用未知。`,
          plan.incremental ? '设定提取只读变更段落及邻段；删除旧证据会提出审核。摘要和冲突检查覆盖完整定稿。' : '首次定稿分析本章全文；所有设定建议由你审核。',
          ...(plan.reason ? [plan.reason, '定稿版本仍保存在本机，AI 整理保持暂停。'] : ['只向这里列出的服务发送。首次外发前仍需确认数据说明。']),
        ];
        let key: string;
        do {
          key = await showDialog({
            title: again ? t.finalize.again(heading) : t.finalize.first(heading),
            message: '保存一个永久定稿版本，依次生成摘要、提出设定变化并检查冲突。正式设定由你确认。',
            notes,
            buttons: [
              { key: 'cancel', label: t.common.cancel },
              { key: 'preview', label: '查看发送内容' },
              { key: 'finalize', label: again ? t.finalize.confirmAgain : t.finalize.confirmFirst,
                style: 'primary', run: () => chapters.finalize(c.id, { plan }) },
            ],
            dismissKey: 'cancel',
          });
          if (key === 'preview') {
            await showDialog({ title: '本次实际发送内容', message: plan.reason ?? '预览与后台发送使用同一份不可变计划。',
              notes: plan.tasks.flatMap(task => task.chunks.map((chunk, index) => `${labels[task.kind]} · 第 ${index + 1} 块 · ${chunk.contextPlan.serviceSnapshot.name}\n${chunk.contextPlan.serviceSnapshot.model}\n${chunk.contextPlan.serializedRequest}`)),
              buttons: [{ key: 'back', label: '返回定稿确认', style: 'primary' }], dismissKey: 'back' });
          }
        } while (key === 'preview');
        if (key !== 'finalize') {
          return false;
        }
        toast(!plan.eligible ? t.finalize.donePaused : editorCopy.queued, {
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
