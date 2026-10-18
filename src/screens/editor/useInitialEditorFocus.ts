import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RootScreenProps } from '../../app/navigation/types';

/**
 * Native-stack emits transitionEnd from native onAppear, including its initial
 * screen. Wait for that signal AND the body to be rendered before requesting the
 * keyboard. In particular a chapter-creation Modal must finish relinquishing
 * focus first. A retained editor never focuses again after a history round trip.
 */
export function useInitialEditorFocus(
  navigation: RootScreenProps<'Editor'>['navigation'],
  ready: boolean,
  focus: () => void,
) {
  const [appeared, setAppeared] = useState(false);
  const consumed = useRef(false);
  const focusRef = useRef(focus);
  focusRef.current = focus;

  useLayoutEffect(() => {
    const start = navigation.addListener('transitionStart', () => {
      if (!consumed.current) {
        setAppeared(false);
      }
    });
    const end = navigation.addListener('transitionEnd', e => {
      if (!e.data.closing && !consumed.current) {
        setAppeared(true);
      }
    });
    return () => {
      start();
      end();
    };
  }, [navigation]);

  useEffect(() => {
    if (!ready || !appeared || consumed.current) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (navigation.isFocused() && !consumed.current) {
        consumed.current = true;
        focusRef.current();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation, ready, appeared]);
}
