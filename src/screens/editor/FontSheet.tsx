import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import { showError } from '../../app/errors';
import * as prefs from '../../features/prefs';
import { t } from '../../locales/zh-CN';
import { color as c } from '../../theme/tokens';

export function FontSheet({
  visible,
  onClose,
  font,
  size,
}: {
  visible: boolean;
  onClose: () => void;
  font: prefs.Prefs['editorFont'];
  size: prefs.Prefs['editorFontSize'];
}) {
  const [busy, setBusy] = useState(false);
  const set = async <K extends 'editorFont' | 'editorFontSize'>(
    key: K,
    value: prefs.Prefs[K],
  ) => {
    setBusy(true);
    try {
      await prefs.set(key, value);
    } catch (e) {
      await showError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      visible={visible}
      onRequestClose={onClose}
      title={t.editorMore.fontTitle}
      headerRight={
        <Button label={t.common.done} variant="text" onPress={onClose} />
      }
    >
      <View style={styles.content}>
        <Txt variant="callout" color={c.ink2}>
          {t.editorMore.fontLabel}
        </Txt>
        <Segmented
          segments={[
            { key: 'serif', label: t.editorMore.serif },
            { key: 'sans', label: t.editorMore.sans },
          ]}
          value={font}
          locked={busy}
          onChange={v => set('editorFont', v)}
        />
        <Txt variant="callout" color={c.ink2}>
          {t.editorMore.sizeLabel}
        </Txt>
        <Segmented
          segments={([16, 18, 20] as const).map(v => ({
            key: String(v),
            label: `${t.editorMore.sizes[v]} ${v}`,
          }))}
          value={String(size)}
          locked={busy}
          onChange={v =>
            set('editorFontSize', Number(v) as prefs.Prefs['editorFontSize'])
          }
        />
      </View>
    </Sheet>
  );
}
const styles = StyleSheet.create({ content: { padding: 20, gap: 12 } });
