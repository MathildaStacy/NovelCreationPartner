import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { strToU8 } from 'fflate';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { freshDb, tickingClock } from '../helpers/db';
import { db, setDb } from '../../src/data/db';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as backup from '../../src/features/backup';
import * as documents from '../../src/features/backupFiles';
import * as models from '../../src/features/modelServices';
import * as prefs from '../../src/features/prefs';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { setFileStoreDriver, type FileStoreDriver } from '../../src/files';
import { fromBase64, toBase64 } from '../../src/files/base64';
import { RestoreScreen } from '../../src/screens/settings/RestoreScreen';
import { ExportScreen } from '../../src/screens/settings/ExportScreen';
import { Switch } from 'react-native';
import { Chip } from '../../src/components/Chip';
import { Txt } from '../../src/components/Text';
import { OverlayHost } from '../../src/components/overlay/OverlayHost';
import { useOverlay } from '../../src/components/overlay/store';
import type { RootStackParamList } from '../../src/app/navigation/types';
import { allText, press, until } from '../helpers/render';
import { Button } from '../../src/components/Button';
const buttonOf=(r:ReactTestRenderer.ReactTestRenderer,label:string)=>r.root.findAllByType(Button).find(node=>node.props.label===label)!;

jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'fixture-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));
beforeEach(async () => { tickingClock(); await freshDb(); useOverlay.setState({ dialogs: [], toast: null, depth: 0 }); });
afterEach(async () => { setFileStoreDriver(undefined); jest.restoreAllMocks(); await db().close(); setDb(null); });
async function fixture() {
  const work = await works.create({title:'归潮',premise:'海上归来'});
  const volume = (await chapters.list(work.id))[0].volume;
  const chapter = await chapters.create({workId:work.id,volumeId:volume.id,title:'开端'}); await chapters.saveBody(chapter.id,'归来的人',0);
  await models.save({name:'服务',protocol:'openai_responses',baseUrl:'https://example.test/v1',model:'fixture',options:DEFAULT_OPTIONS},'fixture-key');
  return {work,bytes:await backup.build()};
}

async function renderExport(params: RootStackParamList['Export']) {
  const Stack=createNativeStackNavigator<RootStackParamList>(); const navigation=createNavigationContainerRef<RootStackParamList>();
  let renderer!:ReactTestRenderer.ReactTestRenderer;
  await act(async()=>{renderer=ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer ref={navigation} initialState={{index:1,routes:[{name:'Settings'},{name:'Export',params}]}}>
    <Stack.Navigator screenOptions={{headerShown:false}}><Stack.Screen name="Settings">{()=> <Txt>设置页</Txt>}</Stack.Screen><Stack.Screen name="Export" component={ExportScreen}/></Stack.Navigator><OverlayHost level={0}/>
  </NavigationContainer></SafeAreaProvider>);});
  return {renderer,navigation};
}

test('file feature facade shares and inspects content through an injected port without paths or Keys', async () => {
  const {work,bytes}=await fixture(); const share=jest.fn<ReturnType<FileStoreDriver['writeAndShare']>,Parameters<FileStoreDriver['writeAndShare']>>(async()=>'opened');
  setFileStoreDriver({cleanupExports:async()=>{},writeAndShare:share,pick:async()=>JSON.stringify({name:'fixture.ncpbak',base64:toBase64(bytes)})});
  expect((await documents.pick())?.inspection.manifest.works[0].id).toBe(work.id);
  await documents.share({format:'md',workId:work.id});
  expect(share.mock.calls[0][0]).toMatch(/\.md$/); expect(share.mock.calls[0][2]).toBe('text/markdown');
  expect(new TextDecoder().decode(fromBase64(share.mock.calls[0][1]))).toContain('# 归潮');
  await documents.share({format:'backup'}); expect(backup.inspect(fromBase64(share.mock.calls[1][1])).services).toBe(1);
});

