import { freshDb } from '../helpers/db';
import * as covers from '../../src/features/covers';
import * as works from '../../src/features/works';
import * as trash from '../../src/features/trash';
import { on } from '../../src/features/events';
import type { Db } from '../../src/data/db';

const one = '11111111-1111-4111-8111-111111111111';
const two = '22222222-2222-4222-8222-222222222222';
const asset = (token: string) => ({ token, uri: `file:///private/novel/covers/${token}.jpg` });
let d: Db;
let driver: covers.CoverStoreDriver;
beforeEach(async () => {
  d = await freshDb();
  driver = { pick: jest.fn(async () => JSON.stringify(asset(one))), importImage: jest.fn(async () => JSON.stringify(asset(two))),
    read: jest.fn(async () => JSON.stringify({ base64: '/9j/2Q==', mimeType: 'image/jpeg' })), remove: jest.fn(async () => {}), prune: jest.fn(async () => {}) };
  covers.setCoverStoreDriver(driver);
});
afterEach(async () => { covers.setCoverStoreDriver(undefined); jest.restoreAllMocks(); await d.close(); });
async function work() { return works.create({ title: '归潮', premise: '海边的故事' }); }

test('picker cancellation and read errors preserve the original cover and never emit a mutation', async () => {
  const w = await work(); await works.setCover(w.id, { kind: 'image' });
  const event = jest.fn(); on('work.updated', event);
  (driver.pick as jest.Mock).mockResolvedValueOnce(null);
  expect(await works.setCover(w.id, { kind: 'image' })).toBe(false);
  (driver.pick as jest.Mock).mockRejectedValueOnce({ code: 'COVER_LARGE' });
  await expect(works.setCover(w.id, { kind: 'image' })).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('30 MB') });
  expect((await works.get(w.id)).cover).toEqual({ kind: 'image', path: asset(one).uri });
  expect(event).not.toHaveBeenCalled(); expect(driver.remove).not.toHaveBeenCalled();
});

test('failed reference transaction retains old bytes and safely recycles only the new immutable asset', async () => {
  const w = await work(); await works.setCover(w.id, { kind: 'image' });
  (driver.pick as jest.Mock).mockResolvedValueOnce(JSON.stringify(asset(two)));
  await d.run(`CREATE TRIGGER cover_write_failure BEFORE UPDATE OF cover_token ON works BEGIN SELECT RAISE(ABORT,'cover failure'); END`);
  await expect(works.setCover(w.id, { kind: 'image' })).rejects.toThrow('cover failure');
  expect((await works.get(w.id)).cover).toEqual({ kind: 'image', path: asset(one).uri });
  expect(driver.remove).toHaveBeenCalledWith(two); expect(driver.remove).not.toHaveBeenCalledWith(one);
  expect(await d.all('SELECT token FROM cover_assets')).toEqual([{ token: one }]);
});

test('reference commits before events and deletion failure persists a retry without rolling back the new cover', async () => {
  const w = await work(); await works.setCover(w.id, { kind: 'image' });
  (driver.pick as jest.Mock).mockResolvedValueOnce(JSON.stringify(asset(two)));
  (driver.remove as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
  const observed: Promise<unknown>[] = [];
  on('work.updated', () => { observed.push(d.get('SELECT cover_token FROM works WHERE id=?', [w.id])); });
  await works.setCover(w.id, { kind: 'image' });
  expect(await Promise.all(observed)).toEqual([{ cover_token: two }]);
  expect(await d.all('SELECT * FROM cover_cleanup')).toEqual([{ token: one }]);
  await covers.retryCleanup();
  expect(await d.all('SELECT * FROM cover_cleanup')).toEqual([]);
  await works.setCover(w.id, { kind: 'text' });
  expect((await works.get(w.id)).cover).toEqual({ kind: 'text' });
  expect(driver.remove).toHaveBeenCalledWith(two);
  expect(await d.all('SELECT * FROM cover_assets')).toHaveLength(0);
});

test('soft-delete preserves cover ownership; permanent deletion queues and removes only the owned image', async () => {
  const w = await work(); await works.setCover(w.id, { kind: 'image' }); await works.remove(w.id);
  expect(driver.remove).not.toHaveBeenCalled();
  await trash.restore('work', w.id); expect((await works.get(w.id)).cover).toEqual({ kind: 'image', path: asset(one).uri });
  await works.remove(w.id); await trash.purge('work', w.id);
  expect(driver.remove).toHaveBeenCalledWith(one); expect(await d.all('SELECT * FROM cover_assets')).toHaveLength(0);
});

test('content facade rejects paths, oversized sources and bound-image deletion', async () => {
  const w = await work(); await works.setCover(w.id, { kind: 'image' });
  await expect(covers.readCover('../private')).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(covers.removeCover(one)).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  await expect(covers.importCover({ base64: 'not base64', mimeType: 'image/jpeg' })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(covers.importCover({ base64: 'A'.repeat(Math.ceil(covers.MAX_COVER_BYTES / 3) * 4 + 4), mimeType: 'image/jpeg' })).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(await covers.readCover(one)).toEqual({ base64: '/9j/2Q==', mimeType: 'image/jpeg' });
  expect(await covers.importCover({ base64: '/9j/2Q==', mimeType: 'image/jpeg' })).toEqual(asset(two));
  await covers.removeCover(two); expect(driver.remove).toHaveBeenCalledWith(two);
});

test('deleted work during system selection cannot be updated and the prepared file is recycled', async () => {
  const w = await work();
  (driver.pick as jest.Mock).mockImplementationOnce(async () => { await works.remove(w.id); return JSON.stringify(asset(one)); });
  await expect(works.setCover(w.id, { kind: 'image' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(driver.remove).toHaveBeenCalledWith(one);
  expect(await d.all('SELECT * FROM cover_assets')).toHaveLength(0);
});
