/** Data hooks for screens: load via services, refresh on service events (G02 §7) and on focus. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { on, type EventMap, type EventName } from '../features/events';
import { confirmDiscard, type DiscardCopy } from './dialogs';

export interface Loaded<T> {
  data: T | undefined;
  error: unknown;
  /** True only on the first load (screens show a delayed spinner). */
  loading: boolean;
  reload: () => Promise<void>;
  setData: (d: T) => void;
}

type Filter = { [K in EventName]?: (p: EventMap[K]) => boolean };

/**
 * Calls `fn` on mount and whenever `deps` change; reloads (debounced 300 ms,
 * G02 §7 / S03 §4) on the given events and, if `refetchOnFocus`, when the screen
 * regains focus. Older results never overwrite newer ones.
 */
export function useLoad<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  opts: { events?: Filter; refetchOnFocus?: boolean; debounceMs?: number; onFocusReload?: () => void } = {},
): Loaded<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const d = await fnRef.current();
      if (mounted.current && my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (mounted.current && my === seq.current) {
        setError(e);
      }
    } finally {
      if (mounted.current && my === seq.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const events = opts.events;
  const debounceMs = opts.debounceMs ?? 300;
  const eventKey = events ? Object.keys(events).join(',') : '';
  const eventsRef = useRef(events);
  eventsRef.current = events;
  useEffect(() => {
    if (!eventKey) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        reload();
      }, debounceMs);
    };
    const offs = (eventKey.split(',') as EventName[]).map(name =>
      on(name, ((p: never) => {
        const f = eventsRef.current?.[name] as ((x: never) => boolean) | undefined;
        if (!f || f(p)) {
          schedule();
        }
      }) as never),
    );
    return () => {
      offs.forEach(off => off());
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [eventKey, debounceMs, reload]);

  const first = useRef(true);
  const refetchOnFocus = !!opts.refetchOnFocus;
  const onFocusReload = useRef(opts.onFocusReload);
  onFocusReload.current = opts.onFocusReload;
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      if (refetchOnFocus) {
        reload();
        onFocusReload.current?.();
      }
    }, [refetchOnFocus, reload]),
  );

  return { data, error, loading: loading && data === undefined, reload, setData };
}

/**
 * D04 guard for stack screens (G01 §1): intercepts back button, swipe and the
 * Android back key while `dirty`. Returns `leave(action)` to skip the guard after
 * a successful save.
 */
export function useDirtyGuard(dirty: boolean, copy?: DiscardCopy) {
  const navigation = useNavigation();
  const bypass = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const copyRef = useRef(copy);
  copyRef.current = copy;

  useEffect(
    () =>
      navigation.addListener('beforeRemove', e => {
        if (bypass.current || !dirtyRef.current) {
          return;
        }
        e.preventDefault();
        confirmDiscard(copyRef.current).then(discard => {
          if (discard) {
            bypass.current = true;
            navigation.dispatch(e.data.action);
          }
        });
      }),
    [navigation],
  );

  /** Run navigation without the guard (after saving or deleting). */
  return useCallback((go: () => void) => {
    bypass.current = true;
    go();
  }, []);
}

/** Latest value in a ref, for callbacks registered once. */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}
