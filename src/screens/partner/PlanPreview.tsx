import React from 'react';
import { View } from 'react-native';
import type { ContextPlan } from '../../ai/context';
import { Button } from '../../components/Button';
import { Txt } from '../../components/Text';
import { styles } from '../archive/shared';

/** The plan object displayed here is passed unchanged to the feature executor. */
export function PlanPreview({ plan, onSend, loading, label = '发送' }: { plan: ContextPlan; onSend: () => void; loading?: boolean; label?: string }) {
  return <View style={styles.notice}>
    <Txt weight="600">发送范围 · {plan.serviceSnapshot.name}</Txt>
    <Txt variant="caption">{new URL(plan.serviceSnapshot.baseUrl).host} · {plan.serviceSnapshot.model}</Txt>
    <Txt>{`预计输入约 ${plan.estimatedInputTokens} token；每次输出上限 ${plan.maxOutputTokens} token；最多 ${plan.requests.length + 2} 次尝试。费用未知。`}</Txt>
    <Txt variant="caption">这是本地近似估算，实际用量由服务返回。</Txt>
    {plan.blocks.map((block, index) => <View key={`${block.sourceId}-${index}`}>
      <Txt variant="caption">{block.required ? '必需参考' : '相关参考'} · {block.state}</Txt>
      <Txt selectable>{block.text}</Txt>
    </View>)}
    {plan.omittedReasons.map((reason, index) => <Txt key={index} variant="caption">已省略 {reason.sourceId}：{reason.reason === 'optional_budget' ? '可选参考超出预算' : '不在所选范围'}</Txt>)}
    <Button label={label} loading={loading} onPress={onSend} />
  </View>;
}
