/** Screen test helpers: boot the real App on an in-memory database and poke it by text / label. */
import React from 'react';
import ReactTestRenderer, { act, type ReactTestInstance, type ReactTestRenderer as Renderer } from 'react-test-renderer';
import App from '../../App';
import type { Db } from '../../src/data/db';
import { migrate } from '../../src/data/migrations';
import { useOverlay } from '../../src/components/overlay/store';

export const flush = () => act(() => new Promise<void>(r => setTimeout(r, 0)));

/** Advance real time a little (debounces are 300 ms). */
export const wait = (ms: number) => act(() => new Promise<void>(r => setTimeout(r, ms)));

export function allText(r: Renderer): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) {
      return;
    }
    if (typeof n === 'string') {
      out.push(n);
    } else if (Array.isArray(n)) {
      n.forEach(walk);
    } else {
      ((n as { children?: unknown[] }).children ?? []).forEach(walk);
    }
  };
  walk(r.toJSON());
  return out.join('\n');
}

export async function until(r: Renderer, pred: (text: string) => boolean, tries = 40): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const text = allText(r);
    if (pred(text)) {
      return text;
    }
    await wait(25);
  }
  throw new Error(`condition not met; screen text:\n${allText(r)}`);
}

export async function renderApp(d: Db): Promise<Renderer> {
  await migrate(d);
  await d.run('INSERT OR REPLACE INTO preferences (key,value) VALUES (?,?)', ['onboardingDone', 'true']);
  useOverlay.setState({ toast: null, dialogs: [], depth: 0 });
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(<App openDatabase={() => d} />);
  });
  await flush();
  return r;
}

const textOfNode = (n: ReactTestInstance): string =>
  n.children.map(c => (typeof c === 'string' ? c : textOfNode(c))).join('');

/** The nearest pressable (has onPress) whose label or text equals / contains `label`. */
export function pressable(r: Renderer, label: string | RegExp, which: 'onPress' | 'onLongPress' = 'onPress'): ReactTestInstance {
  const match = (s: string | undefined) =>
    s != null && (typeof label === 'string' ? s === label : label.test(s));
  const found = r.root.findAll(
    n =>
      typeof n.type !== 'string' &&
      typeof n.props[which] === 'function' &&
      (match(n.props.accessibilityLabel) || match(textOfNode(n))),
  );
  if (!found.length) {
    throw new Error(`no pressable "${label}"; screen text:\n${allText(r)}`);
  }
  return found[found.length - 1];
}

export async function press(r: Renderer, label: string | RegExp, which: 'onPress' | 'onLongPress' = 'onPress') {
  const n = pressable(r, label, which);
  await act(async () => {
    n.props[which]();
  });
  await flush();
}

export async function typeInto(r: Renderer, placeholder: string, text: string) {
  const input = r.root.findAll(n => n.props.placeholder === placeholder && typeof n.props.onChangeText === 'function');
  if (!input.length) {
    throw new Error(`no input "${placeholder}"`);
  }
  await act(async () => {
    input[0].props.onChangeText(text);
  });
  await flush();
}
