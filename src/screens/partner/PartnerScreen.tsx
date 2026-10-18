import React, { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { confirmAiData, ensureModelService } from '../../app/dialogs';
import { showError, showErrorDetail } from '../../app/errors';
import { useLoad } from '../../app/hooks';
import type { WorkTabScreenProps } from '../../app/navigation/types';
import { useWorkId } from '../../app/navigation/WorkContext';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { NavBar } from '../../components/NavBar';
import { TextField } from '../../components/TextField';
import { Txt } from '../../components/Text';
import { showDialog, toast } from '../../components/overlay/store';
import * as ai from '../../features/ai';
import * as conversations from '../../features/conversations';
import * as partner from '../../features/partner';
import * as prefs from '../../features/prefs';
import type { CompareTable, Message, PartnerScope } from '../../features/types';
import type { ContextPlan } from '../../ai/context';
import { color as c } from '../../theme/tokens';
import { styles } from '../archive/shared';
import { ConversationSheet } from './ConversationSheet';
import { ScopeSheet } from './ScopeSheet';
import { MessageActionsSheet } from './MessageActionsSheet';
import { PartnerActionSheet, type PartnerAction } from './PartnerActionSheet';
import { PlanPreview } from './PlanPreview';

const examples = ['帮我补全规则', '给我三个反转', '这个设定有什么漏洞'];
/** S10 keeps drafts and generation alive across tab switches; unmounting a work stops the active request. */
export function PartnerScreen({ navigation, route }: WorkTabScreenProps<'Partner'>) {
  const workId = useWorkId();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const initialSelection = useRef(false);
  const selectedConversation = useRef<string | null>(null);
  selectedConversation.current = conversationId;
  const [scope, setScope] = useState<PartnerScope>({ kind: 'confirmed', chapterId: null, includeProposed: true });
  const [text, setText] = useState(route.params?.seed ?? '');
  const drafts = useRef(new Map<string, string>());
  const comparisonCache = useRef(new Map<string, CompareTable>());
  const [listOpen, setListOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [messageAction, setMessageAction] = useState<Message | null>(null);
  const [action, setAction] = useState<PartnerAction | null>(null);
  const [plan, setPlan] = useState<ContextPlan>();
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const running = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const closing = useRef(false);
  const active = () => alive.current && !closing.current;
  const input = useRef<React.ElementRef<typeof TextInput>>(null);
  const scroll = useRef<FlatList<Message>>(null);
  const loaded = useLoad(async () => ({ list: await conversations.list(workId),
    conversation: conversationId ? await conversations.get(conversationId) : null,
    messages: conversationId ? await conversations.messages(conversationId) : [] }), [workId, conversationId], {
    events: { 'conversations.changed': e => e.workId === workId, 'messages.changed': () => true }, debounceMs: 100, refetchOnFocus: true,
  });
  useEffect(() => {
    if (!loaded.data || initialSelection.current) { return; }
    initialSelection.current = true;
    if (loaded.data.list[0]) { setConversationId(loaded.data.list[0].id); setScope(loaded.data.list[0].scope); }
    else { prefs.get('partnerScope').then(kind => { if (alive.current) { setScope(prev => ({ ...prev, kind, chapterId: null })); } }).catch(showError); }
  }, [loaded.data]);
  useEffect(() => { if (loaded.data?.conversation) { setScope(loaded.data.conversation.scope); } }, [loaded.data?.conversation]);
  useEffect(() => { alive.current = true; closing.current = false; return () => { alive.current = false; closing.current = true; running.current?.abort(); }; }, []);
  useEffect(() => {
    const leave = () => { closing.current = true; running.current?.abort(); };
    const off = navigation.addListener('beforeRemove', leave);
    const offParent = navigation.getParent()?.addListener('beforeRemove', leave);
    return () => { off(); offParent?.(); };
  }, [navigation]);
  const leaveWork = () => { closing.current = true; running.current?.abort(); navigation.popTo('Shelf'); };
  const selectConversation = (id: string | null) => {
    drafts.current.set(conversationId ?? 'new', text); setText(drafts.current.get(id ?? 'new') ?? ''); setConversationId(id); setPlan(undefined);
    if (!id) { prefs.get('partnerScope').then(kind => { if (alive.current) { setScope({ kind, chapterId: null, includeProposed: true }); } }).catch(showError); }
  };
  const messages = loaded.data?.messages ?? [];
  const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant');
  const current = loaded.data?.conversation;
  const prepare = async (content = text, mode: 'chat' | 'more_options' = 'chat') => {
    if (!content.trim() || busy || preparing || !active()) { return; }
    if (scope.kind === 'chapter' && !scope.chapterId) { setScopeOpen(true); toast('先选择要参考的章节'); return; }
    setPreparing(true); setPlan(undefined);
    try {
      const available = await ensureModelService(() => active() && navigation.isFocused(), navigation);
      if (available !== 'ok' || !active()) { return; }
      // Creating a persisted conversation waits for the explicit send; previews remain local.
      const next = await partner.prepareSend(conversationId, content, { mode, workId, scope });
      if (active()) { setPlan(next); }
    } catch (error) { if (active()) { await showError(error); } } finally { if (active()) { setPreparing(false); } }
  };
  const send = async () => {
    if (!plan || busy || running.current || !active()) { return; }
    const exactPlan = plan; const controller = new AbortController(); running.current = controller;
    const currentOperation = () => active() && !controller.signal.aborted;
    setBusy(true);
    try {
      const host = await ai.noticeHost(exactPlan);
      if (!currentOperation()) { return; }
      if (host) {
        const confirmed = await confirmAiData(host); if (!confirmed || !currentOperation()) { return; }
        await ai.acknowledgeHost(host); if (!currentOperation()) { return; }
      }
      const pending = partner.send(exactPlan, { signal: controller.signal, confirmedHost: host ?? undefined,
        onStart: ids => { if (currentOperation()) {
          if (!selectedConversation.current) { setConversationId(ids.conversationId); }
          setText(''); setPlan(undefined); drafts.current.delete(conversationId ?? 'new');
        } },
        onText: () => { if (currentOperation()) { loaded.reload(); } } });
      await pending;
      if (currentOperation()) { await loaded.reload(); if (currentOperation()) { scroll.current?.scrollToEnd({ animated: true }); } }
    } catch (error) { if (currentOperation()) { await showError(error); } }
    finally { if (active()) { setBusy(false); if (controller.signal.aborted) { setPlan(undefined); } } if (running.current === controller) { running.current = null; } }
  };
  const regenerate = async (message: Message) => {
    if (busy || preparing || !active()) { return; }
    if (message.structured?.options.some(option => option.state === 'adopted' || option.state === 'stashed')) {
      const key = await showDialog({ title: '重新生成这条回复？', message: '已采纳或暂存到档案的设定会保留，重新生成后不能从这条回复撤销。',
        buttons: [{ key: 'cancel', label: '取消' }, { key: 'generate', label: '重新预览生成', style: 'primary' }], dismissKey: 'cancel' });
      if (key !== 'generate' || !active()) { return; }
    }
    setPreparing(true); setPlan(undefined);
    try {
      if (await ensureModelService(() => active() && navigation.isFocused(), navigation) !== 'ok' || !active()) { return; }
      const next = await partner.prepareRegenerate(message.id);
      if (active()) { setPlan(next); }
    } catch (error) { if (active()) { await showError(error); } } finally { if (active()) { setPreparing(false); } }
  };
  const saveScope = async (next: PartnerScope) => {
    if (conversationId) { await conversations.setScope(conversationId, next); }
    setScope(next); setPlan(undefined); toast('之后的消息将使用新的参考范围');
  };
  const optionAction = (kind: PartnerAction['kind'], message: Message, index?: number) => setAction({ kind, message, index });
  const undo = async (message: Message, index: number) => { try { await partner.undo(message.id, index); toast('已撤销'); await loaded.reload(); } catch (error) { await showError(error); } };
  const quote = (content: string) => { setPlan(undefined); setText(content); input.current?.focus(); };
  return <KeyboardAvoidingView style={styles.root} behavior="padding">
    <NavBar title="AI 伙伴" backLabel="书架" onBack={leaveWork}
      right={<View style={styles.row}><Button label="对话" variant="text" onPress={() => setListOpen(true)} /><Button label="新对话" variant="text" disabled={!conversationId} onPress={() => selectConversation(null)} /></View>} />
    <Button label={`${current?.title ?? '新对话'} · ${scope.kind === 'chapter' ? '按章参考' : '相关已确认设定'}${scope.includeProposed ? '与未确认提议' : ''} ›`}
      variant="quiet" onPress={() => setScopeOpen(true)} />
    <FlatList ref={scroll} data={messages} keyExtractor={message => message.id} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={7}
      keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}
      ListHeaderComponent={loaded.error ? <EmptyState title="对话没有加载出来。" action={{ label: '重试', onPress: loaded.reload }} secondary={{ label: '查看详情', onPress: () => showErrorDetail(loaded.error, '对话没有加载出来。') }} /> : undefined}
      ListEmptyComponent={!loaded.error ? <EmptyState title="和 AI 伙伴聊聊这个故事" message="说说你的想法。采纳之前，所有方向都只是提议。" /> : undefined}
      renderItem={({ item: message }) => <Pressable onLongPress={message.status === 'streaming' ? undefined : () => setMessageAction(message)}
        accessibilityLabel={message.role === 'user' ? '你的消息' : 'AI 回复'} style={[styles.card, message.role === 'user' ? local.userMessage : null]}>
        <Txt selectable>{message.content || (message.status === 'streaming' ? '正在思考…' : '没有生成文字')}</Txt>
        {message.status !== 'done' ? <Txt variant="caption" color={c.ink3}>{message.status === 'streaming' ? '正在生成' : message.status === 'stopped' ? '已停止生成' : '回复没有完成'}</Txt> : null}
        {message.error ? <Txt color={c.conf}>{message.error.message}</Txt> : null}
        {message.status === 'done' && message.structured ? <>
          {message.structured.known.length ? <View style={styles.section}><Txt weight="600">已明确</Txt>{message.structured.known.map((known, index) => <Txt key={index}>✓ {known}</Txt>)}</View> : null}
          {message.structured.questions.length ? <View style={styles.section}><Txt weight="600">还需要你决定</Txt>{message.structured.questions.map((question, index) => <Button key={index} label={`${index + 1}. ${question}`} variant="text" onPress={() => quote(`关于「${question}」：\n`)} />)}</View> : null}
          {message.structured.options.map((option, index) => <View key={index} style={[styles.card, option.state === 'open' || option.state === 'stashed' ? styles.proposed : null]}>
            <Txt variant="headline">{option.title}</Txt><Txt variant="caption" color={c.brand}>{option.state === 'open' ? 'AI 提议' : option.state === 'adopted' ? '已采纳为设定' : option.state === 'stashed' ? '已暂存为提议' : '已否决'}</Txt>
            <Txt>{option.summary}</Txt><Txt>走向：{option.direction}</Txt><Txt>风险：{option.risks}</Txt><Txt>影响：{option.impact}</Txt>
            {option.state === 'open' ? <>
              <View style={styles.row}><Button label="采纳为设定" onPress={() => optionAction('adopt', message, index)} /><Button label="暂存" variant="secondary" onPress={() => optionAction('stash', message, index)} /></View>
              <View style={styles.row}><Button label="改一改" variant="text" onPress={() => quote(`关于方向「${option.title}」：${option.summary}\n我希望改为：`)} />
                <Button label="不采用" variant="quiet" onPress={() => { conversations.setOptionState(message.id, index, 'dismissed').catch(showError); }} /></View>
            </> : option.state === 'adopted' || option.state === 'stashed' ? <View style={styles.row}>
              <Button label="撤销" variant="text" onPress={() => { undo(message, index); }} />
              <Button label="在档案中查看" variant="text" onPress={() => option.entryIds.length === 1 ? navigation.navigate('EntryDetail', { entryId: option.entryIds[0] }) : navigation.navigate('Archive')} />
            </View> : null}
          </View>)}
        </> : null}
        {message === lastAssistant && message.status !== 'streaming' ? <Button label={message.status === 'error' ? '重新预览并重试' : '重新预览生成'} variant="text" disabled={busy} onPress={() => { regenerate(message); }} /> : null}
      </Pressable>}
      ListFooterComponent={<View style={local.footer}>{plan ? <PlanPreview plan={plan} onSend={() => { send(); }} loading={busy} /> : null}
      <View style={styles.chips}>{lastAssistant?.structured?.options.some(option => option.state === 'open') ? <>
        <Chip label="换一批" disabled={busy} onPress={() => { prepare('换一批方向', 'more_options'); }} />
        <Chip label="对比方案" disabled={busy || lastAssistant.structured.options.filter(option => option.state === 'open').length < 2} onPress={() => optionAction('compare', lastAssistant)} />
      </> : null}{examples.map(example => <Chip key={example} label={example} disabled={busy} onPress={() => quote(example)} />)}</View></View>} />
    <View style={styles.picker}><TextField ref={input} value={text} accessibilityLabel="对伙伴说" placeholder="说说你的想法，或回答上面的问题" onChangeText={value => { setText(value); setPlan(undefined); }} max={2000} multiline maxLines={5} />
      {busy ? <Button label="停止生成" variant="secondary" onPress={() => running.current?.abort()} /> : <Button label="预览发送范围" loading={preparing} disabled={!text.trim()} onPress={() => { prepare(); }} />}</View>
    <ConversationSheet visible={listOpen} workId={workId} currentId={conversationId} onClose={() => setListOpen(false)} onPick={selectConversation} />
    <ScopeSheet visible={scopeOpen} workId={workId} scope={scope} query={text} onClose={() => setScopeOpen(false)} onSave={saveScope} />
    <MessageActionsSheet message={messageAction} canRegenerate={messageAction?.id === lastAssistant?.id && !busy}
      onClose={() => setMessageAction(null)} onRegenerate={message => { regenerate(message); }} />
    {action ? <PartnerActionSheet key={`${action.kind}-${action.message.id}-${action.index}`} action={action} workId={workId} comparisonCache={comparisonCache.current} onClose={() => setAction(null)} onAction={setAction}
      onOpenEntry={entryId => navigation.navigate('EntryDetail', { entryId })} onManual={(type, name) => navigation.navigate('EntryForm', { workId, type, name })} /> : null}
  </KeyboardAvoidingView>;
}

const local = StyleSheet.create({ userMessage: { backgroundColor: c.brandTint, alignSelf: 'flex-end', maxWidth: '90%' }, footer: { gap: 12 } });
