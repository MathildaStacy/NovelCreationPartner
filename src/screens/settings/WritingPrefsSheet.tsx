import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLoad } from '../../app/hooks';
import { toast } from '../../components/overlay/store';
import { EmptyState } from '../../components/EmptyState';
import { Button } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import * as prefs from '../../features/prefs';
import { color as c, font } from '../../theme/tokens';
import { styles } from '../archive/shared';

/** S15e preferences persist on each explicit selection; existing explicit counts are preserved. */
export function WritingPrefsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const loaded = useLoad(async () => ({ editorFont: await prefs.get('editorFont'), editorFontSize: await prefs.get('editorFontSize'),
    candidateCount: await prefs.get('candidateCount'), partnerScope: await prefs.get('partnerScope') }), [visible], { events: { 'prefs.changed': () => true } });
  const change = async <K extends 'editorFont' | 'editorFontSize' | 'candidateCount' | 'partnerScope'>(key: K, value: prefs.Prefs[K]) => {
    if (busy) { return; } setBusy(true);
    try { await prefs.set(key, value); await loaded.reload(); } catch { toast('设置没有保存，请重试'); }
    finally { setBusy(false); }
  };
  const data = loaded.data;
  return <Sheet visible={visible} title="写作偏好" locked={busy} onRequestClose={onClose} headerRight={<Button label="关闭" variant="text" onPress={onClose} disabled={busy} />}>
    <ScrollView contentContainerStyle={styles.content}>
      {!data ? loaded.error ? <EmptyState title="偏好没有加载出来。" action={{ label: '重试', onPress: loaded.reload }} /> : null : <>
        <View style={styles.card}><Txt style={{ fontFamily: data.editorFont === 'serif' ? font.serif : font.sans, fontSize: data.editorFontSize, lineHeight: data.editorFontSize * 1.9 }}>{'　　舷窗外的星云缓缓旋转，像一枚被谁遗忘的纽扣。\n　　她把手贴在冰冷的玻璃上。'}</Txt></View>
        <Txt weight="600">正文字体</Txt><Segmented value={data.editorFont} locked={busy} segments={[{ key: 'serif', label: '宋体' }, { key: 'sans', label: '黑体' }]} onChange={value => { change('editorFont', value); }} />
        <Txt weight="600">字号</Txt><Segmented value={String(data.editorFontSize)} locked={busy} segments={[{ key: '16', label: '小 16' }, { key: '18', label: '中 18' }, { key: '20', label: '大 20' }]} onChange={value => { change('editorFontSize', Number(value) as 16 | 18 | 20); }} />
        <Txt variant="headline">AI 默认</Txt><Txt weight="600">描写候选版本数</Txt>
        <Segmented value={String(data.candidateCount)} locked={busy} segments={[{ key: '1', label: '1' }, { key: '2', label: '2' }, { key: '3', label: '3' }]} onChange={value => { change('candidateCount', Number(value) as 1 | 2 | 3); }} />
        <Txt variant="caption" color={c.ink3}>新用户默认 1 个版本。版本越多，等待和消耗越多；已有候选不受影响。</Txt>
        <Txt weight="600">AI 伙伴默认参考范围</Txt><Segmented value={data.partnerScope} locked={busy} segments={[{ key: 'confirmed', label: '相关已确认设定' }, { key: 'chapter', label: '某章相关' }]} onChange={value => { change('partnerScope', value); }} />
        <Txt variant="caption" color={c.ink3}>只影响之后新建对话。按章参考会在发送前让你选择章节，已有对话保留原范围。</Txt>
        <Txt variant="headline">固定行为</Txt><View style={styles.card}><Txt weight="600">自动保存</Txt><Txt>停止输入 2 秒后保存，离开时立即保存。</Txt><Txt weight="600">段首缩进与行距</Txt><Txt>每段两个全角空格；行高为字号的 1.9 倍。</Txt></View>
      </>}
    </ScrollView>
  </Sheet>;
}
