import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLoad } from '../../app/hooks';
import { showError } from '../../app/errors';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { DelayedSpinner } from '../../components/Loading';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import * as models from '../../features/modelServices';
import * as prefs from '../../features/prefs';
import { setTaskService, type TaskRoute } from '../../features/taskServices';
import { styles } from '../archive/shared';
const routes: { route: TaskRoute; title: string; description: string }[] = [
  { route: 'writing', title: '写作', description: '描写、选区改写、AI 伙伴和条目补全' },
  { route: 'utility', title: '整理', description: '方案对比、采纳拆解、章节摘要与记忆提取' },
  { route: 'review', title: '校对', description: '章节冲突检测' },
];
/** Bind only services explicitly saved by the author. Choosing never makes a test request. */
export function ServiceBindingsSheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const [saving, setSaving] = useState(false);
  const loaded = useLoad(async () => ({ services: await models.list(), bindings: await prefs.get('serviceBindings') }), [visible], {
    events: { 'services.changed': () => true, 'prefs.changed': event => event.key === 'serviceBindings' }, debounceMs: 0,
  });
  const bind = async (route: TaskRoute, serviceId: string | null) => {
    if (saving) { return; } setSaving(true);
    try { await setTaskService(route, serviceId); await loaded.reload(); } catch (error) { await showError(error); } finally { setSaving(false); }
  };
  return <Sheet visible={visible} title="任务使用的模型服务" locked={saving} onRequestClose={onClose} headerRight={<Button label="完成" variant="text" disabled={saving} onPress={onClose} />}>
    <ScrollView contentContainerStyle={styles.content}>
      <Txt>可为不同任务选择已有服务。不选择时沿用默认服务，切换只影响之后发起的新操作。</Txt>
      {loaded.loading ? <DelayedSpinner /> : loaded.data ? routes.map(item => {
        const binding = loaded.data?.bindings?.[item.route] ?? null;
        return <View key={item.route} style={styles.card}><Txt variant="headline">{item.title}</Txt><Txt variant="caption">{item.description}</Txt>
          {binding && !loaded.data?.services.some(service => service.id === binding) ? <Txt>原绑定服务已删除，请重新选择。</Txt> : null}
          <View style={styles.chips}><Chip label="沿用默认服务" selected={!binding} disabled={saving} onPress={() => { bind(item.route, null); }} />
            {loaded.data?.services.map(service => <Chip key={service.id} label={service.name} selected={binding === service.id} disabled={saving} onPress={() => { bind(item.route, service.id); }} />)}</View>
        </View>;
      }) : <View><Txt>无法读取服务设置。</Txt><Button label="重试" onPress={loaded.reload} /></View>}
      <Txt variant="caption">App 不会自动换服务。已入队的定稿作业保留入队时的服务与模型；缺失的显式绑定会要求重新选择，不会改发其他域名。</Txt>
    </ScrollView>
  </Sheet>;
}
