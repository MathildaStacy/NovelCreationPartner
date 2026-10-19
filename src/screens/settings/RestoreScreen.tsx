import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { BusyOverlay } from '../../components/BusyOverlay';
import { NavBar } from '../../components/NavBar';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Txt } from '../../components/Text';
import { showDialog, toast } from '../../components/overlay/store';
import { showError, showErrorDetail, toAppError } from '../../app/errors';
import { t } from '../../locales/zh-CN';
import type { RootScreenProps } from '../../app/navigation/types';
import * as backup from '../../features/backup';
import * as documents from '../../features/backupFiles';
import * as prefs from '../../features/prefs';
import * as works from '../../features/works';
import { color as c, radius } from '../../theme/tokens';
import { formatDateTime } from '../../utils/format';

const BACK = { welcome: '欢迎', shelf: '书架', settings: '设置' } as const;

export function RestoreScreen({ navigation, route }: RootScreenProps<'Restore'>) {
  const [file, setFile] = useState<{ name: string; inspection: backup.BackupInspection }>();
  const [selected, setSelected] = useState<string[]>([]);
  const [services, setServices] = useState(false);
  const [existingTitles, setExistingTitles] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [leaving, setLeaving] = useState<'later' | 'fill' | null>(null);
  const busyRef = useRef(false);
  const completedRef = useRef(false);
  usePreventRemove(busy, () => {});
  useEffect(() => {
    if (busy || !leaving) return;
    // Detach the native removal guard before dispatching the completed navigation.
    const timer = setTimeout(() => {
      if (route.params.from === 'welcome') navigation.reset({ index: leaving === 'fill' ? 1 : 0,
        routes: [{ name: 'Shelf' }, ...(leaving === 'fill' ? [{ name: 'Settings' as const }] : [])] });
      else if (leaving === 'fill' && route.params.from === 'settings') navigation.popTo('Settings');
      else if (leaving === 'fill') navigation.replace('Settings');
      else navigation.goBack();
    }, 0);
    return () => clearTimeout(timer);
  }, [busy, leaving, navigation, route.params.from]);

  const pick = async () => {
    if (busyRef.current || completedRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const next = await documents.pick();
      if (!next) return;
      setFileError(null);
      const current = await works.list();
      setFile(next); setSelected(next.inspection.manifest.works.map(work => work.id));
      setServices(next.inspection.services > 0); setExistingTitles(new Set(current.map(work => work.title ?? '未命名作品')));
    } catch (error) {
      // S15c: invalid / too-new files are explained under the file card; the
      // previous preview is dropped so it cannot be restored by mistake.
      const appError = toAppError(error);
      if (appError.code === 'BACKUP_INVALID' || appError.code === 'BACKUP_TOO_NEW') { setFile(undefined); setSelected([]); setServices(false); setFileError(appError.message); }
      else await showError(error);
    }
    finally { busyRef.current = false; setBusy(false); }
  };
  const restore = async () => {
    if (!file || busyRef.current || completedRef.current || !selected.length && !services) return;
    busyRef.current = true; setBusy(true);
    try {
      const key = await showDialog({ title: selected.length ? `恢复 ${selected.length} 部作品？` : '只恢复模型服务？',
        message: `将作为新作品加入书架，不会覆盖现有作品。${services ? '模型服务配置不含 API Key，恢复后需要重新填写。' : ''}`,
        buttons: [{ key: 'restore', label: '恢复', style: 'primary' }, { key: 'cancel', label: '取消' }], dismissKey: 'cancel' });
      if (key !== 'restore') return;
      setRestoring(true);
      let result: { works: number; services: number };
      try { result = await backup.restore(file.inspection, { workIds: [...selected], includeServices: services }); }
      catch (error) {
        const full = toAppError(error).code === 'STORAGE_FULL';
        const detail = await showDialog({ title: '恢复失败，手机上的数据没有变化。', message: full ? t.errors.storageFull : '可以保留当前选择后重试。',
          buttons: [{ key: 'detail', label: '查看详情' }, { key: 'close', label: '关闭', style: 'primary' }], dismissKey: 'close' });
        if (detail === 'detail') await showErrorDetail(error, '恢复失败');
        return;
      }
      completedRef.current = true;
      if (route.params.from === 'welcome') {
        try { if (!await prefs.get('onboardingDone')) await prefs.set('onboardingDone', true); }
        catch (error) {
          await showDialog({ title: '内容已恢复', message: '未能保存欢迎页状态。恢复的内容已经保留，下次进入仍可继续使用。', buttons: [{ key: 'ok', label: '知道了', style: 'primary' }] });
          await showError(error);
        }
      }
      if (result.services) {
        const next = await showDialog({ title: result.works ? '作品已恢复' : '模型服务已恢复', message: '备份不含 API Key，请为恢复的模型服务重新填写 Key。',
          buttons: [{ key: 'later', label: '稍后' }, { key: 'fill', label: '去填写', style: 'primary' }], dismissKey: 'later' });
        setLeaving(next === 'fill' ? 'fill' : 'later');
      } else { toast(`已恢复 ${result.works} 部作品`); setLeaving('later'); }
    } finally { setRestoring(false); busyRef.current = false; setBusy(false); }
  };
  const inspection = file?.inspection;
  const reading = busy && !restoring;
  return <View style={styles.root}><NavBar title="从备份恢复" backLabel={BACK[route.params.from]} onBack={() => { if (!busyRef.current) navigation.goBack(); }} /><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.card}>
      {inspection ? <View style={styles.row}><View style={styles.flex}><Txt weight="600" numberOfLines={1} ellipsizeMode="middle">{file!.name}</Txt>
        <Txt variant="caption" color={c.ink3}>导出于 {formatDateTime(inspection.manifest.exportedAt)} · App {inspection.manifest.app}</Txt></View>
        <Button label="重新选择" variant="text" size="small" disabled={busy} accessibilityLabel="重新选择备份文件" onPress={() => { pick(); }} /></View>
        : <><Txt>选择之前从本 App 导出的 .ncpbak 备份文件。正文导出的 TXT / Markdown 不能用于恢复。</Txt>
          {reading ? <View style={styles.reading} accessibilityRole="progressbar" accessibilityLabel="正在读取备份文件…"><ActivityIndicator color={c.brand} /><Txt color={c.ink2}>正在读取备份文件…</Txt></View>
            : <Button label={fileError ? '重新选择备份文件' : '选择备份文件'} disabled={busy} onPress={() => { pick(); }} />}</>}
      {inspection && reading ? <View style={styles.reading}><ActivityIndicator color={c.brand} /><Txt color={c.ink2}>正在读取备份文件…</Txt></View> : null}
    </View>
    {fileError ? <Txt color={c.conf} accessibilityRole="alert">{fileError}</Txt> : null}
    {inspection ? <><View style={styles.row}><Txt variant="callout" color={c.ink2} style={styles.flex}>要恢复的作品（{selected.length}/{inspection.manifest.works.length}）</Txt>
        {inspection.manifest.works.length ? <Button label={selected.length === inspection.manifest.works.length ? '全不选' : '全选'} variant="text" size="small" disabled={busy}
          onPress={() => setSelected(selected.length === inspection.manifest.works.length ? [] : inspection.manifest.works.map(work => work.id))} /> : null}</View>
      {inspection.manifest.works.map(work => <View key={work.id}><Chip label={`${work.title ?? '未命名作品'} · ${work.chapters} 章 · ${work.chars} 字`}
        selected={selected.includes(work.id)} disabled={busy} onPress={() => setSelected(old => old.includes(work.id) ? old.filter(id => id !== work.id) : [...old, work.id])} />
        {existingTitles.has(work.title ?? '未命名作品') ? <Txt variant="caption">同名 · 将命名为「{work.title ?? '未命名作品'}（恢复）」；已有同名副本时继续编号</Txt> : null}</View>)}
      {!inspection.manifest.works.length ? <Txt color={c.ink3}>这个备份里没有作品</Txt> : null}
      {inspection.services ? <View><Chip label={`同时恢复模型服务配置（${inspection.services} 个）`} selected={services} disabled={busy} onPress={() => setServices(value => !value)} />
        <Txt variant="caption" color={c.ink3}>不含 API Key，恢复后需要重新填写</Txt></View> : null}
      <Txt variant="caption" color={c.ink3}>恢复的内容作为新作品加入书架，不会覆盖或修改现有作品；不恢复后台任务，也不会自动执行 AI 操作。</Txt>
      <Button label={selected.length ? `恢复 ${selected.length} 部作品` : '只恢复模型服务'}
        disabled={busy || (!selected.length && !services)} onPress={() => { restore(); }} />
    </> : null}
  </ScrollView>
  {restoring ? <BusyOverlay label="正在恢复，请不要离开…" /> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper }, content: { padding: 20, gap: 16 }, flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  card: { backgroundColor: c.surface, borderRadius: radius.card, padding: 16, gap: 12 },
  reading: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
});
