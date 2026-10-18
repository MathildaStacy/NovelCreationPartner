import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import { APP_VERSION, showError, showErrorDetail } from '../../app/errors';
import { lightHaptic } from '../../app/haptics';
import { useLoad } from '../../app/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import { ActionSheet, type ActionItem } from '../../components/ActionSheet';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { NavBar } from '../../components/NavBar';
import { Txt } from '../../components/Text';
import { toast } from '../../components/overlay/store';
import { isAppError } from '../../features/errors';
import * as modelServices from '../../features/modelServices';
import * as prefs from '../../features/prefs';
import type { ModelService } from '../../features/types';
import { settingsText } from '../../locales/settings';
import { t } from '../../locales/zh-CN';
import { color as c, maxContentWidth, pageMargin, radius, rowMinHeight } from '../../theme/tokens';
import { truncate } from '../../utils/format';
import { hostOf } from './model/form';
import { removeService, runServiceTest, serviceStatus, useServiceTests } from './serviceActions';

const s = settingsText.settings;
const a = settingsText.serviceActions;

/**
 * S15 设置. This phase implements the model service group (S15a); the other
 * entries are shown per design and announce that they come later.
 */
export function SettingsScreen({ navigation }: RootScreenProps<'Settings'>) {
  const insets = useSafeAreaInsets();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const services = useLoad(async () => ({
    list: await modelServices.list(),
    pending: await modelServices.hasPendingKeyCleanup().catch(() => false),
  }), [], { events: { 'services.changed': () => true }, refetchOnFocus: true, debounceMs: 0 });
  const writing = useLoad(async () => ({
    font: await prefs.get('editorFont'),
    size: await prefs.get('editorFontSize'),
    count: await prefs.get('candidateCount'),
  }), [], { events: { 'prefs.changed': () => true } });
  const testing = useServiceTests(state => state.testing);
  const [menu, setMenu] = useState<ModelService | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const list = services.data?.list ?? [];
  const later = () => toast(t.common.comingSoon);
  const open = (service: ModelService) => {
    if (menuOpen) { return; }
    lightHaptic();
    setMenu(service);
    setMenuOpen(true);
  };

  const items: ActionItem[] = menu ? [
    ...(menu.isDefault ? [] : [{ key: 'default', label: a.setDefault }]),
    { key: 'edit', label: menu.hasKey ? a.edit : a.fillKey },
    ...(!menu.hasKey ? [] : [testing[menu.id]
      ? { key: 'test', label: a.testing, disabled: true }
      : { key: 'test', label: a.test }]),
    { key: 'remove', label: a.remove, destructive: true },
  ] : [];

  const act = async (key: string | null) => {
    const service = menu;
    if (!service || !key) { return; }
    // The menu decides from the row it was opened for; the services re-check state.
    if (key === 'default') {
      try {
        await modelServices.setDefault(service.id);
        toast(a.madeDefault(service.name));
      } catch (e) {
        if (isAppError(e, 'NOT_FOUND')) { toast(settingsText.form.gone); } else { showError(e); }
      }
    } else if (key === 'edit') {
      navigation.navigate('ModelService', service.hasKey
        ? { mode: 'edit', from: 'settings', serviceId: service.id }
        : { mode: 'edit', from: 'settings', serviceId: service.id, focus: 'key' });
    } else if (key === 'test') {
      runServiceTest(service, () => mounted.current && navigation.isFocused());
    } else if (key === 'remove') {
      await removeService(service, list);
    }
  };

  const font = writing.data ? s.fonts[writing.data.font] : null;
  return (
    <View style={styles.root}>
      <NavBar title={s.title} backLabel={s.back} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.groupHead}>
          <Txt variant="callout" color={c.ink2}>{s.services}</Txt>
          <Button label={s.addService} accessibilityLabel={s.addServiceA11y} variant="text" size="small"
            onPress={() => navigation.navigate('ModelService', { mode: 'add', from: 'settings' })} />
        </View>
        <View style={styles.card}>
          {services.error && !services.data ? (
            <Row title={s.loadFailed} subtitle={t.common.viewDetail} onPress={() => showErrorDetail(services.error, s.loadFailed)} />
          ) : services.data && list.length === 0 ? (
            <View style={styles.row}><Txt color={c.ink3}>{s.noService}</Txt></View>
          ) : list.map((service, i) => {
            const status = serviceStatus(service, !!testing[service.id]);
            const host = hostOf(service.baseUrl);
            const subtitle = `${host} · ${status.text}`;
            return (
              <Pressable key={service.id} onPress={() => open(service)} onLongPress={() => open(service)}
                accessibilityRole="button" accessibilityLabel={s.rowA11y(a.title(service.name, service.model), subtitle, service.isDefault)}
                style={({ pressed }) => [styles.row, i > 0 && styles.sep, pressed && styles.pressed]}>
                <View style={styles.rowText}>
                  <View style={styles.titleLine}>
                    <Txt numberOfLines={1} ellipsizeMode="middle" style={styles.shrink}>{a.title(service.name, service.model)}</Txt>
                    {service.isDefault ? <Badge label={s.defaultBadge} tone="confirmed" /> : null}
                  </View>
                  <Txt variant="caption" numberOfLines={1}
                    color={status.tone === 'warn' ? c.pend : status.tone === 'error' ? c.conf : c.ink3}>
                    {subtitle}
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </View>
        {services.data?.pending ? <Txt variant="caption" color={c.pend} style={styles.note}>{s.pendingCleanup}</Txt> : null}

        <GroupTitle title={s.writing} />
        <View style={styles.card}>
          <Row title={s.writingRow} subtitle={writing.data && font ? s.writingSummary(font, writing.data.size, writing.data.count) : ' '} onPress={later} />
        </View>

        <GroupTitle title={s.data} />
        <View style={styles.card}>
          <Row title={s.export} subtitle={s.exportSub} onPress={later} />
          <Row title={s.restore} subtitle={s.restoreSub} onPress={later} separated />
          <Row title={s.trash} subtitle={s.trashSub} onPress={later} separated />
        </View>

        <GroupTitle title={s.privacy} />
        <View style={styles.card}>
          <Row title={s.aiNotice} subtitle={s.aiNoticeSub} onPress={later} />
          <Row title={s.about} subtitle={s.aboutSub(APP_VERSION)} onPress={later} separated />
        </View>
      </ScrollView>
      <ActionSheet
        visible={menuOpen}
        title={menu ? truncate(a.title(menu.name, menu.model), 40) : undefined}
        items={items}
        onRequestClose={() => setMenuOpen(false)}
        onDone={key => { act(key); }}
      />
    </View>
  );
}

function GroupTitle({ title }: { title: string }) {
  return <Txt variant="callout" color={c.ink2} style={styles.groupTitle}>{title}</Txt>;
}

function Row({ title, subtitle, onPress, separated }: { title: string; subtitle: string; onPress: () => void; separated?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
      style={({ pressed }) => [styles.row, separated && styles.sep, pressed && styles.pressed]}>
      <View style={styles.rowText}>
        <Txt numberOfLines={1}>{title}</Txt>
        <Txt variant="caption" color={c.ink3} numberOfLines={1}>{subtitle}</Txt>
      </View>
      <ChevronRight size={18} color={c.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  content: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingHorizontal: pageMargin, paddingTop: 12 },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  groupTitle: { marginTop: 24, marginBottom: 8 },
  card: { backgroundColor: c.surface, borderRadius: radius.card, overflow: 'hidden' },
  row: { minHeight: rowMinHeight, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  pressed: { backgroundColor: c.sunken },
  rowText: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shrink: { flexShrink: 1 },
  note: { marginTop: 8 },
});