test('restore locks navigation and selection, preserves settings onboarding and opens missing-Key settings after commit', async () => {
  const {bytes}=await fixture();
  setFileStoreDriver({cleanupExports:async()=>{},writeAndShare:async()=>'opened',pick:async()=>JSON.stringify({name:'fixture.ncpbak',base64:toBase64(bytes)})});
  const actual=backup.restore; let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const restore=jest.spyOn(backup,'restore').mockImplementation(async(...args)=>{await gate;return actual(...args);});
  const Stack=createNativeStackNavigator<RootStackParamList>(); const navigation=createNavigationContainerRef<RootStackParamList>();
  let renderer!:ReactTestRenderer.ReactTestRenderer;
  await act(async()=>{renderer=ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer ref={navigation} initialState={{index:1,routes:[{name:'Settings'},{name:'Restore',params:{from:'settings'}}]}}>
    <Stack.Navigator screenOptions={{headerShown:false}}><Stack.Screen name="Settings">{()=> <Txt>模型服务设置页</Txt>}</Stack.Screen><Stack.Screen name="Restore" component={RestoreScreen}/></Stack.Navigator><OverlayHost level={0}/>
  </NavigationContainer></SafeAreaProvider>);});
  await press(renderer,'选择备份文件'); await until(renderer,text=>text.includes('fixture.ncpbak'));
  const service=renderer.root.findAllByType(Chip).find(node=>node.props.label.includes('同时恢复模型服务'))!; expect(service.props.selected).toBe(true);
  expect(allText(renderer).replace(/\s/g,'')).toContain('将命名为「归潮（恢复）」');
  await press(renderer,'恢复 1 部作品'); await press(renderer,'恢复'); await until(renderer,text=>text.includes('正在恢复，请不要离开'));
  expect(renderer.root.findAllByType(Chip).every(node=>node.props.disabled)).toBe(true);
  await act(async()=>navigation.goBack()); expect(navigation.getCurrentRoute()?.name).toBe('Restore');
  expect(restore).toHaveBeenCalledTimes(1);
  await act(async()=>release()); await until(renderer,text=>text.includes('请为恢复的模型服务重新填写 Key'));
  expect(await prefs.get('onboardingDone')).toBe(false); expect(await works.list()).toHaveLength(2);
  await press(renderer,'去填写'); await until(renderer,text=>text.includes('模型服务设置页')&&!text.includes('从备份恢复'));
  expect(navigation.getCurrentRoute()?.name).toBe('Settings'); expect((await models.list()).find(serviceRow=>serviceRow.name==='服务（恢复）')?.hasKey).toBe(false);
  await act(async()=>renderer.unmount());
});

test('export selects main chapters by default and only sends explicitly selected extras to the file feature', async () => {
  const {work}=await fixture(); const volume=(await chapters.list(work.id))[0].volume;
  const extra=await chapters.create({workId:work.id,volumeId:volume.id,title:'番外',kind:'extra'});await chapters.saveBody(extra.id,'番外文字',0);
  const writeAndShare=jest.fn<ReturnType<FileStoreDriver['writeAndShare']>,Parameters<FileStoreDriver['writeAndShare']>>(async()=>'opened');setFileStoreDriver({cleanupExports:async()=>{},writeAndShare,pick:async()=>null});
  const {renderer}=await renderExport({mode:'text',workId:work.id,from:'shelf'});
  await until(renderer,text=>text.includes('正文 1 章 · 番外 1 章')&&text.includes('全部正文章节（1 章）')&&text.includes('包含番外（1 章）'));
  expect(allText(renderer)).toContain('书架');
  await press(renderer,'Markdown');await press(renderer,'生成并分享');
  expect(new TextDecoder().decode(fromBase64(writeAndShare.mock.calls[0][1]))).not.toContain('番外文字');
  expect(writeAndShare.mock.calls[0][0]).toMatch(/\.md$/);
  await act(async()=>renderer.root.findByType(Switch).props.onValueChange(true));await press(renderer,'TXT');await press(renderer,'生成并分享');
  expect(new TextDecoder().decode(fromBase64(writeAndShare.mock.calls[1][1]))).toContain('番外文字');
  await act(async()=>renderer.unmount());
});

