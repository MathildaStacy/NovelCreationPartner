/**
 * @format
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import { openMemoryDb } from '../src/data/drivers/nodeSqlite';

const flush = () => new Promise<void>(r => setTimeout(r, 0));

async function textOf(tree: ReactTestRenderer.ReactTestRenderer): Promise<string> {
  const out: string[] = [];
  const walk = (n: ReactTestRenderer.ReactTestRendererJSON | ReactTestRenderer.ReactTestRendererJSON[] | string | null) => {
    if (n == null) {
      return;
    }
    if (typeof n === 'string') {
      out.push(n);
    } else if (Array.isArray(n)) {
      n.forEach(walk);
    } else {
      (n.children ?? []).forEach(c => walk(c as never));
    }
  };
  walk(tree.toJSON() as never);
  return out.join('');
}

test('boots into welcome on first install', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App openDatabase={openMemoryDb} />);
  });
  for (let i = 0; i < 20 && !(await textOf(tree)).includes('开始创作'); i++) {
    await ReactTestRenderer.act(flush);
  }
  const text = await textOf(tree);
  expect(text).toContain('开始创作');
  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows the upgrade error page when migration fails', async () => {
  const broken = () => {
    const d = openMemoryDb();
    return {
      ...d,
      async get() {
        return { user_version: 99 } as never;
      },
    };
  };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App openDatabase={broken} />);
  });
  for (let i = 0; i < 20 && !(await textOf(tree)).includes('数据升级失败'); i++) {
    await ReactTestRenderer.act(flush);
  }
  expect(await textOf(tree)).toContain('数据升级失败');
  await ReactTestRenderer.act(async () => tree.unmount());
});
