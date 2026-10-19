/** S15 settings & data slice (S15b–S15f, D01, D05) and the small cross-page items that ride along. */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import { freshDb, tickingClock } from '../helpers/db';
import { press, until } from '../helpers/render';
import { db, setDb } from '../../src/data/db';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import type { RootStackParamList } from '../../src/app/navigation/types';
import { TrashScreen, trashTitle } from '../../src/screens/settings/TrashScreen';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as trash from '../../src/features/trash';
import * as models from '../../src/features/modelServices';
import * as prefs from '../../src/features/prefs';
import * as ai from '../../src/features/ai';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { AppError } from '../../src/features/errors';
import { confirmAiData, showAiDataNotice } from '../../src/app/dialogs';
import { showErrorDetail } from '../../src/app/errors';
import { AboutScreen } from '../../src/screens/settings/AboutScreen';
import { createNavigationContainerRef } from '@react-navigation/native';

jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'fixture-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));

beforeEach(async () => { tickingClock(); await freshDb(); useOverlay.setState({ dialogs: [], toast: null, depth: 0 }); });
afterEach(async () => { jest.restoreAllMocks(); await db().close(); setDb(null); });

const Stack = createNativeStackNavigator<RootStackParamList>();
async function mount(content: React.ReactNode) {
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer>{content}<OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  return screen;
}
async function story() {
  const work = await works.create({ title: '归潮', premise: '海边的故事' });
  const volume = (await chapters.list(work.id))[0].volume;
  const made = [];
  for (const title of ['开端', '回声', '归来']) {
    const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, title });
    await chapters.saveBody(chapter.id, `${title}的正文`, 0); made.push(chapter);
  }
  const extra = await chapters.create({ workId: work.id, volumeId: volume.id, title: '雨后', kind: 'extra' });
  const entry = await entries.create({ workId: work.id, type: 'place', name: '灯塔' });
  return { work, volume, chapters: made, extra, entry };
}

test('trash rows carry the restore number, chapter kind, entry type and the work chapter count', async () => {
  const s = await story();
  await chapters.remove(s.chapters[1].id); await chapters.remove(s.extra.id); await entries.remove(s.entry.id);
  const list = await trash.list();
  const middle = list.find(item => item.id === s.chapters[1].id)!;
  expect(middle).toMatchObject({ chapterKind: 'main', chapterNumber: 2, parentTitle: '归潮' });
  expect(trashTitle(middle)).toBe('第 2 章 回声');
  expect(trashTitle(list.find(item => item.id === s.extra.id)!)).toBe('番外 雨后');
  expect(list.find(item => item.id === s.entry.id)).toMatchObject({ entryType: 'place', title: '灯塔' });
  // A chapter whose volume row is gone is numbered at the end of the first volume.
  await db().run('PRAGMA foreign_keys=OFF');
  await db().run('UPDATE chapters SET volume_id=? WHERE id=?', ['gone-volume', s.chapters[1].id]);
  expect((await trash.list()).find(item => item.id === s.chapters[1].id)?.chapterNumber).toBe(3);
  await db().run('UPDATE chapters SET volume_id=? WHERE id=?', [s.volume.id, s.chapters[1].id]);
  await db().run('PRAGMA foreign_keys=ON');
  await works.remove(s.work.id);
  expect((await trash.list()).find(item => item.kind === 'work')).toMatchObject({ chapterCount: 2, parentTitle: null });
});

