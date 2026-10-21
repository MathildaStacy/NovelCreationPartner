/**
 * Fixed-case retrieval evaluation (history passages). Deterministic and model-free: it
 * measures whether the evidence a conflict check needs is actually in the context, which
 * bounds what any model can report. "before" is the pre-retrieval context (archive only,
 * no history prose); "prefetch" is phase 1; "tool" adds one targeted search_passages call
 * as phase 2 would. Run with EVAL_PRINT=1 to print the table.
 *
 * Per case: `need` = passages that must be visible (injury, and the recovery when there is
 * one: missing it risks a false positive); `forbid` = passages that must never appear
 * (later chapters, other works).
 */
import { db, setDb } from '../../src/data/db';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import { PassageSession, prefetchPassages, scopeBefore, searchPassages } from '../../src/features/passages';
import { extractKeywords } from '../../src/ai/retrieval/keywords';
import { FINALIZATION_HISTORY_LIMITS } from '../../src/features/finalizationPlans';
import { freshDb, tickingClock } from '../helpers/db';

beforeEach(async () => { tickingClock(); await freshDb(); });
afterEach(async () => { await db().close(); setDb(null); });

const pad = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i}。`).join('');
interface Case {
  name: string;
  /** Earlier chapters (reading order), then the analysed chapter, then optional later chapters. */
  before: string[];
  current: string;
  after?: string[];
  entities: { name: string; aliases?: string[] }[];
  need: string[];
  forbid?: string[];
  /** What a model would search for in phase 2. */
  search: { entities: string[]; keywords: string[] };
  conflict: boolean;
}
const CASES: Case[] = [
  { name: '伤势只在历史正文', before: ['林舟拜师。', `${pad(15, '赶路')}\n林舟左手受伤，无法握剑。`], current: '林舟双手握剑，冲向敌阵。', entities: [{ name: '林舟' }],
    need: ['左手受伤'], search: { entities: ['林舟'], keywords: ['左手', '受伤'] }, conflict: true },
  { name: '后文已交代恢复', before: [`林舟左手受伤，无法握剑。\n${pad(6, '养伤')}`, pad(10, '行军'), `${pad(4, '晨练')}\n林舟的左手已经痊愈。`], current: '林舟双手握剑，冲向敌阵。', entities: [{ name: '林舟' }],
    need: ['左手受伤', '痊愈'], search: { entities: ['林舟'], keywords: ['痊愈', '恢复'] }, conflict: false },
  { name: '别名关联同一实体', before: [`${pad(8, '雨夜')}\n阿舟左手受伤，无法握剑。`], current: '林舟双手握剑。', entities: [{ name: '林舟', aliases: ['阿舟'] }],
    need: ['阿舟左手受伤'], search: { entities: ['林舟'], keywords: ['左手'] }, conflict: true },
  { name: '很早的重要片段', before: ['林舟左手受伤，无法握剑。', ...Array.from({ length: 14 }, (_, i) => `${pad(3, `集市${i}`)}\n林舟买了些干粮${i}。`)], current: '林舟双手握剑。', entities: [{ name: '林舟' }],
    need: ['左手受伤'], search: { entities: ['林舟'], keywords: ['左手', '受伤'] }, conflict: true },
  { name: '受伤段只用代词', before: ['林舟拜师。', `${pad(10, '夜战')}\n那一战后，他的左手受伤，再也握不住剑。`], current: '林舟双手握剑。', entities: [{ name: '林舟' }],
    need: ['他的左手受伤'], search: { entities: ['林舟'], keywords: ['左手', '受伤'] }, conflict: true },
  { name: '信物已丢失', before: [`${pad(6, '渡河')}\n林舟的玉佩在河里丢失了。`], current: '林舟摸出玉佩，递给守卫。', entities: [{ name: '林舟' }],
    need: ['玉佩在河里丢失'], search: { entities: ['林舟'], keywords: ['玉佩', '丢失'] }, conflict: true },
  { name: '人物已去世（无线索词）', before: [`${pad(6, '下山')}\n师父在山洞里去世了。`], current: '师父笑着朝林舟走来。', entities: [{ name: '林舟' }, { name: '师父' }],
    need: ['师父在山洞里去世'], search: { entities: ['师父'], keywords: ['去世', '死'] }, conflict: true },
  { name: '后文与他作品不得混入', before: ['林舟拜师。'], current: '林舟双手握剑。', after: ['林舟左手被斩断，再也不能握剑。'], entities: [{ name: '林舟' }],
    need: [], forbid: ['斩断', '外书伤势'], search: { entities: ['林舟'], keywords: ['左手', '斩断', '受伤'] }, conflict: false },
];

async function build(c: Case) {
  const work = await works.create({ title: c.name, premise: '评测' });
  const volume = (await chapters.list(work.id))[0].volume;
  const ids: string[] = [];
  for (const [i, body] of [...c.before, c.current, ...(c.after ?? [])].entries()) {
    const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, kind: 'main', title: `章${i + 1}` });
    await chapters.saveBody(chapter.id, body, 0);
    ids.push(chapter.id);
  }
  const made = [];
  for (const entity of c.entities) made.push(await entries.create({ workId: work.id, type: 'character', name: entity.name, aliases: entity.aliases ?? [] }));
  if (c.forbid?.includes('外书伤势')) {
    const other = await works.create({ title: `${c.name}-外`, premise: '另一本' });
    const chapter = await chapters.create({ workId: other.id, volumeId: (await chapters.list(other.id))[0].volume.id, kind: 'main', title: '外' });
    await chapters.saveBody(chapter.id, '林舟左手受伤（外书伤势）。', 0);
    await entries.create({ workId: other.id, type: 'character', name: '林舟' });
  }
  return { work, current: ids[c.before.length], entryIds: made.filter(e => c.current.includes(e.name)).map(e => e.id) };
}
const covers = (texts: string[], need: string[]) => need.every(quote => texts.some(text => text.includes(quote)));
const leaks = (texts: string[], forbid: string[] = []) => forbid.some(quote => texts.some(text => text.includes(quote)));

test('fixed cases: evidence coverage before vs. after history retrieval', async () => {
  const rows: { name: string; conflict: boolean; before: boolean; prefetch: boolean; tool: boolean; leak: boolean }[] = [];
  for (const c of CASES) {
    const built = await build(c);
    const session = PassageSession.create(await scopeBefore(db(), built.work.id, built.current));
    const prefetch = (await prefetchPassages(session, { entryIds: built.entryIds, keywords: extractKeywords(c.current), queryText: c.current }, FINALIZATION_HISTORY_LIMITS)).map(hit => hit.text);
    const tool = (await searchPassages(session, { entryIds: c.search.entities, keywords: c.search.keywords, limit: 4 })).passages.map(hit => hit.text);
    rows.push({ name: c.name, conflict: c.conflict, before: covers([], c.need), prefetch: covers(prefetch, c.need), tool: covers([...prefetch, ...tool], c.need), leak: leaks([...prefetch, ...tool], c.forbid) });
  }
  if (process.env.EVAL_PRINT) {
    console.log(['| 案例 | 有冲突 | 改动前证据可见 | 预取后 | 预取+一次补查 | 越界 |', '|---|---|---|---|---|---|',
      ...rows.map(r => `| ${r.name} | ${r.conflict ? '是' : '否'} | ${r.before ? '✓' : '✗'} | ${r.prefetch ? '✓' : '✗'} | ${r.tool ? '✓' : '✗'} | ${r.leak ? '✗ 越界' : '无'} |`)].join('\n'));
  }
  const count = (key: 'before' | 'prefetch' | 'tool') => rows.filter(r => r[key]).length;
  // No case may leak later chapters or another work into the context.
  expect(rows.some(r => r.leak)).toBe(false);
  // Before retrieval, history-only evidence is never visible (cases with nothing to need trivially pass).
  expect(count('before')).toBe(rows.filter(r => !CASES.find(c => c.name === r.name)!.need.length).length);
  // Known, accepted limit of rule-based prefetch: a state with no cue word in the analysed text
  // (a pronoun-only passage still passes on strong keyword overlap).
  expect(rows.filter(r => !r.prefetch).map(r => r.name)).toEqual(['人物已去世（无线索词）']);
  // One targeted search (phase 2) recovers it.
  expect(rows.every(r => r.tool)).toBe(true);
});
