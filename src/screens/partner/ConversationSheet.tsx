import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { confirmDelete, confirmDiscard } from '../../app/dialogs';
import { showError } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Sheet } from '../../components/Sheet';
import { TextField } from '../../components/TextField';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import * as conversations from '../../features/conversations';
import { color as c } from '../../theme/tokens';
import { formatTime } from '../../utils/format';
import { styles } from '../archive/shared';

/** S10b conversation management is local and never needs a model connection. */
export function ConversationSheet({ visible, workId, currentId, onPick, onClose }: {
  visible: boolean; workId: string; currentId: string | null; onPick: (id: string | null) => void; onClose: () => void;
}) {
  const list = useLoad(() => visible ? conversations.list(workId) : Promise.resolve([]), [visible, workId], {
    events: { 'conversations.changed': event => event.workId === workId, 'messages.changed': () => visible },
  });
  const [renaming, setRenaming] = useState<{ id: string; original: string } | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const close = async () => {
    if (!busy && (!renaming || name.trim() === renaming.original || await confirmDiscard())) { setRenaming(null); onClose(); }
  };
  const rename = async () => {
    if (!renaming || !name.trim() || busy) { return; }
    setBusy(true);
    try { await conversations.rename(renaming.id, name.trim()); setRenaming(null); toast('已重命名'); await list.reload(); }
    catch (error) { await showError(error); } finally { setBusy(false); }
  };
  const remove = async (id: string, title: string) => {
    try {
      if (await confirmDelete({ name: title, body: '对话会永久删除。已采纳或暂存的档案会保留，之后可在档案中修改。', button: '删除对话', run: () => conversations.remove(id) })) {
        toast('已删除对话'); if (id === currentId) { onPick(null); } await list.reload();
      }
    } catch (error) { await showError(error); }
  };
  return <Sheet visible={visible} title={renaming ? '重命名对话' : '对话'} locked={busy} onRequestClose={() => { close(); }}
    headerRight={<Button label="关闭" variant="text" disabled={busy} onPress={() => { close(); }} />}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {renaming ? <><TextField label="对话标题" accessibilityLabel="对话标题" value={name} onChangeText={setName} max={30} counter="always" autoFocus />
        <Button label="保存" disabled={!name.trim() || name.trim() === renaming.original} loading={busy} onPress={rename} />
        <Button label="返回对话列表" variant="text" onPress={() => setRenaming(null)} /></> : <>
        <Button label="新对话" onPress={() => { onPick(null); onClose(); }} />
        {list.error ? <EmptyState title="对话列表没有加载出来。" action={{ label: '重试', onPress: list.reload }} /> : list.data?.length === 0 ? <EmptyState title="还没有对话。" message="和 AI 伙伴聊过的内容会保存在这里。" /> :
          list.data?.map(item => <View key={item.id} style={styles.card}>
            <Pressable accessibilityRole="button" accessibilityLabel={item.title} onPress={() => { onPick(item.id); onClose(); }}>
              <Txt variant="headline">{item.title}{currentId === item.id ? ' · 当前' : ''}</Txt>
              <Txt variant="caption" color={c.ink3}>{formatTime(item.lastMessageAt)}</Txt>
              <Txt color={c.ink2} numberOfLines={1}>{item.preview ? `${item.preview.role === 'user' ? '你' : 'AI'}：${item.preview.text}` : ''}</Txt>
            </Pressable>
            <View style={styles.row}><Button label="重命名" variant="text" onPress={() => { setRenaming({ id: item.id, original: item.title }); setName(item.title); }} />
              <Button label="删除对话" variant="quiet" onPress={() => { remove(item.id, item.title); }} /></View>
          </View>)}
      </>}
    </ScrollView>
  </Sheet>;
}
