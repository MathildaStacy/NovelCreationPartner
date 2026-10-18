import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import type { Message } from '../../features/types';
import { formatTime } from '../../utils/format';
import { styles } from '../archive/shared';

export function messageDraft(message: Message): string {
  const structured = message.structured;
  if (!structured) { return message.content; }
  return [message.content, structured.known.length ? `已明确\n${structured.known.map(item => `· ${item}`).join('\n')}` : '',
    structured.questions.length ? `还需要你决定\n${structured.questions.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    structured.options.length ? `可选方向\n${structured.options.map((item, index) => `方向 ${index + 1}：${item.title}（${item.state === 'adopted' ? '已采纳' : item.state === 'stashed' ? '已暂存' : item.state === 'dismissed' ? '已否决' : '未处理'}）\n概括：${item.summary}\n走向：${item.direction}\n风险：${item.risks}\n影响：${item.impact}`).join('\n\n')}` : ''].filter(Boolean).join('\n\n');
}
/** S10e copies complete content and preserves unknown usage. */
export function MessageActionsSheet({ message, canRegenerate, onRegenerate, onClose }: {
  message: Message | null; canRegenerate: boolean; onRegenerate: (message: Message) => void; onClose: () => void;
}) {
  const [detail, setDetail] = useState(false);
  const copy = (text: string) => { Clipboard.setString(text); toast('已复制'); onClose(); setDetail(false); };
  return <Sheet visible={!!message} title={detail ? '消息详情' : '消息操作'} onRequestClose={() => { onClose(); setDetail(false); }}>
    {message ? <ScrollView contentContainerStyle={styles.content}>
      {detail ? <>
        <Txt>模型：{message.model ?? '—'}</Txt><Txt>输入：{message.usage?.input == null ? '未返回，可能已计费' : `${message.usage.input.toLocaleString()} token`}</Txt>
        <Txt>输出：{message.usage?.output == null ? '未返回，可能已计费' : `${message.usage.output.toLocaleString()} token`}</Txt>
        <Txt>时间：{formatTime(message.createdAt)}</Txt><Txt>费用以服务商账单为准。失败、取消或未返回用量不表示免费。</Txt>
        <Button label="关闭详情" variant="text" onPress={() => setDetail(false)} />
      </> : <>
        <Button label="复制文本" variant="quiet" onPress={() => copy(message.content)} />
        {message.role === 'assistant' ? <>
          <Button label="复制为设定草稿" variant="quiet" onPress={() => copy(messageDraft(message))} />
          {canRegenerate ? <Button label="重新生成" variant="quiet" onPress={() => { onRegenerate(message); onClose(); }} /> : null}
          <Button label="查看模型与用量" variant="quiet" onPress={() => setDetail(true)} />
        </> : null}
        <Button label="取消" variant="text" onPress={onClose} />
      </>}
    </ScrollView> : null}
  </Sheet>;
}
