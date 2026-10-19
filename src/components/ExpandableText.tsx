import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Button } from './Button';
import { Txt } from './Text';
import { toast } from './overlay/store';

/** Long fields remain readable; copying always uses the complete value. */
export function ExpandableText({ value, color }: { value: string; color?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [long, setLong] = useState(value.split('\n').length > 6);
  return <View>
    <Pressable accessibilityRole="text" onLongPress={() => { try { Clipboard.setString(value); toast('已复制'); } catch { toast('没有复制成功，请重试'); } }}>
      <Txt selectable color={color} numberOfLines={expanded ? undefined : 6} onTextLayout={event => { if (event.nativeEvent.lines.length > 6) { setLong(true); } }}>{value}</Txt>
    </Pressable>
    {long ? <Button label={expanded ? '收起' : '展开'} variant="text" onPress={() => setExpanded(old => !old)} /> : null}
  </View>;
}
