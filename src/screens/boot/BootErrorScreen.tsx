import React from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { toast } from '../../components/overlay/store';
import { Txt } from '../../components/Text';
import { errorDetailText, toAppError } from '../../app/errors';
import { t } from '../../locales/zh-CN';
import { color as c, pageMargin } from '../../theme/tokens';

/**
 * G02 §10 step 1 failure page. The design asks for "导出原始数据库"; file export
 * needs the file layer (S15b), so phase 1 offers 复制详情 and 重试.
 */
export function BootErrorScreen({ stage, error, onRetry }: { stage: 'open' | 'migrate'; error: unknown; onRetry: () => void }) {
  const insets = useSafeAreaInsets();
  const title = stage === 'migrate' ? t.boot.migrateFailedTitle : t.boot.openFailedTitle;
  const body = stage === 'migrate' ? t.boot.migrateFailedBody : t.boot.openFailedBody;
  const err = toAppError(error);
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}
    >
      <Txt variant="title2" accessibilityRole="header">
        {title}
      </Txt>
      <Txt variant="body" color={c.ink2}>
        {body}
      </Txt>
      <View style={styles.detail}>
        <Txt variant="caption" color={c.ink3} selectable>
          {err.message}
        </Txt>
      </View>
      <Button
        label={t.boot.copyDetail}
        variant="secondary"
        onPress={() => {
          Clipboard.setString(errorDetailText(err, title));
          toast(t.common.copied);
        }}
      />
      <Button label={t.boot.retry} variant="text" onPress={onRetry} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  content: { paddingHorizontal: pageMargin, gap: 16 },
  detail: { backgroundColor: c.sunken, borderRadius: 10, padding: 12 },
});
