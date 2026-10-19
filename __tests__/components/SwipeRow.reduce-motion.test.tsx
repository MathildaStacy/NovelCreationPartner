import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Pressable } from 'react-native';
import { SwipeRow, useSwipeGroup } from '../../src/components/SwipeRow';

// The row reads the system setting on first mount (UI_DESIGN §7 减弱动态效果).
jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

function Host() {
  const group = useSwipeGroup();
  return (
    <>
      <SwipeRow rowKey="甲" group={group} actions={[{ key: 'delete', label: '删除-甲', onPress: () => {} }]}>
        <Pressable accessibilityLabel="行-甲" onLongPress={() => group.open('甲')} />
      </SwipeRow>
      <Pressable accessibilityLabel="外部收起" onPress={group.close} />
    </>
  );
}

test('with reduce motion the row snaps and closed actions leave the tree immediately', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { tree = ReactTestRenderer.create(<Host />); });
  await act(async () => { await new Promise<void>(r => setTimeout(r, 0)); });
  const find = (label: string, prop = 'onPress') =>
    tree.root.findAll(n => typeof n.type !== 'string' && n.props.accessibilityLabel === label && typeof n.props[prop] === 'function');
  await act(async () => { find('行-甲', 'onLongPress')[0].props.onLongPress(); });
  expect(find('删除-甲')).toHaveLength(1);
  await act(async () => { find('外部收起')[0].props.onPress(); });
  expect(tree.root.findAll(n => n.props.accessibilityLabel === '删除-甲')).toHaveLength(0);
  await act(async () => tree.unmount());
});