test('trash rows explain they cannot be opened, filters grey out empty kinds and NOT_FOUND refreshes', async () => {
  const s = await story();
  await chapters.remove(s.chapters[0].id);
  const screen = await mount(<Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Trash" component={TrashScreen} /><Stack.Screen name="Work">{() => <Text>作品页</Text>}</Stack.Screen></Stack.Navigator>);
  await until(screen, text => text.includes('第 1 章 开端') && text.includes('归潮 · 删除于'));
  await press(screen, /^第 1 章 开端，/);
  expect(useOverlay.getState().toast?.message).toBe('恢复后才能查看');
  const chip = (label: RegExp) => screen.root.findAll(node => typeof node.props.label === 'string' && label.test(node.props.label) && 'selected' in node.props)[0];
  expect(chip(/^作品 0$/).props.disabled).toBe(true);
  expect(chip(/^章节 1$/).props.disabled).toBe(false);
  // The row vanished elsewhere (e.g. purged from another entry): the toast says so and the list refreshes.
  await act(async () => { await db().run('DELETE FROM chapters WHERE id=?', [s.chapters[0].id]); });
  await press(screen, '恢复');
  await until(screen, text => text.includes('回收站是空的'));
  expect(useOverlay.getState().toast?.message).toBe('这一项已不在回收站');
  await act(async () => screen.unmount());
});

test('purging a work names covers and an emptied filter shows its own copy', async () => {
  const s = await story();
  await entries.remove(s.entry.id); await works.remove(s.work.id);
  const screen = await mount(<Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Trash" component={TrashScreen} /></Stack.Navigator>);
  await until(screen, text => text.includes('3 章 · 删除于') && text.includes('地点') && text.includes('归潮（在回收站）'));
  await press(screen, /^归潮，3 章/, 'onLongPress'); await press(screen, '彻底删除');
  await until(screen, text => text.includes('作品的全部章节、档案、对话和封面都会一并删除。'));
  await press(screen, '取消');
  await press(screen, /^档案条目 1$/); await until(screen, text => !text.includes('3 章 · 删除于'));
  await press(screen, /^灯塔，/, 'onLongPress'); await press(screen, '彻底删除');
  await until(screen, text => text.includes('彻底删除「灯塔」？'));
  await press(screen, '彻底删除');
  await until(screen, text => text.includes('没有删除的档案条目'));
  await act(async () => screen.unmount());
});

const lastDialog = () => useOverlay.getState().dialogs[useOverlay.getState().dialogs.length - 1];
const closeDialogs = () => { for (const dialog of useOverlay.getState().dialogs) { dialog.resolve(dialog.dismissKey ?? 'close'); } useOverlay.setState({ dialogs: [] }); };

test('D01 read-only lists every service by name and host; confirm mode names the OpenAI storage setting', async () => {
  await models.save({ name: '写作', protocol: 'openai_responses', baseUrl: 'https://api.openai.test/v1', model: 'm', options: DEFAULT_OPTIONS }, 'fixture-key');
  await models.save({ name: '整理', protocol: 'anthropic_messages', baseUrl: 'https://api.anthropic.test', model: 'm', options: DEFAULT_OPTIONS }, 'fixture-key');
  const readonly = showAiDataNotice(); await act(async () => {});
  expect(lastDialog().title).toBe('AI 会发送哪些内容');
  expect(lastDialog().message).toContain('写作：api.openai.test\n整理：api.anthropic.test');
  expect(lastDialog().buttons.map(b => b.label)).toEqual(['关闭']);
  closeDialogs(); await readonly;
  const confirm = confirmAiData('api.openai.test'); await act(async () => {});
  expect(lastDialog().message).toContain('api.openai.test');
  expect(lastDialog().notes).toContain('已设置请求不在 OpenAI 服务端保存');
  lastDialog().resolve('continue'); useOverlay.setState({ dialogs: [] }); expect(await confirm).toBe(true);
  const other = confirmAiData('api.anthropic.test'); await act(async () => {});
  expect(lastDialog().notes?.some(note => note.includes('OpenAI'))).toBe(false);
  closeDialogs(); expect(await other).toBe(false);
});

test('D01 acknowledgement failure does not block the confirmed operation', async () => {
  jest.spyOn(prefs, 'set').mockRejectedValue(new Error('disk I/O error'));
  await expect(ai.acknowledgeHost('api.example.test')).resolves.toBe(false);
});

test('D05 local error detail shows the time row', async () => {
  const at = new Date();
  const shown = showErrorDetail(new AppError('DB_ERROR', 'SQLITE_BUSY'), '保存失败', at); await act(async () => {});
  expect(lastDialog().notes).toEqual(['错误码：DB_ERROR', '技术信息：SQLITE_BUSY', expect.stringMatching(/^时间：今天 \d{2}:\d{2}$/)]);
  closeDialogs(); await shown;
});

test('S15f pushes the license pages so system back returns to About', async () => {
  const navigation = createNavigationContainerRef<RootStackParamList>();
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { screen = ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer ref={navigation} initialState={{ index: 1, routes: [{ name: 'Settings' }, { name: 'About' }] }}>
    <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Settings">{() => <Text>设置页</Text>}</Stack.Screen><Stack.Screen name="About" component={AboutScreen} /></Stack.Navigator>
    <OverlayHost level={0} /></NavigationContainer></SafeAreaProvider>); });
  const text = await until(screen, t => t.includes('作品、档案和设置只保存在这台手机上'));
  expect(text).toContain('github.com/MathildaStacy/NovelCreationPartner'); expect(text).toContain('在 GitHub Issues 提交');
  await press(screen, '开源许可');
  await until(screen, t => t.includes('本软件以 GNU 通用公共许可证第 3 版'));
  expect(navigation.getCurrentRoute()?.params).toEqual({ page: 'license' });
  await act(async () => navigation.goBack());
  await until(screen, t => t.includes('第三方组件许可') && !t.includes('本软件以 GNU'));
  await press(screen, '第三方组件许可');
  await until(screen, t => t.includes('返回关于') || t.includes('关于'));
  expect(navigation.getCurrentRoute()?.params).toEqual({ page: 'thirdParty' });
  await act(async () => navigation.goBack()); expect(navigation.getCurrentRoute()?.params).toBeUndefined();
  await act(async () => screen.unmount());
});
