import React, { useEffect, useState } from 'react';
import { FlatList, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { ChevronRight } from 'lucide-react-native';
import type { RootScreenProps } from '../../app/navigation/types';
import * as appInfo from '../../features/appInfo';
import { showAiDataNotice } from '../../app/dialogs';
import { NavBar } from '../../components/NavBar';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import legal from '../../assets/licenses.json';
import { color as c, font, maxContentWidth, pageMargin, radius, rowMinHeight } from '../../theme/tokens';

const repository = 'https://github.com/MathildaStacy/NovelCreationPartner';
const LICENSE_SUMMARY = '本软件以 GNU 通用公共许可证第 3 版（仅限该版本）发布。你可以自由使用、研究、修改和再分发；再分发修改版时须以相同许可证公开源代码。本软件不提供任何担保。';
const PRIVACY = '作品、档案和设置只保存在这台手机上。没有账号，没有我们的服务器。只有在你使用 AI 功能时，相关内容才会发送到你自己配置的模型服务。API Key 保存在系统安全存储中，不会被导出或上传。';

/**
 * S15f. The two read-only sub-pages (开源许可 / 第三方组件许可) are pushed as the
 * same route with `page`, so the Android back key and the swipe return to 关于.
 */
export function AboutScreen({ navigation, route }: RootScreenProps<'About'>) {
  const page = route.params?.page;
  if (page === 'license') { return <LicensePage onBack={() => navigation.goBack()} />; }
  if (page === 'thirdParty') { return <ThirdPartyPage onBack={() => navigation.goBack()} />; }
  return <AboutHome onBack={() => navigation.goBack()} open={next => navigation.push('About', { page: next })} />;
}

async function openLink(url: string) {
  try { await Linking.openURL(url); } catch { Clipboard.setString(url); toast('无法打开链接，已复制地址'); }
}

function AboutHome({ onBack, open }: { onBack: () => void; open: (page: 'license' | 'thirdParty') => void }) {
  const [build, setBuild] = useState<appInfo.AppInfo | null>(appInfo.cached());
  useEffect(() => { let active = true; appInfo.get().then(info => { if (active) { setBuild(info); } }); return () => { active = false; }; }, []);
  const version = appInfo.label(build);
  const copyVersion = () => {
    Clipboard.setString(`AI 小说创作伙伴 ${version} · ${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Platform.Version}`);
    toast('已复制版本信息');
  };
  return <View style={styles.root}><NavBar title="关于" backLabel="设置" onBack={onBack} />
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable onPress={copyVersion} accessibilityRole="button" accessibilityLabel={`AI 小说创作伙伴，版本 ${version}，点按复制`} style={styles.brand}>
        <View style={styles.logo} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Txt style={styles.logoText}>伴</Txt></View>
        <View style={styles.flex}><Txt variant="title2">AI 小说创作伙伴</Txt><Txt variant="caption" color={c.ink3}>{`版本 ${version} · 点按复制`}</Txt></View>
      </Pressable>
      <Group title="隐私" />
      <View style={styles.card}><View style={styles.text}><Txt>{PRIVACY}</Txt></View>
        <Row title="AI 数据发送说明" onPress={() => { showAiDataNotice(); }} separated /></View>
      <Group title="开源" />
      <View style={styles.card}>
        <Row title="开源许可" subtitle="GPL-3.0-only" onPress={() => open('license')} />
        <Row title="第三方组件许可" subtitle={`${legal.packages.length} 个组件`} onPress={() => open('thirdParty')} separated />
        <Row title="源代码" subtitle={repository.replace(/^https:\/\//, '')} onPress={() => { openLink(repository); }} separated />
        <Row title="反馈问题" subtitle="在 GitHub Issues 提交" onPress={() => { openLink(`${repository}/issues/new`); }} separated />
      </View>
    </ScrollView></View>;
}

function LicensePage({ onBack }: { onBack: () => void }) {
  const paragraphs = legal.license.split(/\n\s*\n/);
  return <View style={styles.root}><NavBar title="开源许可" backLabel="关于" onBack={onBack} />
    <FlatList data={paragraphs} keyExtractor={(_, index) => String(index)} contentContainerStyle={styles.content} initialNumToRender={12}
      ListHeaderComponent={<View style={styles.summary}><Txt variant="headline">GPL-3.0-only</Txt><Txt>{LICENSE_SUMMARY}</Txt></View>}
      renderItem={({ item }) => <Txt variant="caption" selectable style={styles.mono}>{item}</Txt>} />
  </View>;
}

function ThirdPartyPage({ onBack }: { onBack: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const packages = [...legal.packages].sort((a, b) => a.name.localeCompare(b.name));
  return <View style={styles.root}><NavBar title="第三方组件许可" backLabel="关于" onBack={onBack} />
    <FlatList data={packages} keyExtractor={pkg => `${pkg.name}@${pkg.version}`} contentContainerStyle={styles.content}
      ListHeaderComponent={legal.missing.length ? <Txt color={c.pend}>{legal.missing.length} 个已安装包未附完整许可文本，发布前需补齐。</Txt> : undefined}
      ListEmptyComponent={<Txt color={c.ink3}>开发构建未生成许可清单</Txt>}
      renderItem={({ item: pkg }) => {
        const key = `${pkg.name}@${pkg.version}`;
        return <View style={styles.card}>
          <Row title={`${pkg.name} ${pkg.version} · ${pkg.license}`} onPress={() => setExpanded(value => value === key ? null : key)} expanded={expanded === key} />
          {expanded === key ? <View style={styles.text}><Txt variant="caption" selectable style={styles.mono}>{pkg.text}</Txt></View> : null}
        </View>;
      }} ItemSeparatorComponent={Gap} />
  </View>;
}

const Gap = () => <View style={styles.gap} />;

function Group({ title }: { title: string }) {
  return <Txt variant="callout" color={c.ink2} style={styles.group}>{title}</Txt>;
}

function Row({ title, subtitle, onPress, separated, expanded }: { title: string; subtitle?: string; onPress: () => void; separated?: boolean; expanded?: boolean }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} accessibilityState={expanded === undefined ? undefined : { expanded }}
    style={({ pressed }) => [styles.row, separated && styles.sep, pressed && styles.pressed]}>
    <View style={styles.flex}><Txt numberOfLines={2}>{title}</Txt>{subtitle ? <Txt variant="caption" color={c.ink3} numberOfLines={1}>{subtitle}</Txt> : null}</View>
    <ChevronRight size={18} color={c.ink3} style={expanded ? styles.down : undefined} />
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  content: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingHorizontal: pageMargin, paddingTop: 12, paddingBottom: 32, gap: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  logo: { width: 48, height: 48, borderRadius: 12, backgroundColor: c.slip, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: c.night, fontFamily: font.serif, fontSize: 26, fontWeight: '600' },
  flex: { flex: 1, gap: 2 },
  group: { marginTop: 16 },
  card: { backgroundColor: c.surface, borderRadius: radius.card, overflow: 'hidden' },
  text: { paddingHorizontal: 16, paddingVertical: 12 },
  row: { minHeight: rowMinHeight, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  pressed: { backgroundColor: c.sunken },
  summary: { gap: 8, marginBottom: 8 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  down: { transform: [{ rotate: '90deg' }] },
  gap: { height: 8 },
});
