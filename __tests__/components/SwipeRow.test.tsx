import React, { useState } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';
import {
  SwipeRow,
  shouldCaptureSwipe,
  swipeAccessibility,
  swipeTarget,
  useSwipeGroup,
  type SwipeAction,
} from '../../src/components/SwipeRow';
import { allText, pressable } from '../helpers/render';

test('only clearly horizontal drags are claimed so list scrolling keeps vertical movement', () => {
  expect(shouldCaptureSwipe(-20, 3)).toBe(true);
  expect(shouldCaptureSwipe(20, 3)).toBe(true);
  expect(shouldCaptureSwipe(-10, 0)).toBe(false);
  expect(shouldCaptureSwipe(-20, 15)).toBe(false);
  expect(shouldCaptureSwipe(-4, -40)).toBe(false);
});

test('release settles open past half the action width or on a quick flick, otherwise closes', () => {
  expect(swipeTarget(0, -80, 0, 144)).toBe(-144);
  expect(swipeTarget(0, -60, 0, 144)).toBe(0);
  expect(swipeTarget(0, -30, -0.8, 144)).toBe(-144);
  expect(swipeTarget(-144, 40, 0, 144)).toBe(-144);
  expect(swipeTarget(-144, 90, 0, 144)).toBe(0);
  expect(swipeTarget(-144, 10, 0.9, 144)).toBe(0);
});

test('screen reader actions call the same handlers as the revealed buttons', () => {
  const rename = jest.fn();
  const remove = jest.fn();
  const a11y = swipeAccessibility([
    { key: 'rename', label: '重命名', onPress: rename },
    { key: 'delete', label: '删除', accessibilityLabel: '删除对话', onPress: remove },
  ]);
  expect(a11y.accessibilityActions).toEqual([
    { name: 'rename', label: '重命名' },
    { name: 'delete', label: '删除对话' },
  ]);
  a11y.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } } as never);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(rename).not.toHaveBeenCalled();
});

function List({ rows, onAction }: { rows: string[]; onAction: (row: string, key: string) => void }) {
  const group = useSwipeGroup();
  return (
    <>
      {rows.map(row => {
        const actions: SwipeAction[] = [
          { key: 'more', label: `更多-${row}`, onPress: () => onAction(row, 'more') },
          { key: 'delete', label: `删除-${row}`, tone: 'danger', onPress: () => onAction(row, 'delete') },
        ];
        return (
          <SwipeRow key={row} rowKey={row} group={group} actions={actions}>
            <Pressable accessibilityLabel={`行-${row}`} onLongPress={() => group.open(row)} onPress={() => onAction(row, 'open')}>
              <Text>{row}</Text>
            </Pressable>
          </SwipeRow>
        );
      })}
      <Text>{`open:${group.openKey ?? 'none'}`}</Text>
    </>
  );
}

async function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

const run = async (fn: () => void) => {
  await act(async () => {
    fn();
    await new Promise<void>(r => setTimeout(r, 0));
  });
};

/** Pressable action buttons (inert ones have no onPress). */
const live = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(n => typeof n.type !== 'string' && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');

test('one row open at a time; actions are inert unless their row is open and close it when used', async () => {
  const onAction = jest.fn();
  const tree = await render(<List rows={['甲', '乙']} onAction={onAction} />);
  expect(allText(tree)).not.toContain('删除-甲');
  await run(() => pressable(tree, '行-甲', 'onLongPress').props.onLongPress());
  expect(live(tree, '删除-甲')).toHaveLength(1);
  expect(allText(tree)).toContain('open:甲');
  // Opening another row closes the first (S10b rule 1): its buttons stop responding at once.
  await run(() => pressable(tree, '行-乙', 'onLongPress').props.onLongPress());
  expect(allText(tree)).toContain('open:乙');
  expect(live(tree, '删除-甲')).toHaveLength(0);
  expect(live(tree, '删除-乙')).toHaveLength(1);
  await run(() => live(tree, '删除-乙')[0].props.onPress());
  expect(onAction).toHaveBeenCalledWith('乙', 'delete');
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(allText(tree)).toContain('open:none');
  expect(live(tree, '删除-乙')).toHaveLength(0);
  await act(async () => tree.unmount());
});

test('while a row is open, tapping any row only collapses it instead of opening that row', async () => {
  const onAction = jest.fn();
  const tree = await render(<List rows={['甲', '乙']} onAction={onAction} />);
  await run(() => pressable(tree, '行-甲', 'onLongPress').props.onLongPress());
  const collapse = tree.root.findAll(n => n.props.accessibilityLabel === '收起操作' && typeof n.props.onPress === 'function');
  expect(collapse.length).toBeGreaterThanOrEqual(2);
  await run(() => collapse[collapse.length - 1].props.onPress());
  expect(allText(tree)).toContain('open:none');
  expect(onAction).not.toHaveBeenCalled();
  expect(tree.root.findAll(n => n.props.accessibilityLabel === '收起操作')).toHaveLength(0);
  await act(async () => tree.unmount());
});

test('a row removed while open releases the group so other rows are not blocked', async () => {
  function Host() {
    const [rows, setRows] = useState(['甲', '乙']);
    return (
      <>
        <List rows={rows} onAction={() => {}} />
        <Pressable accessibilityLabel="移除甲" onPress={() => setRows(['乙'])} />
      </>
    );
  }
  const tree = await render(<Host />);
  await run(() => pressable(tree, '行-甲', 'onLongPress').props.onLongPress());
  expect(allText(tree)).toContain('open:甲');
  await run(() => pressable(tree, '移除甲').props.onPress());
  expect(allText(tree)).toContain('open:none');
  await act(async () => tree.unmount());
});
