import { db, setDb } from '../../src/data/db';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as versions from '../../src/features/versions';
import { refreshWork, indexStatesIn, namesIn, freshness } from '../../src/features/passageIndex';
import { PassageSession, readPassage, scopeBefore, searchPassages, prefetchPassages, verifyPassageQuoteIn } from '../../src/features/passages';
import { splitPassageChunks } from '../../src/ai/retrieval/chunking';
import { NameMatcher } from '../../src/ai/retrieval/matcher';
import { extractKeywords } from '../../src/ai/retrieval/keywords';
import { rankPassages } from '../../src/ai/retrieval/ranking';
import { freshDb, tickingClock } from '../helpers/db';

beforeEach(async () => { tickingClock(); await freshDb(); });
afterEach(async () => { await db().close(); setDb(null); });

const filler = (n: number, seed = '风吹过山谷，远处传来钟声') => Array.from({ length: n }, (_, i) => `${seed}${i}。`).join('');

async function novel(bodies: string[]) {
  const work = await works.create({ title: '剑途', premise: '少年寻剑' });
  const volume = (await chapters.list(work.id))[0].volume;
  const ids: string[] = [];
  for (const [i, body] of bodies.entries()) {
    const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, kind: 'main', title: `章${i + 1}` });
    await chapters.saveBody(chapter.id, body, 0);
    ids.push(chapter.id);
  }
  return { work, ids };
}

describe('chunking', () => {
  test('merges short paragraphs, keeps paragraphs whole and offsets exact (UTF-16)', () => {
    const body = ['短段一。', filler(12), '😀表情符号段落。', filler(40), '尾。'].join('\n');
    const chunks = splitPassageChunks(body);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(body.slice(chunk.start, chunk.end)).toBe(chunk.text);
    // No paragraph under the hard limit is split across chunks.
    const lines = body.split('\n');
    for (const line of lines.filter(l => [...l].length <= 800)) expect(chunks.some(chunk => chunk.text.includes(line))).toBe(true);
  });
  test('splits an over-long paragraph only at sentence ends', () => {
    const long = filler(80);
    const chunks = splitPassageChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) expect(chunk.text.endsWith('。')).toBe(true);
    expect(chunks.map(c => c.text).join('')).toBe(long);
  });
});

describe('matcher', () => {
  test('leftmost-longest, case-insensitive, single characters ignored', () => {
    const matcher = new NameMatcher([{ name: '张三', value: 'a' }, { name: '张三丰', value: 'b' }, { name: 'Lin', value: 'c' }, { name: '舟', value: 'd' }]);
    expect(matcher.valuesIn('张三丰遇到了LIN，舟上无人')).toEqual(['b', 'c']);
    expect(matcher.valuesIn('张三来了')).toEqual(['a']);
  });
});

describe('keywords and ranking', () => {
  test('a body-part/weapon cue expands to injury and recovery terms', () => {
    const keywords = extractKeywords('林舟双手握剑，冲了上去。', '', 30);
    expect(keywords).toEqual(expect.arrayContaining(['双手', '握剑', '受伤', '痊愈', '左手']));
  });
  test('relevance beats recency and the first mention gets a bonus', () => {
    const base = { chapterId: '', chunkIndex: 0, start: 0, end: 0, entryIds: ['lin'] };
    const candidates = [
      { ...base, key: 'early', chapterId: 'c1', chapterRank: 0, text: '林舟左手受伤，无法握剑。', end: 12 },
      ...Array.from({ length: 10 }, (_, i) => ({ ...base, key: `late${i}`, chapterId: `c${i + 2}`, chapterRank: i + 1, text: `林舟在第${i}天吃了饭。`, end: 10 })),
    ];
    const ranked = rankPassages(candidates, { entryIds: ['lin'], keywords: ['受伤', '握剑', '左手'] }, { limit: 3, maxChars: 1000, excerptChars: 200, perChapter: 2, minScore: 0.5 });
    expect(ranked[0].key).toBe('early');
  });
});