test('export chapter picker groups by volume, selects all and starts from the chapter entry', async () => {
  const {work}=await fixture(); const first=(await chapters.list(work.id))[0];
  const second=await chapters.create({workId:work.id,volumeId:first.volume.id,title:'回声'});await chapters.saveBody(second.id,'第二章正文',0);
  await chapters.create({workId:work.id,volumeId:first.volume.id,title:'没写完',kind:'draft'});
  const writeAndShare=jest.fn<ReturnType<FileStoreDriver['writeAndShare']>,Parameters<FileStoreDriver['writeAndShare']>>(async()=>'opened');setFileStoreDriver({cleanupExports:async()=>{},writeAndShare,pick:async()=>null});
  const {renderer}=await renderExport({mode:'text',workId:work.id,chapterId:second.id,from:'chapters'});
  await until(renderer,text=>text.includes('已选 1 章'));
  await press(renderer,'生成并分享');
  const body=new TextDecoder().decode(fromBase64(writeAndShare.mock.calls[0][1]));expect(body).toContain('第二章正文');expect(body).not.toContain('归来的人');
  await press(renderer,'选择章节…');await until(renderer,text=>text.includes(first.volume.title)&&text.includes('第 1 章 开端')&&!text.includes('没写完'));
  await press(renderer,'全选');await until(renderer,text=>text.includes('已选 2 章'));await press(renderer,'确定');
  await until(renderer,text=>text.includes('已选 2 章'));await press(renderer,'生成并分享');
  expect(new TextDecoder().decode(fromBase64(writeAndShare.mock.calls[1][1]))).toContain('归来的人');
  await act(async()=>renderer.unmount());
});

test('export clears a work that was deleted meanwhile and explains missing works or chapters', async () => {
  const {work}=await fixture();
  setFileStoreDriver({cleanupExports:async()=>{},writeAndShare:async()=>'opened',pick:async()=>null});
  const {renderer}=await renderExport({mode:'work',workId:work.id});
  await until(renderer,text=>text.includes('正文 1 章'));
  await act(async()=>{await db().run('UPDATE works SET deleted_at=? WHERE id=?',[new Date().toISOString(),work.id]);});
  await press(renderer,'生成备份文件并分享');
  expect(useOverlay.getState().toast?.message).toBe('这部作品已被删除');
  await until(renderer,text=>text.includes('选择作品')&&text.includes('还没有可导出的作品'));
  await act(async()=>renderer.unmount());
  const empty=await works.create({title:'空书',premise:'只有构思'});
  const next=await renderExport({mode:'text',workId:empty.id});
  await until(next.renderer,text=>text.includes('这部作品还没有正文章节'));
  expect(buttonOf(next.renderer,'生成并分享').props.disabled).toBe(true);
  await act(async()=>next.renderer.unmount());
});

test('welcome restore writes onboarding only after commit and resets to the shelf', async () => {
  const {work}=await fixture();const bytes=await backup.build(work.id);
  setFileStoreDriver({cleanupExports:async()=>{},writeAndShare:async()=>'opened',pick:async()=>JSON.stringify({name:'one.ncpbak',base64:toBase64(bytes)})});
  const Stack=createNativeStackNavigator<RootStackParamList>();const navigation=createNavigationContainerRef<RootStackParamList>();let renderer!:ReactTestRenderer.ReactTestRenderer;
  await act(async()=>{renderer=ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer ref={navigation} initialState={{index:1,routes:[{name:'Welcome'},{name:'Restore',params:{from:'welcome'}}]}}>
    <Stack.Navigator screenOptions={{headerShown:false}}><Stack.Screen name="Welcome">{()=> <Txt>欢迎入口</Txt>}</Stack.Screen><Stack.Screen name="Shelf">{()=> <Txt>新书架</Txt>}</Stack.Screen><Stack.Screen name="Restore" component={RestoreScreen}/></Stack.Navigator><OverlayHost level={0}/>
  </NavigationContainer></SafeAreaProvider>);});
  await press(renderer,'选择备份文件');await until(renderer,text=>text.includes('one.ncpbak'));
  expect(await prefs.get('onboardingDone')).toBe(false);await press(renderer,'恢复 1 部作品');await press(renderer,'恢复');
  await until(renderer,text=>text.includes('新书架')&&!text.includes('从备份恢复'));
  expect(await prefs.get('onboardingDone')).toBe(true);expect(navigation.getRootState()?.routes).toHaveLength(1);
  await act(async()=>renderer.unmount());
});

