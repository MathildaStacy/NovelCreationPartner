import React from 'react';
import { ScrollView, View } from 'react-native';
import { useLoad } from '../../app/hooks';
import { Button } from '../../components/Button';
import { DelayedSpinner } from '../../components/Loading';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import * as usage from '../../features/aiUsage';
import { styles } from '../archive/shared';
/** Content-free totals. Missing provider usage and prices remain explicitly unknown. */
export function AiUsageSheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const loaded = useLoad(() => usage.summary(), [visible], { events: { 'usage.changed': () => true }, debounceMs: 100 });
  const summary = loaded.data;
  return <Sheet visible={visible} title="本机 AI 用量" onRequestClose={onClose} headerRight={<Button label="完成" variant="text" onPress={onClose} />}>
    <ScrollView contentContainerStyle={styles.content}>
      {loaded.loading ? <DelayedSpinner /> : summary ? <>
        <View style={styles.card}><Txt variant="headline">{summary.attempts} 次物理请求</Txt><Txt>来自 {summary.requests} 个操作，包含重试和连接测试。</Txt></View>
        <View style={styles.card}><Txt weight="600">服务已返回的用量</Txt><Txt>输入 {summary.input.toLocaleString()} token</Txt><Txt>输出 {summary.output.toLocaleString()} token</Txt></View>
        {summary.unknown ? <View style={styles.notice}><Txt>{summary.unknown} 次请求未返回完整用量，可能已计费。</Txt><Txt variant="caption">取消、失败和中断请求也可能收费，这部分没有按零计算。</Txt></View> : null}
        <Txt>费用未知。当前尚无可靠的本机定价快照，token 不能代表精确账单。</Txt>
        <Txt variant="caption">本统计只包含本 App 在这台设备记录的尝试，不包含同一 Key 在其他工具的用量。输入/输出明细按服务最终累计快照结算。</Txt>
      </> : <View><Txt>暂时无法读取用量。</Txt><Button label="重试" onPress={loaded.reload} /></View>}
    </ScrollView>
  </Sheet>;
}
