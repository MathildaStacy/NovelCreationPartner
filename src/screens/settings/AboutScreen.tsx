import React, { useEffect, useState } from 'react';
import { FlatList, Linking, Platform, ScrollView, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import type { RootScreenProps } from '../../app/navigation/types';
import * as appInfo from '../../features/appInfo';
import { confirmAiData } from '../../app/dialogs';
import { Button } from '../../components/Button';
import { NavBar } from '../../components/NavBar';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import { styles } from '../archive/shared';
import legal from '../../assets/licenses.json';
import { color as c } from '../../theme/tokens';

const repository = 'https://github.com/MathildaStacy/NovelCreationPartner';
export function AboutScreen({ navigation }: RootScreenProps<'About'>) {
  const [privacy, setPrivacy] = useState(false);
  const [license, setLicense] = useState(false);
  const [thirdParty, setThirdParty] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [build, setBuild] = useState<appInfo.AppInfo|null>(null);
  useEffect(() => { let active=true;appInfo.get().then(info=>{if(active)setBuild(info);});return ()=>{active=false;}; },[]);
  const version=appInfo.label(build);
  const link = async (url: string) => { try { await Linking.openURL(url); } catch { Clipboard.setString(url); toast('无法打开链接，已复制地址'); } };
  if (thirdParty) { return <View style={styles.root}><NavBar title="第三方组件许可" onBack={() => setThirdParty(false)} /><FlatList data={legal.packages} keyExtractor={pkg => `${pkg.name}@${pkg.version}`} contentContainerStyle={styles.content} ListHeaderComponent={legal.missing.length ? <Txt color={c.pend}>{legal.missing.length} 个已安装包未附完整许可文本，发布前需补齐。</Txt> : undefined} renderItem={({ item: pkg }) => <View style={styles.card}><Button label={`${pkg.name} ${pkg.version} · ${pkg.license}`} variant="text" onPress={() => setExpanded(value => value === `${pkg.name}@${pkg.version}` ? null : `${pkg.name}@${pkg.version}`)} />{expanded === `${pkg.name}@${pkg.version}` ? <Txt variant="caption" selectable>{pkg.text}</Txt> : null}</View>} /></View>; }
  return <View style={styles.root}><NavBar title="关于" onBack={() => navigation.goBack()} /><ScrollView contentContainerStyle={styles.content}>
    <Txt variant="title2">AI 小说创作伙伴</Txt><Button label={`版本 ${version}`} variant="text" onPress={() => { Clipboard.setString(`AI 小说创作伙伴 ${version} · ${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Platform.Version}`); toast('已复制版本信息'); }} />
    <View style={styles.card}><Txt>你决定剧情，AI 只提问、给选项和建议。</Txt><Txt>正式设定与正文变更由你确认。</Txt></View>
    <Button label="隐私说明" variant="secondary" onPress={() => setPrivacy(prev => !prev)} />
    {privacy ? <View style={styles.card}><Txt>作品存储在本机 SQLite 和应用沙盒。没有账号或云同步。</Txt><Txt>只有你使用 AI 时，才把预览中列出的内容直接发送到你配置的服务；数据处理以服务商政策为准。</Txt><Txt>API Key 存储于系统安全存储，不写数据库，不进入备份。导出与分享由你主动操作。</Txt><Txt>App 不接入统计、广告或崩溃上报 SDK。</Txt></View> : null}
    <Button label="AI 数据发送说明" variant="secondary" onPress={() => { confirmAiData('你配置的模型服务', true); }} />
    <Txt variant="headline">GPL-3.0-only</Txt><Txt>本软件以 GNU 通用公共许可证第 3 版（仅限该版本）发布。你可以自由使用、研究、修改和再分发；再分发修改版时须以相同许可证公开源代码。本软件不提供任何担保。</Txt>
    <Txt variant="caption" color={c.ink3}>许可清单由已安装生产依赖自动生成，缺少文本的包仍需发布审核。</Txt>
    <Button label="查看完整开源许可" variant="text" onPress={() => setLicense(value => !value)} />
    {license ? legal.license.split(/\n\s*\n/).map((paragraph, index) => <Txt key={index} variant="caption" selectable>{paragraph}</Txt>) : null}
    <Button label={`第三方组件许可 · ${legal.packages.length} 个组件`} variant="text" onPress={() => setThirdParty(value => !value)} />

    <Button label="源代码" variant="text" onPress={() => { link(repository); }} /><Button label="反馈问题" variant="text" onPress={() => { link(`${repository}/issues/new`); }} />
  </ScrollView></View>;
}