test('exports use portable work/chapter names, preserve extensions and distinguish a whole work from one chapter', async () => {
  const {work}=await fixture();
  const chapter=(await chapters.list(work.id))[0].chapters[0];
  await works.update(work.id,{title:'归/潮:归来'});
  const writeAndShare=jest.fn<ReturnType<FileStoreDriver['writeAndShare']>,Parameters<FileStoreDriver['writeAndShare']>>(async()=>'completed');
  setFileStoreDriver({cleanupExports:async()=>{},writeAndShare,pick:async()=>null});
  await documents.share({format:'backup'});
  expect(writeAndShare.mock.calls[0][0]).toMatch(/^小说备份-\d{8}-\d{4}\.ncpbak$/);
  await documents.share({format:'backup',workId:work.id});
  expect(writeAndShare.mock.calls[1][0]).toMatch(/^归-潮-归来-备份-\d{8}-\d{4}\.ncpbak$/);
  await documents.share({format:'md',workId:work.id});expect(writeAndShare.mock.calls[2][0]).toBe('归-潮-归来.md');
  await documents.share({format:'txt',workId:work.id,chapterIds:[chapter.id]});expect(writeAndShare.mock.calls[3][0]).toBe('归-潮-归来-第1章-开端.txt');
  const extra=await chapters.create({workId:work.id,volumeId:chapter.volumeId,kind:'extra',title:'雨后'});
  await documents.share({format:'md',workId:work.id,chapterIds:[extra.id]});expect(writeAndShare.mock.calls[4][0]).toBe('归-潮-归来-番外-雨后.md');
  await db().run('UPDATE works SET title=? WHERE id=?',['😀'.repeat(100),work.id]);
  await documents.share({format:'txt',workId:work.id});expect([...writeAndShare.mock.calls[5][0]].length).toBeLessThanOrEqual(80);expect(strToU8(writeAndShare.mock.calls[5][0]).length).toBeLessThanOrEqual(255);expect(writeAndShare.mock.calls[5][0]).toMatch(/\.txt$/);
  await works.update(work.id,{title:null});await documents.share({format:'txt',workId:work.id});expect(writeAndShare.mock.calls[6][0]).toBe('未命名作品.txt');
});

test.each(['completed','cancelled','opened'] as const)('export UI reflects %s without claiming an unconfirmed destination save', async result => {
  await fixture();
  setFileStoreDriver({cleanupExports:async()=>{},writeAndShare:async()=>result,pick:async()=>null});
  const {renderer}=await renderExport({from:'settings'});
  await until(renderer,text=>text.includes('共 1 部作品')&&text.includes('备份文件不包含你的 API Key。'));await press(renderer,'生成备份文件并分享');
  expect(useOverlay.getState().toast?.message??null).toBe(result==='completed'?'已导出':result==='opened'?'已打开系统分享':null);
  expect(allText(renderer)).not.toContain('遇到图片封面');
  await act(async()=>renderer.unmount());
});

