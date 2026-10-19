import React from 'react';
import { ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { color as c } from '../../theme/tokens';

/** Only React Native built-ins: the usual UI and copy action may be unavailable. */
export function NativeBuildErrorScreen({ missingModules }: { missingModules: readonly string[] }) {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">应用需要更新</Text>
        <Text style={styles.body}>
          当前安装的应用组件不完整，暂时无法启动。请更新安装包后再打开，不要卸载应用或清除数据。
        </Text>
        <Text style={styles.body}>作品数据仍保留在本机。可以长按选择下方详情，反馈此问题。</Text>
        <Text style={styles.detail} selectable>缺少组件：{missingModules.join('、')}</Text>
        {__DEV__ ? <Text style={styles.detail} selectable>
          开发调试：拉取代码后先运行 npm ci，再运行 npm run android 重新编译并覆盖安装。
          仅重启 Metro 或 Reload 无法更新原生组件。
        </Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  content: { paddingHorizontal: 28, paddingVertical: 48, gap: 20 },
  title: { color: c.ink, fontSize: 24, fontWeight: '600' },
  body: { color: c.ink, fontSize: 16, lineHeight: 26 },
  detail: { color: c.ink2, fontSize: 14, lineHeight: 24 },
});