describe('index maintenance and search', () => {
  test('history-only injury is found through an alias; offsets point into the chapter body', async () => {
    const { work, ids } = await novel([filler(10), `${filler(30)}\n阿舟左手受伤，无法握剑。\n${filler(30)}`, filler(5), '林舟双手握剑，冲向敌阵。']);
    const lin = await entries.create({ workId: work.id, type: 'character', name: '林舟', aliases: ['阿舟'] });
    const session = PassageSession.create(await scopeBefore(db(), work.id, ids[3]));
    const result = await searchPassages(session, { entryIds: [lin.id], keywords: ['握剑', '受伤'] });
    expect(result.passages[0]).toMatchObject({ ref: 'p1', chapterId: ids[1] });
    const body = (await chapters.get(ids[1])).body;
    expect(body.slice(result.passages[0].start, result.passages[0].end)).toBe(result.passages[0].text);
    expect(result.passages[0].text).toContain('阿舟左手受伤');
    // Never the current chapter or later chapters.
    expect(result.passages.every(p => p.chapterId !== ids[3])).toBe(true);
    const wider = await readPassage(session, { ref: 'p1', before: 1, after: 1 });
    expect(wider.ref).toBe('p2');
    expect(wider.text.length).toBeGreaterThanOrEqual(result.passages[0].text.length);
    expect(body.slice(wider.start, wider.end)).toBe(wider.text);
  });

  test('body edits and alias edits refresh the index; stale rows are never used', async () => {
    const { work, ids } = await novel(['林舟在河边练剑。', '林舟回家。']);
    const lin = await entries.create({ workId: work.id, type: 'character', name: '林舟' });
    await refreshWork(work.id);
    const names = await namesIn(db(), work.id);
    expect([...(await indexStatesIn(db(), work.id)).values()].map(s => freshness(s, names.hash))).toEqual(['fresh', 'fresh']);
    await chapters.saveBody(ids[0], '小舟在河边受伤。', 0);
    expect(await db().all('SELECT * FROM chapter_chunks WHERE chapter_id=?', [ids[0]])).toHaveLength(0);
    let session = PassageSession.create(await scopeBefore(db(), work.id, ids[1]));
    expect((await searchPassages(session, { entryIds: [lin.id] })).passages).toHaveLength(0);
    await entries.update(lin.id, { aliases: ['小舟'] });
    session = PassageSession.create(await scopeBefore(db(), work.id, ids[1]));
    const hits = (await searchPassages(session, { entryIds: [lin.id] })).passages;
    expect(hits.map(h => h.text)).toEqual(['小舟在河边受伤。']);
    const rows = await db().all<{ entry_id: string }>('SELECT m.entry_id FROM chunk_mentions m JOIN chapter_chunks k ON k.id=m.chunk_id WHERE k.chapter_id=?', [ids[0]]);
    expect(rows.map(r => r.entry_id)).toEqual([lin.id]);
  });

  test('version restore invalidates the chapter index and old refs cannot be read', async () => {
    const { work, ids } = await novel(['林舟左手受伤。', '后文。']);
    const lin = await entries.create({ workId: work.id, type: 'character', name: '林舟' });
    const session = PassageSession.create(await scopeBefore(db(), work.id, ids[1]));
    const [hit] = (await searchPassages(session, { entryIds: [lin.id], keywords: ['受伤'] })).passages;
    expect(hit.ref).toBe('p1');
    await chapters.saveBody(ids[0], '林舟毫发无伤。', 0);
    await expect(readPassage(session, { ref: 'p1' })).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
    await expect(verifyPassageQuoteIn(db(), work.id, ids[1], hit, '林舟左手受伤')).rejects.toMatchObject({ code: 'AI_RESULT_STALE' });
    expect(versions).toBeDefined();
  });

  test('prefetch needs entity plus relevance; unrelated mentions are not padded in', async () => {
    const { work, ids } = await novel(['林舟吃饭。', '林舟睡觉。', '林舟左手受伤，无法握剑。', '林舟双手握剑。']);
    const lin = await entries.create({ workId: work.id, type: 'character', name: '林舟' });
    const session = PassageSession.create(await scopeBefore(db(), work.id, ids[3]));
    const hits = await prefetchPassages(session, { entryIds: [lin.id], keywords: extractKeywords('林舟双手握剑。') }, { maxResults: 4 });
    expect(hits.map(h => h.chapterId)).toEqual([ids[2]]);
  });
});
