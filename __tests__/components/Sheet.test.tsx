import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Animated, Modal, View } from 'react-native';
import { Sheet } from '../../src/components/Sheet';

test.each([false, true])(
  'onShown waits for native show and completed entry (reduce motion: %s)',
  async reduced => {
    const reduction = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(reduced);
    let finished!: (result: { finished: boolean }) => void;
    const timing = jest
      .spyOn(Animated, 'timing')
      .mockImplementation((_value, config) => ({
        start: callback => {
          if (config.toValue === 1) {
            finished = callback!;
          }
        },
        stop: () => {},
        reset: () => {},
      }));
    const shown = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <Sheet visible onShown={shown} onRequestClose={() => {}}>
          <View />
        </Sheet>,
      );
    });
    expect(timing).not.toHaveBeenCalled();
    expect(shown).not.toHaveBeenCalled();
    await act(async () => {
      tree.root.findByType(Modal).props.onShow();
    });
    expect(timing).toHaveBeenCalledTimes(1);
    expect(shown).not.toHaveBeenCalled();
    await act(async () => {
      finished({ finished: false });
    });
    expect(shown).not.toHaveBeenCalled();
    await act(async () => {
      finished({ finished: true });
    });
    expect(shown).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
    timing.mockRestore();
    reduction.mockRestore();
  },
);

test('closing a sheet invalidates a delayed entry completion', async () => {
  const reduction = jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  let entered!: (result: { finished: boolean }) => void;
  const timing = jest
    .spyOn(Animated, 'timing')
    .mockImplementation((_value, config) => ({
      start: callback => {
        if (config.toValue === 1) {
          entered = callback!;
        }
      },
      stop: () => {},
      reset: () => {},
    }));
  const shown = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <Sheet visible onShown={shown} onRequestClose={() => {}}>
        <View />
      </Sheet>,
    );
  });
  await act(async () => {
    tree.root.findByType(Modal).props.onShow();
  });
  await act(async () => {
    tree.update(
      <Sheet visible={false} onShown={shown} onRequestClose={() => {}}>
        <View />
      </Sheet>,
    );
  });
  await act(async () => {
    entered({ finished: true });
  });
  expect(shown).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
  timing.mockRestore();
  reduction.mockRestore();
});

test('reopening during the exit animation reuses the native modal and completes entry', async () => {
  const reduction = jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  // Run the real JS animation driver: Jest's native-driver mock completes
  // immediately and cannot represent an interrupted 220 ms exit.
  const realTiming = Animated.timing;
  const timing = jest
    .spyOn(Animated, 'timing')
    .mockImplementation((value, config) =>
      realTiming(value, { ...config, useNativeDriver: false }),
    );
  const shown = jest.fn();
  const closed = jest.fn();
  const props = { onShown: shown, onClosed: closed, onRequestClose: () => {} };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <Sheet visible {...props}>
        <View />
      </Sheet>,
    );
  });
  await act(async () => {
    tree.root.findByType(Modal).props.onShow();
  });
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 350)));
  expect(shown).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.update(
      <Sheet visible={false} {...props}>
        <View />
      </Sheet>,
    );
  });
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 30)));
  // The real 220 ms exit is still running; Modal.onShow will not fire again.
  expect(tree.root.findAllByType(Modal)).toHaveLength(1);
  await act(async () => {
    tree.update(
      <Sheet visible {...props}>
        <View />
      </Sheet>,
    );
  });
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 350)));
  expect(shown).toHaveBeenCalledTimes(2);
  expect(closed).not.toHaveBeenCalled();
  expect(
    timing.mock.calls.filter(([, config]) => config.toValue === 1),
  ).toHaveLength(2);
  await act(async () => {
    tree.root.findByType(Modal).props.onShow();
  });
  expect(
    timing.mock.calls.filter(([, config]) => config.toValue === 1),
  ).toHaveLength(2);
  await act(async () => tree.unmount());
  timing.mockRestore();
  reduction.mockRestore();
});
