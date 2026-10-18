import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootScreenProps } from '../../app/navigation/types';
import { Txt } from '../../components/Text';
import { color as c, font, maxContentWidth, pageMargin, radius } from '../../theme/tokens';

/** S01 makes no writes: saving/skipping S02 or restoring a backup finishes onboarding. */
export function WelcomeScreen({ navigation }: RootScreenProps<'Welcome'>) {
  const insets = useSafeAreaInsets();
  return <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
    <View style={styles.sky} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[6, 24, 51, 72, 91, 38, 64].map((left, index) => <View key={index} style={[styles.star, { left: `${left}%`, top: 20 + index * 34 }]} />)}
    </View>
    <View style={styles.slogan} accessible accessibilityLabel="让每一个创意，都有故事可写">
      <Txt style={styles.vertical} color={c.paper} allowFontScaling={false}>{'都有故事可写'.split('').join('\n')}</Txt>
      <Txt style={styles.vertical} color={c.paper} allowFontScaling={false}>{'让每一个创意'.split('').join('\n')}</Txt>
    </View>
    <View style={styles.brand}><View style={styles.logo} accessibilityElementsHidden><Txt style={styles.logoText}>伴</Txt></View><Txt variant="title2" color={c.paper}>AI 小说创作伙伴</Txt></View>
    <View style={styles.explanation}><Txt color="#C9C3EE">你决定剧情，AI 提问和给选项。</Txt><Txt color="#C9C3EE">人物、设定和伏笔都记在档案里。</Txt><Txt color="#C9C3EE">作品存在本机，Key 保存在系统安全存储中。</Txt></View>
    <View style={styles.actions}><Pressable accessibilityRole="button" accessibilityLabel="开始创作" style={styles.start}
      onPress={() => navigation.navigate('ModelService', { mode: 'guide', from: 'welcome' })}><Txt color={c.night} weight="600">开始创作</Txt></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="从备份恢复" style={styles.restore} onPress={() => navigation.navigate('Restore', { from: 'welcome' })}><Txt color="#C9C3EE">从备份恢复</Txt></Pressable></View>
  </ScrollView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.night },
  content: { flexGrow: 1, minHeight: 600, maxWidth: maxContentWidth, width: '100%', alignSelf: 'center', paddingHorizontal: pageMargin + 8, gap: 28 },
  sky: { position: 'absolute', top: 40, left: 20, right: 20, height: 290 },
  star: { width: 2, height: 2, borderRadius: 2, position: 'absolute', backgroundColor: c.white, opacity: 0.55 },
  slogan: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, minHeight: 230 },
  vertical: { fontFamily: font.serif, fontSize: 28, lineHeight: 34 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 40, height: 40, borderRadius: 10, backgroundColor: c.slip, justifyContent: 'center', alignItems: 'center' },
  logoText: { color: c.night, fontFamily: font.serif, fontSize: 22, fontWeight: '600' },
  explanation: { gap: 4 },
  actions: { gap: 8, marginTop: 'auto' },
  start: { borderRadius: radius.card, backgroundColor: c.paper, minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12 },
  restore: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12 },
});
