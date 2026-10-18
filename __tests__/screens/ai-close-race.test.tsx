import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { WorkTabScreenProps } from '../../src/app/navigation/types';
import { WorkContext } from '../../src/app/navigation/WorkContext';
import { EntryCompletionSheet } from '../../src/screens/archive/EntryCompletionSheet';
import { PartnerActionSheet } from '../../src/screens/partner/PartnerActionSheet';
import { PartnerScreen } from '../../src/screens/partner/PartnerScreen';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import * as ai from '../../src/features/ai';
import * as entries from '../../src/features/entries';
import * as works from '../../src/features/works';
import * as models from '../../src/features/modelServices';
import * as conversations from '../../src/features/conversations';
import * as partner from '../../src/features/partner';
import * as completion from '../../src/features/entryCompletion';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { freshDb } from '../helpers/db';
import { allText, flush, press, typeInto, until } from '../helpers/render';

jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'fixture-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));
afterEach(() => jest.restoreAllMocks());
type Subject = 'completion' | 'compare' | 'partner';
async function fixture(subject: Subject) {
  const db = await freshDb();
  const work = await works.create({ premise: '海边的古镜' });
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇' });
  const conversation = await conversations.create(work.id);
  const structured = { known: [], questions: [], options: ['出海', '留守'].map(title => ({ title, summary: '寻找答案', direction: '线索', risks: '代价', impact: '成长', state: 'open', entryIds: [], factIds: [] })) };
  await db.run("INSERT INTO messages(id,conversation_id,role,content,status,structured,created_at) VALUES ('source',?,'assistant','两种方向','done',?,?)", [conversation.id, JSON.stringify(structured), new Date().toISOString()]);
  const message = await conversations.message('source');
  await models.save({ name: '本次服务', protocol: 'openai_responses', baseUrl: 'https://close.example.test/v1', model: 'fixture', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'fixture-key');
  const close = jest.fn();
  // Keep the calling component mounted after close, as it is during native exit animations.
  const compare = jest.spyOn(partner, 'compare').mockResolvedValue({ dimensions: [], columns: [] });
  const complete = jest.spyOn(completion, 'complete').mockResolvedValue([]);
  const send = jest.spyOn(partner, 'send').mockResolvedValue({ messageId: 'unused', conversationId: conversation.id, content: '', structured: null });
  let release!: () => void;
  const acknowledgement = new Promise<void>(resolve => { release = resolve; });
  const ack = jest.spyOn(ai, 'acknowledgeHost').mockReturnValue(acknowledgement);
  useOverlay.setState({ dialogs: [], toast: null, depth: 0 });
  const Stack = createNativeStackNavigator();
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><WorkContext.Provider value={work.id}><NavigationContainer>
    <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Test">{props => subject === 'completion'
      ? <EntryCompletionSheet entry={entry} navigation={props.navigation as never} onClose={close} />
      : subject === 'compare' ? <PartnerActionSheet action={{ kind: 'compare', message }} workId={work.id} comparisonCache={new Map()} onClose={close} onOpenEntry={() => {}} onManual={() => {}} onAction={() => {}} />
        : <PartnerScreen {...props as unknown as WorkTabScreenProps<'Partner'>} navigation={{ ...props.navigation, popTo: close } as unknown as WorkTabScreenProps<'Partner'>['navigation']} />}</Stack.Screen></Stack.Navigator>
    <OverlayHost level={0} /></NavigationContainer></WorkContext.Provider></SafeAreaProvider>); });
  if (subject === 'completion') { await press(screen, '预览发送范围'); await until(screen, text => text.includes('生成建议')); await press(screen, '生成建议'); }
  else if (subject === 'compare') { await until(screen, text => text.includes('生成对比')); await press(screen, '生成对比'); }
  else {
    await until(screen, text => text.includes('两种方向'));
    await typeInto(screen, '说说你的想法，或回答上面的问题', '继续构思');
    await press(screen, '预览发送范围'); await until(screen, text => text.includes('预计输入约')); await press(screen, '发送');
  }
  await until(screen, text => text.includes('发送前请确认'));
  await press(screen, '知道了，继续');
  expect(ack).toHaveBeenCalledTimes(1);
  expect(allText(screen)).toContain('停止生成');
  return { db, screen, close, release, compare, complete, send };
}

test.each<Subject>(['completion', 'compare', 'partner'])('%s closes during acknowledgement without starting a late model operation', async subject => {
  const { db, screen, close, release, compare, complete, send } = await fixture(subject);
  await press(screen, subject === 'partner' ? '书架' : '关闭');
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => { release(); }); await flush();
  expect(compare).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  expect(await db.all('SELECT * FROM ai_attempts')).toHaveLength(0);
  await act(async () => screen.unmount()); await db.close();
});

test('completion stop is visible before acknowledgement finishes and requires a fresh preview after cancellation', async () => {
  const { db, screen, release, complete } = await fixture('completion');
  await press(screen, '停止生成');
  await act(async () => { release(); });
  await until(screen, text => text.includes('预览发送范围'));
  expect(complete).not.toHaveBeenCalled();
  expect(screen.root.findAll(node => node.props.accessibilityLabel === '生成建议')).toHaveLength(0);
  await act(async () => screen.unmount()); await db.close();
});