test('export storage exhaustion keeps selection and shows the specific generation failure', async () => {
  const {work}=await fixture();
  setFileStoreDriver({cleanupExports:async()=>{},writeAndShare:async()=>{throw Object.assign(new Error('full'),{code:'STORAGE_FULL'});},pick:async()=>null});
  const {renderer}=await renderExport({from:'settings'});
  await press(renderer,'单部备份');await press(renderer,'选择作品');await press(renderer,'归潮');
  await until(renderer,text=>text.includes('正文 1 章'));
  // The dialog keeps the share operation pending, so press without waiting for its promise.
  await act(async()=>{renderer.root.findAllByType(Button).find(node=>node.props.label==='生成备份文件并分享')!.props.onPress();});
  await until(renderer,text=>text.includes('手机存储空间不足，没有生成导出文件。请清理空间后重试。'));
  await press(renderer,'知道了');expect(useOverlay.getState().toast).toBeNull();
  expect(allText(renderer)).toContain(work.title!);expect(allText(renderer)).toContain('正文 1 章');
  await act(async()=>renderer.unmount());
});

test('share launch failure offers sanitized error details and keeps the export retryable', async () => {
  await fixture();
  setFileStoreDriver({cleanupExports:async()=>{},writeAndShare:async()=>{throw new Error('/private/not-shared');},pick:async()=>null});
  const {renderer}=await renderExport(undefined);
  await until(renderer,text=>text.includes('共 1 部作品'));await press(renderer,'生成备份文件并分享');
  await until(renderer,text=>text.includes('没有打开分享面板，请重试'));
  expect(allText(renderer)).not.toContain('/private/not-shared');
  await press(renderer,'查看详情');await until(renderer,text=>text.includes('错误码：DB_ERROR'));
  expect(allText(renderer)).not.toContain('/private/not-shared');await press(renderer,'关闭');
  expect(buttonOf(renderer,'生成备份文件并分享').props.disabled).toBe(false);
  await act(async()=>renderer.unmount());
});

test('an invalid or too-new backup is explained under the file button, never as a database error', async () => {
  const {bytes}=await fixture();
  let next:string=JSON.stringify({name:'notes.txt',base64:toBase64(strToU8('just text'))});
  setFileStoreDriver({cleanupExports:async()=>{},writeAndShare:async()=>'opened',pick:async()=>next});
  const Stack=createNativeStackNavigator<RootStackParamList>();
  let renderer!:ReactTestRenderer.ReactTestRenderer;
  await act(async()=>{renderer=ReactTestRenderer.create(<SafeAreaProvider><NavigationContainer initialState={{index:1,routes:[{name:'Settings'},{name:'Restore',params:{from:'settings'}}]}}>
    <Stack.Navigator screenOptions={{headerShown:false}}><Stack.Screen name="Settings">{()=> <Txt>设置页</Txt>}</Stack.Screen><Stack.Screen name="Restore" component={RestoreScreen}/></Stack.Navigator><OverlayHost level={0}/>
  </NavigationContainer></SafeAreaProvider>);});
  await press(renderer,'选择备份文件');
  await until(renderer,text=>text.includes('备份文件已损坏，或不是本 App 导出的 .ncpbak 文件。'));
  expect(allText(renderer)).not.toContain('本机数据库出了问题');
  expect(useOverlay.getState().dialogs).toHaveLength(0);
  // A valid pick clears the message and shows the preview.
  next=JSON.stringify({name:'fixture.ncpbak',base64:toBase64(bytes)});
  await press(renderer,'重新选择备份文件');
  await until(renderer,text=>text.includes('fixture.ncpbak'));
  expect(allText(renderer)).not.toContain('备份文件已损坏');
  // Picking a bad file afterwards drops the old preview so it cannot be restored by mistake.
  next=JSON.stringify({name:'broken.ncpbak',base64:toBase64(strToU8('PK broken'))});
  await press(renderer,'重新选择备份文件');
  await until(renderer,text=>text.includes('备份文件已损坏'));
  expect(allText(renderer)).not.toContain('fixture.ncpbak');
  expect(allText(renderer)).not.toContain('恢复 1 部作品');
  await act(async()=>renderer.unmount());
});
