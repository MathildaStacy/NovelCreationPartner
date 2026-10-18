import { db, setDb } from '../../src/data/db';
import { freshDb, tickingClock } from '../helpers/db';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as models from '../../src/features/modelServices';
import * as entries from '../../src/features/entries';
import * as relations from '../../src/features/relations';
import { previewFinalization } from '../../src/features/finalizationPlans';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';

jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'fixture-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));
beforeEach(async () => { tickingClock(); await freshDb(); });
afterEach(async () => { jest.restoreAllMocks(); await db().close(); setDb(null); });

test('a work edit queued at the first metadata read cannot bind old premise text to the new dependency revision', async () => {
  const work = await works.create({ title: '旧书名', premise: '寻找遗失的钥匙' });
  const volume = (await chapters.list(work.id))[0].volume;
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, title: '出发' });
  await chapters.saveBody(chapter.id, '林宇登上了驶往远海的船。', 0);
  await models.save({ name: 'Fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'test', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'fixture-key');
  const read = works.get;
  let changed: ReturnType<typeof works.update> | undefined;
  jest.spyOn(works, 'get').mockImplementationOnce(async (...args) => {
    const old = await read(...args);
    // Queue a real competing author write; do not await it while the read transaction owns the lock.
    changed = works.update(work.id, { title: '新书名', premise: '守护最后的灯塔' });
    return old;
  });
  await expect(previewFinalization(chapter.id)).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
  expect(changed).toBeDefined(); await changed;
  expect((await works.get(work.id)).premise).toBe('守护最后的灯塔');
  expect(await db().all('SELECT id FROM finalization_plans')).toEqual([]);
  expect(await db().all('SELECT id FROM ai_attempts')).toEqual([]);
});

test('finalization excludes relationships with retired or proposed endpoints from required facts and entity expansion', async () => {
  const work = await works.create({ premise: '航海寻找灯塔' });
  const volume = (await chapters.list(work.id))[0].volume;
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, title: '登船' });
  await chapters.saveBody(chapter.id, '林宇站在船头。', 0);
  await models.save({ name: 'Fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'test', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'fixture-key');
  const lead = await entries.create({ workId: work.id, type: 'character', name: '林宇' });
  const peer = await entries.create({ workId: work.id, type: 'character', name: '沈青' });
  const retired = await entries.create({ workId: work.id, type: 'character', name: '已废弃的船长' });
  const proposed = await entries.create({ workId: work.id, type: 'character', name: '尚未确认的旅人' });
  const active = await relations.upsert({ fromEntryId: lead.id, toEntryId: peer.id, kind: '信任', note: '只向沈青交付钥匙' });
  const retiredRelation = await relations.upsert({ fromEntryId: retired.id, toEntryId: lead.id, kind: '保护' });
  const proposedRelation = await relations.upsert({ fromEntryId: lead.id, toEntryId: proposed.id, kind: '认识' });
  await entries.retire(retired.id);
  await db().run("UPDATE entries SET state='PROPOSED' WHERE id=?", [proposed.id]);
  const preview = await previewFinalization(chapter.id, { kinds: ['extract_memory', 'detect_conflicts'] });
  expect(preview.eligible).toBe(true);
  for (const task of preview.tasks) {
    for (const chunk of task.chunks) {
      expect(chunk.contextPlan.blocks.find(block => block.sourceId === `relation:${active.id}`)).toMatchObject({ required: true, text: '林宇 —信任→ 沈青：只向沈青交付钥匙' });
      for (const id of [retiredRelation.id, proposedRelation.id]) {
        expect(chunk.contextPlan.blocks.find(block => block.sourceId === `relation:${id}`)).toBeUndefined();
        expect(chunk.sources.find(source => source.id === `relation:${id}`)).toBeUndefined();
      }
      const sentDirectory = chunk.contextPlan.blocks.find(block => block.sourceId === 'entry-directory')?.text;
      expect(sentDirectory).toContain(peer.name);
      expect(sentDirectory).not.toContain(retired.name);
      expect(sentDirectory).not.toContain(proposed.name);
    }
  }
  expect(await db().all('SELECT id FROM ai_attempts')).toEqual([]);
});
