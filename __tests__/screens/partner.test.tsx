import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import * as conversations from '../../src/features/conversations';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as partner from '../../src/features/partner';
import { WorkContext } from '../../src/app/navigation/WorkContext';
import { PartnerScreen } from '../../src/screens/partner/PartnerScreen';
import { messageDraft } from '../../src/screens/partner/MessageActionsSheet';
import { useOverlay } from '../../src/components/overlay/store';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { freshDb } from '../helpers/db';
import { allText, press, typeInto, until } from '../helpers/render';

async function setup() {
  const db = await freshDb();
  const work = await works.create({ title: '归潮', premise: '海边的古镜' });
  const Stack = createNativeStackNavigator();
  useOverlay.setState({ dialogs: [], toast: null, depth: 0 });
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = ReactTestRenderer.create(<SafeAreaProvider><WorkContext.Provider value={work.id}><NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Partner" component={PartnerScreen as never} />
        <Stack.Screen name="Shelf">{() => <Text>书架</Text>}</Stack.Screen>
      </Stack.Navigator><OverlayHost level={0} /></NavigationContainer></WorkContext.Provider></SafeAreaProvider>);
  });
  return { db, work, screen };
}

test('empty partner and local scope work offline without creating a conversation or generating', async () => {
  const { db, work, screen } = await setup();
  const send = jest.spyOn(partner, 'send');
  await until(screen, text => text.includes('和 AI 伙伴聊聊这个故事'));
  await press(screen, '帮我补全规则');
  expect(await conversations.list(work.id)).toEqual([]);
  await press(screen, /新对话 · 相关已确认设定/);
  await until(screen, text => text.includes('保存范围'));
  expect(allText(screen)).toContain('本地参考预览');
  await press(screen, '关闭');
  expect(send).not.toHaveBeenCalled();
  await act(async () => screen.unmount()); send.mockRestore(); db.close();
});

test('explicit message preview without service preserves draft and opens the model connection dialog', async () => {
  const { db, work, screen } = await setup();
  await until(screen, text => text.includes('和 AI 伙伴聊聊这个故事'));
  await typeInto(screen, '说说你的想法，或回答上面的问题', '镜子为什么会发光？');
  await press(screen, '预览发送范围');
  await until(screen, text => text.includes('先连接一个模型服务'));
  expect(await conversations.list(work.id)).toEqual([]);
  const drafts = screen.root.findAll(node => node.props.value === '镜子为什么会发光？');
  expect(drafts.length).toBeGreaterThan(0);
  await press(screen, '不用 AI，继续写');
  await act(async () => screen.unmount()); db.close();
});

test('message copy draft labels proposals and preserves adopted/stashed decisions', () => {
  expect(messageDraft({ id: 'm', conversationId: 'c', role: 'assistant', content: '可以考虑两种方向。', status: 'done', mode: 'chat',
    structured: { known: ['主角住在渔村'], questions: ['谁留下古镜？'], options: [{ title: '镜灵契约', summary: '镜子有器灵', direction: '成长', risks: '代价', impact: '记忆', state: 'adopted', entryIds: [], factIds: [] }] },
    serviceId: null, model: null, usage: null, error: null, createdAt: '2026-10-18T00:00:00Z' })).toContain('镜灵契约（已采纳）');
});

test('local scope selects chapters in a list and clears a deleted chapter reference', async () => {
  const { db, work, screen } = await setup();
  const group = (await chapters.list(work.id))[0];
  const chapter = await chapters.create({ workId: work.id, volumeId: group.volume.id, title: '潮声' });
  const send = jest.spyOn(partner, 'send');
  await until(screen, text => text.includes('和 AI 伙伴聊聊这个故事'));
  await press(screen, /新对话 · 相关已确认设定/);
  await until(screen, text => text.includes('保存范围'));
  await press(screen, '仅某章相关');
  await until(screen, text => text.includes('第 1 章 潮声 ›'));
  await press(screen, '第 1 章 潮声 ›');
  await until(screen, text => text.includes('选择章节'));
  await press(screen, '第 1 章 潮声 ✓');
  await until(screen, text => text.includes('本地参考预览'));
  await act(async () => { await chapters.remove(chapter.id); });
  await until(screen, text => text.includes('所选章节已删除，已改回相关已确认设定。'));
  expect(send).not.toHaveBeenCalled();
  await act(async () => screen.unmount()); send.mockRestore(); db.close();
});
