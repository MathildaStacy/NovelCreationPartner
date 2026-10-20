import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useLoad } from '../../app/hooks';
import { showAiErrorDetail } from '../../app/errors';
import * as conversations from '../../features/conversations';
import * as services from '../../features/modelServices';
import * as works from '../../features/works';
import * as chapters from '../../features/chapters';
import { toLocalIso } from '../../utils/id';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import type { Message } from '../../features/types';
import { formatTime } from '../../utils/format';
import { styles } from '../archive/shared';

export function messageDraft(message: Message, title?: string): string {
  const structured = message.structured;
  if (!structured) { return message.content; }
  return [title ? `${title} · AI 伙伴整理（${toLocalIso(new Date(message.createdAt)).slice(0, 16).replace('T', ' ')}）` : '', structured.known.length ? `已明确\n${structured.known.map(item => `· ${item}`).join('\n')}` : '',
    structured.questions.length ? `还需要你决定\n${structured.questions.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    structured.options.length ? `可选方向\n${structured.options.map((item, index) => `方向 ${index + 1}：${item.title}（${item.state === 'adopted' ? '已采纳' : item.state === 'stashed' ? '已暂存' : item.state === 'dismissed' ? '已否决' : '未处理'}）\n概括：${item.summary}\n走向：${item.direction}\n风险：${item.risks}\n影响：${item.impact}`).join('\n\n')}` : ''].filter(Boolean).join('\n\n');
}
/** S10e copies complete content and preserves unknown usage. */
export function MessageActionsSheet({ message, canRegenerate, generationBusy = false, onRegenerate, onClose }: {
  message: Message | null; canRegenerate: boolean; generationBusy?: boolean; onRegenerate: (message: Message) => void; onClose: () => void;
}) {
  const [detail, setDetail] = useState(false);
  const loaded = useLoad(async () => {
    if (!message) { return null; }
    const conversation = await conversations.get(message.conversationId);
    const work = await works.get(conversation.workId);
    const chapterNumber = conversation.scope.chapterId ? await chapters.numberOf(conversation.scope.chapterId).catch(() => null) : null;
    const service = message.serviceId ? await services.get(message.serviceId).catch(() => null) : null;
    return { service, title: work.title ?? '未命名作品', scope: conversation.scope.kind === 'chapter' ? `仅第 ${chapterNumber ?? '—'} 章相关` : '相关已确认设定' };
  }, [message?.id]);
  const copy = (text: string, label = '已复制') => { try { Clipboard.setString(text); toast(label); onClose(); setDetail(false); } catch { toast('没有复制成功，请重试'); } };
  const detailText = message ? [`模型服务：${loaded.data?.service?.name ?? '（已删除的服务）'}`, `模型：${message.model ?? '—'}`, `输入：${message.usage?.input == null ? '未返回，可能已计费' : `${message.usage.input.toLocaleString()} token`}`, `输出：${message.usage?.output == null ? '未返回，可能已计费' : `${message.usage.output.toLocaleString()} token`}`, `时间：${formatTime(message.createdAt)}`, `参考范围：${loaded.data?.scope ?? '—'}`].join('\n') : '';
  return <Sheet visible={!!message} title={detail ? '消息详情' : '消息操作'} onRequestClose={() => { onClose(); setDetail(false); }}>
    {message ? <ScrollView contentContainerStyle={styles.content}>
      {detail ? <>
        <Txt selectable>{detailText}</Txt><Txt>token 数由模型服务返回，费用以服务商账单为准。失败、取消或未返回用量不表示免费。</Txt>
        <Button label="复制详情" variant="text" onPress={() => copy(detailText)} />
        <Button label="关闭详情" variant="text" onPress={() => setDetail(false)} />
      </> : <>
        {message.content.trim() ? <Button label="复制文本" variant="quiet" onPress={() => copy(message.content.trim())} /> : null}
        {message.role === 'assistant' ? <>
          {message.status === 'done' && message.structured ? <Button label="复制为设定草稿" variant="quiet" onPress={() => copy(messageDraft(message, loaded.data?.title), '已复制为设定草稿')} /> : null}
          {canRegenerate ? <Button label="重新生成" variant="quiet" disabled={generationBusy} onPress={() => { onRegenerate(message); onClose(); }} /> : null}
          {canRegenerate && generationBusy ? <Txt variant="caption">另一个回复正在生成</Txt> : null}
          <Button label="查看详情" variant="quiet" onPress={async () => { if (message.status === 'error' && message.error) { await showAiErrorDetail(message.error, loaded.data?.service ?? undefined); } else { setDetail(true); } }} />
        </> : null}
        <Button label="取消" variant="text" onPress={onClose} />
      </>}
    </ScrollView> : null}
  </Sheet>;
}
