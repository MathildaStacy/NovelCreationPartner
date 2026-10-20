import { freshDb, tickingClock } from '../helpers/db';
import type { Db } from '../../src/data/db';
import { createSlots, foregroundSlots } from '../../src/ai/runtime/slots';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as services from '../../src/features/modelServices';
import * as ai from '../../src/features/ai';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';

jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'test-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('at most three slots are held; waiters start first-in first-out', async () => {
  const slots = createSlots(3);
  const signal = new AbortController().signal;
  const two = await slots.acquire(2, signal);
  const one = await slots.acquire(1, signal);
  expect(slots.active).toBe(3);
  const order: string[] = [];
  const queued = jest.fn();
  const big = slots.acquire(3, signal, queued).then(release => { order.push('big'); return release; });
  // A later small request does not overtake the waiting one.
  const small = slots.acquire(1, signal).then(release => { order.push('small'); return release; });
  await flush();
  expect(queued).toHaveBeenCalledTimes(1);
  expect(slots.waiting).toBe(2);
  one();
  one(); // idempotent
  await flush();
  expect(order).toEqual([]);
  two();
  const releaseBig = await big;
  expect(order).toEqual(['big']);
  expect(slots.active).toBe(3);
  releaseBig();
  (await small)();
  expect(order).toEqual(['big', 'small']);
  expect(slots.active).toBe(0);
});

test('aborting a waiter rejects it without taking a slot and lets the next one start', async () => {
  const slots = createSlots(3);
  const hold = await slots.acquire(3, new AbortController().signal);
  const first = new AbortController();
  const waiting = slots.acquire(3, first.signal);
  const next = slots.acquire(1, new AbortController().signal);
  await flush();
  first.abort();
  await expect(waiting).rejects.toMatchObject({ code: 'AI_CANCELLED' });
  expect(slots.waiting).toBe(1);
  hold();
  (await next)();
  expect(slots.active).toBe(0);
  const done = new AbortController();
  done.abort();
  await expect(slots.acquire(1, done.signal)).rejects.toMatchObject({ code: 'AI_CANCELLED' });
});

test('requests are clamped to the limit, and an immediate grant never reports queued', async () => {
  const slots = createSlots(3);
  const queued = jest.fn();
  const release = await slots.acquire(5, new AbortController().signal, queued);
  expect(slots.active).toBe(3);
  expect(queued).not.toHaveBeenCalled();
  release();
});

describe('generateWriting', () => {
  let d: Db;
  beforeEach(async () => { tickingClock(); d = await freshDb(); });
  afterEach(async () => { await d.close(); });

  test('waits for a foreground slot before any budget or attempt, and a stop while queued sends nothing', async () => {
    const w = await works.create({ premise: '海上寻镜', title: '潮汐' });
    const volume = (await chapters.list(w.id))[0].volume;
    const ch = await chapters.create({ workId: w.id, volumeId: volume.id, title: '起点', kind: 'main' });
    await chapters.saveBody(ch.id, '林宇握紧古镜。', 0);
    await services.save({ name: 'Fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'test-model', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'test-key');
    await ai.acknowledgeHost('example.test');
    const plan = await ai.prepareWriting({ chapterId: ch.id, range: { start: 7, end: 7 }, task: 'describe', count: 1 });
    // Three other versions are generating.
    const others = await foregroundSlots.acquire(3, new AbortController().signal);
    const stop = new AbortController();
    const onQueued = jest.fn();
    const onStarted = jest.fn();
    const pending = ai.generateWriting(plan, { signal: stop.signal, onQueued, onStarted });
    for (let i = 0; i < 20 && !onQueued.mock.calls.length; i++) await flush();
    expect(onQueued).toHaveBeenCalledTimes(1);
    expect(foregroundSlots.waiting).toBe(1);
    stop.abort();
    await expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect(onStarted).not.toHaveBeenCalled();
    expect(await d.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_requests')).toEqual({ n: 0 });
    expect(await d.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_attempts')).toEqual({ n: 0 });
    others();
    expect(foregroundSlots.active).toBe(0);
    expect(foregroundSlots.waiting).toBe(0);
  });
});
