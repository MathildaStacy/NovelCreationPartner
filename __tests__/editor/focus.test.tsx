import React from 'react';
import {
  act,
  create,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import type { RootScreenProps } from '../../src/app/navigation/types';
import { useInitialEditorFocus } from '../../src/screens/editor/useInitialEditorFocus';

type Event = { data: { closing: boolean } };
function navigationFixture() {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const isFocused = jest.fn(() => true);
  const addListener = jest.fn((name: string, listener: (e: Event) => void) => {
    const set = listeners.get(name) ?? new Set();
    set.add(listener);
    listeners.set(name, set);
    return () => {
      set.delete(listener);
    };
  });
  const emit = (name: string, closing = false) =>
    listeners.get(name)?.forEach(fn => fn({ data: { closing } }));
  return {
    navigation: {
      addListener,
      isFocused,
    } as unknown as RootScreenProps<'Editor'>['navigation'],
    emit,
    isFocused,
  };
}

function FocusHarness({
  navigation,
  ready,
  focus,
}: {
  navigation: RootScreenProps<'Editor'>['navigation'];
  ready: boolean;
  focus: () => void;
}) {
  useInitialEditorFocus(navigation, ready, focus);
  return null;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('waits for both the first body render and native transition end, then focuses exactly once', async () => {
  const { navigation, emit } = navigationFixture();
  const input = { focus: jest.fn() };
  let r!: Renderer;
  await act(async () => {
    r = create(
      <FocusHarness
        navigation={navigation}
        ready={false}
        focus={() => input.focus()}
      />,
    );
  });
  await act(async () => {
    emit('transitionStart');
  });
  await act(async () => {
    r.update(
      <FocusHarness
        navigation={navigation}
        ready
        focus={() => input.focus()}
      />,
    );
    jest.advanceTimersByTime(1000);
  });
  expect(input.focus).not.toHaveBeenCalled();
  await act(async () => {
    emit('transitionEnd', true);
    jest.advanceTimersByTime(1000);
  });
  expect(input.focus).not.toHaveBeenCalled();
  await act(async () => {
    emit('transitionEnd');
  });
  await act(async () => {
    jest.advanceTimersByTime(16);
  });
  expect(input.focus).toHaveBeenCalledTimes(1);
  // Version restoration reloads body in the retained screen; history returns emit onAppear again.
  await act(async () => {
    r.update(
      <FocusHarness
        navigation={navigation}
        ready={false}
        focus={() => input.focus()}
      />,
    );
  });
  await act(async () => {
    r.update(
      <FocusHarness
        navigation={navigation}
        ready
        focus={() => input.focus()}
      />,
    );
    emit('transitionStart');
    emit('transitionEnd');
  });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(input.focus).toHaveBeenCalledTimes(1);
  await act(async () => r.unmount());
});

it('handles onAppear before a slow chapter load and cancels the pending focus on unmount', async () => {
  const { navigation, emit } = navigationFixture();
  const focus = jest.fn();
  let r!: Renderer;
  await act(async () => {
    r = create(
      <FocusHarness navigation={navigation} ready={false} focus={focus} />,
    );
    emit('transitionEnd');
  });
  // Effects are attached after create commits, matching a native onAppear event.
  await act(async () => {
    emit('transitionEnd');
  });
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(focus).not.toHaveBeenCalled();
  await act(async () => {
    r.update(<FocusHarness navigation={navigation} ready focus={focus} />);
  });
  await act(async () => r.unmount());
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(focus).not.toHaveBeenCalled();
});

it('focuses once when the body arrives after the native transition already completed', async () => {
  const { navigation, emit } = navigationFixture();
  const focus = jest.fn();
  let r!: Renderer;
  await act(async () => {
    r = create(
      <FocusHarness navigation={navigation} ready={false} focus={focus} />,
    );
  });
  await act(async () => {
    emit('transitionEnd');
  });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(focus).not.toHaveBeenCalled();
  await act(async () => {
    r.update(<FocusHarness navigation={navigation} ready focus={focus} />);
  });
  await act(async () => {
    jest.advanceTimersByTime(16);
  });
  expect(focus).toHaveBeenCalledTimes(1);
  await act(async () => r.unmount());
});
