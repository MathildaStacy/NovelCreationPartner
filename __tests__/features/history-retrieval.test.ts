/**
 * History passage retrieval end to end: program prefetch, durable evidence, the bounded
 * tool loop of the conflict check (OpenAI Responses and Anthropic Messages), budgets,
 * fallback, stale sources, cancel/resume and scope. Acceptance cases 1–8 of the
 * retrieval brief are marked [A1]…[A8].
 */
import { db, setDb } from '../../src/data/db';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as services from '../../src/features/modelServices';
import * as jobs from '../../src/features/jobs';
import * as runner from '../../src/features/finalizationRunner';
import * as prefs from '../../src/features/prefs';
import * as conflicts from '../../src/features/conflicts';
import * as ai from '../../src/features/ai';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { createProvider } from '../../src/ai/providers/httpProvider';
import { TransportFailure, type HttpRequest, type HttpTransport } from '../../src/ai/transport/native';
import { fingerprint } from '../../src/ai/context';
import { previewFinalization } from '../../src/features/finalizationPlans';
import { PassageSession, prefetchPassages, scopeBefore, searchPassages } from '../../src/features/passages';
import { extractKeywords } from '../../src/ai/retrieval/keywords';
import { freshDb, tickingClock } from '../helpers/db';
import type { Protocol } from '../../src/features/types';

jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'fixture-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));
beforeEach(async () => { tickingClock(); await freshDb(); });
afterEach(async () => { jest.restoreAllMocks(); await db().close(); setDb(null); });

const filler = (n: number, seed = '山风穿过竹林，远处有人吹笛') => Array.from({ length: n }, (_, i) => `${seed}${i}。`).join('');
const INJURY = '阿舟左手受伤，无法握剑。';
const CURRENT = '林舟双手握剑，冲向敌阵。';

type Call = { id: string; name: string; args: unknown };
type Reply = { text?: string; calls?: Call[]; error?: { status: number; body: unknown } };
interface Turn { kind: 'summary' | 'extract' | 'conflict'; system: string; payload: Record<string, unknown>; texts: string[]; request: HttpRequest; }

/** All prompt text a request carries: user turns and tool results, in order. */
function texts(protocol: Protocol, payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (protocol === 'openai_responses') {
    for (const item of payload.input as Record<string, unknown>[]) {
      if (typeof item.content === 'string') out.push(item.content);
      if (item.type === 'function_call_output') out.push(String(item.output));
    }
  } else {
    for (const message of payload.messages as { content: unknown }[]) {
      if (typeof message.content === 'string') out.push(message.content);
      else for (const block of message.content as Record<string, unknown>[]) {
        if (block.type === 'text') out.push(String(block.text));
        if (block.type === 'tool_result') out.push(String(block.content));
      }
    }
  }
  return out;
}
/** The temporary ref whose passage text contains `quote` (prefetch block or tool result). */
function refFor(turn: Turn, quote: string): string | null {
  for (const text of turn.texts) {
    for (const match of text.matchAll(/历史正文 (p\d+) [^\n]*\n([\s\S]*?)(?=\n\n|$)/g)) if (match[2].includes(quote)) return match[1];
    for (const match of text.matchAll(/\[(p\d+)\] [^\n]*\n([\s\S]*?)(?=\n\[p\d+\]|\n（其余|$)/g)) if (match[2].includes(quote)) return match[1];
  }
  return null;
}

async function setup(options: { protocol?: Protocol; tools?: boolean; bodies?: string[]; current?: string } = {}) {
  const protocol = options.protocol ?? 'openai_responses';
  const work = await works.create({ title: '剑途', premise: '少年学剑' });
  const volume = (await chapters.list(work.id))[0].volume;
  const bodies = options.bodies ?? ['林舟拜入青云门，师父赠他一柄长剑。', `${filler(20)}\n${INJURY}\n${filler(10)}`];
  const ids: string[] = [];
  for (const [i, body] of [...bodies, options.current ?? CURRENT].entries()) {
    const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, kind: 'main', title: `第${i + 1}回` });
    await chapters.saveBody(chapter.id, body, 0);
    ids.push(chapter.id);
  }
  const lin = await entries.create({ workId: work.id, type: 'character', name: '林舟', aliases: ['阿舟'] });
  const saved = await services.save({ name: 'fixture', protocol, baseUrl: protocol === 'openai_responses' ? 'https://example.test/v1' : 'https://example.test',
    model: 'fixture', options: { ...DEFAULT_OPTIONS, caps: options.tools === false ? { tools: false } : {} } }, 'fixture-key');
  const service = await services.get(saved.service.id);
  await prefs.set('aiNoticeAcknowledged', { 'example.test': new Date().toISOString() });
  const turns: Turn[] = [];
  let conflictScript: (turn: Turn, index: number) => Reply = () => ({ text: JSON.stringify({ conflicts: [] }) });
  let hook: ((turn: Turn) => Promise<void>) | null = null;
  const transport: HttpTransport = async function* (request) {
    const payload = JSON.parse(request.body!) as Record<string, unknown>;
    const system = String(protocol === 'openai_responses' ? payload.instructions : payload.system);
    const kind = system.includes('60–120') ? 'summary' : system.includes('"changes"') ? 'extract' : 'conflict';
    const turn: Turn = { kind, system, payload, texts: texts(protocol, payload), request };
    turns.push(turn);
    await hook?.(turn);
    if (request.signal.aborted) throw new TransportFailure('cancelled');
    const reply: Reply = kind === 'summary' ? { text: '林舟冲向敌阵。' } : kind === 'extract' ? { text: JSON.stringify({ changes: [] }) }
      : conflictScript(turn, turns.filter(t => t.kind === 'conflict').length - 1);
    if (reply.error) {
      yield { type: 'headers', status: reply.error.status, headers: { 'content-type': 'application/json' } };
      const text = JSON.stringify(reply.error.body);
      yield { type: 'data', text, bytes: Buffer.byteLength(text) };
      return;
    }
    const calls = reply.calls ?? [];
    const body = protocol === 'openai_responses'
      ? { object: 'response', status: 'completed', model: 'fixture', usage: { input_tokens: 100, output_tokens: 20 }, output: [
        ...calls.map(call => ({ type: 'function_call', id: `fc_${call.id}`, call_id: call.id, name: call.name, arguments: JSON.stringify(call.args), status: 'completed' })),
        ...(reply.text !== undefined ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply.text }] }] : [])] }
      : { type: 'message', role: 'assistant', model: 'fixture', usage: { input_tokens: 100, output_tokens: 20 }, stop_reason: calls.length ? 'tool_use' : 'end_turn', content: [
        { type: 'thinking', thinking: '先核实伤势。', signature: `sig-${turns.length}` },
        ...(reply.text !== undefined ? [{ type: 'text', text: reply.text }] : []),
        ...calls.map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: call.args }))] };
    yield { type: 'headers', status: 200, headers: { 'content-type': 'application/json' } };
    const text = JSON.stringify(body);
    yield { type: 'data', text, bytes: Buffer.byteLength(text) };
  };
  jest.spyOn(services, 'withGeneration').mockImplementation(async (_id, _revision, signal, callback) => callback({ service, signal,
    providerFactory: (evidence, deadline) => createProvider(service, 'fixture-key', { evidence, deadline, transport }) }));
  const conflictTurns = () => turns.filter(turn => turn.kind === 'conflict');
  return { work, ids, lin, service, turns, conflictTurns, current: ids[ids.length - 1],
    script(next: typeof conflictScript) { conflictScript = next; }, setHook(next: typeof hook) { hook = next; } };
}
const conflictJson = (bRef: string, bQuote: string, extra: Record<string, unknown> = {}, aQuote = '林舟双手握剑', chapterId = '') => JSON.stringify({ conflicts: [{
  type: 'character', severity: 'high', a: { source: `chapter:${chapterId}`, quote: aQuote }, b: { source: bRef, quote: bQuote },
  explanation: '左手受伤无法握剑，此处却双手握剑', suggestions: ['补一句伤势恢复的交代'], ...extra }] });
const conflictJob = async (workId: string) => (await jobs.list(workId)).find(job => job.kind === 'detect_conflicts')!;

describe('phase 1: program prefetch', () => {
  test('[A1][A3][A8] history-only injury reaches the check through an alias and becomes verified, durable evidence', async () => {
    const t = await setup({ tools: false });
    t.script(turn => { const ref = refFor(turn, '左手受伤'); return { text: ref ? conflictJson(ref, '左手受伤，无法握剑', {}, '林舟双手握剑', t.current) : '{"conflicts":[]}' }; });
    await chapters.finalize(t.current);
    await runner.drain(new AbortController().signal);
    expect(t.conflictTurns()).toHaveLength(1);
    // Prefetch-only: no tools offered, the judgement rules are in the prompt.
    expect(t.conflictTurns()[0].payload.tools).toBeUndefined();
    expect(t.conflictTurns()[0].system).toContain('没找到恢复记录不等于证明从未恢复');
    expect((await conflictJob(t.work.id)).status).toBe('done');
    const [row] = await db().all<Record<string, unknown>>('SELECT * FROM conflicts');
    const body = (await chapters.get(t.ids[1])).body;
    expect(row).toMatchObject({ b_ref: `chapter:${t.ids[1]}`, b_quote: '左手受伤，无法握剑', b_offset: body.indexOf('左手受伤，无法握剑'), b_source_hash: fingerprint(body),
      a_ref: `chapter:${t.current}`, a_offset: 0, entry_id: t.lin.id });
    expect(String(row.b_label)).toContain('第2章');
    expect(JSON.parse(String(row.b_anchor))).toEqual({ prefix: body.slice(body.indexOf('左手受伤') - 20, body.indexOf('左手受伤')), suffix: body.slice(body.indexOf('左手受伤，无法握剑') + 9, body.indexOf('左手受伤，无法握剑') + 29) });
    const [view] = await conflicts.list(t.work.id);
    expect(view.history).toEqual({ chapterId: t.ids[1], number: 2, title: '第2回', offset: body.indexOf('左手受伤，无法握剑'), changed: false });
    await chapters.saveBody(t.ids[1], body.replace('左手', '右手'), 0);
    expect((await conflicts.get(view.id)).history?.changed).toBe(true);
  });

  test('[A2] a later recovery is retrieved together with the injury, in narrative order', async () => {
    const t = await setup({ tools: false, bodies: [`${filler(10)}\n${INJURY}`, filler(12, '众人赶路'), `${filler(6)}\n阿舟的左手已经痊愈，又能握剑了。`] });
    const session = PassageSession.create(await scopeBefore(db(), t.work.id, t.current));
    const hits = await prefetchPassages(session, { entryIds: [t.lin.id], keywords: extractKeywords(CURRENT), queryText: CURRENT }, { maxResults: 6, maxChars: 2400, excerptChars: 320 });
    const injury = hits.findIndex(hit => hit.text.includes('左手受伤')), healed = hits.findIndex(hit => hit.text.includes('痊愈'));
    expect(injury).toBeGreaterThanOrEqual(0);
    expect(healed).toBeGreaterThan(injury);
  });

  test('[A4] a very early important passage is not crowded out by many later appearances', async () => {
    const later = Array.from({ length: 12 }, (_, i) => `${filler(4, `第${i}日`)}\n林舟在城中闲逛，买了些干粮${i}。`);
    const t = await setup({ tools: false, bodies: [`${INJURY}\n${filler(8)}`, ...later] });
    const session = PassageSession.create(await scopeBefore(db(), t.work.id, t.current));
    const hits = await prefetchPassages(session, { entryIds: [t.lin.id], keywords: extractKeywords(CURRENT), queryText: CURRENT }, { maxResults: 4, maxChars: 1200, excerptChars: 240 });
    expect(hits[0].chapterId).toBe(t.ids[0]);
    expect(hits[0].text).toContain('左手受伤');
  });

  test('[A6] never another work, never the current chapter after the selection, never later chapters', async () => {
    const t = await setup({ tools: false, bodies: ['林舟拜师。', INJURY], current: `${CURRENT}\n林舟右腿中箭，倒在地上。` });
    const volume = (await chapters.list(t.work.id))[0].volume;
    const after = await chapters.create({ workId: t.work.id, volumeId: volume.id, kind: 'main', title: '后文' });
    await chapters.saveBody(after.id, '林舟左手被斩断，再也不能握剑。', 0);
    const other = await works.create({ title: '别的书', premise: '另一个故事' });
    const otherChapter = await chapters.create({ workId: other.id, volumeId: (await chapters.list(other.id))[0].volume.id, kind: 'main', title: '外' });
    await chapters.saveBody(otherChapter.id, '林舟左手受伤，血流不止。', 0);
    await entries.create({ workId: other.id, type: 'character', name: '林舟' });
    // Writing: selection is the first sentence of the current chapter; its later text is out of scope.
    const plan = await ai.prepareWriting({ chapterId: t.current, range: { start: 0, end: CURRENT.length }, task: 'quickEdit', op: 'polish', referenceIds: [t.lin.id] });
    const history = plan.blocks.filter(block => block.state === 'HISTORY');
    expect(history.length).toBeGreaterThan(0);
    expect(history.map(block => block.text).join('\n')).toContain('左手受伤，无法握剑');
    for (const block of history) {
      expect(block.text).not.toContain('斩断');
      expect(block.text).not.toContain('血流不止');
      expect(block.text).not.toContain('右腿中箭');
      expect(block.required).toBe(false);
    }
    expect(plan.requests[0].system).toContain('叙述顺序不等于故事时间');
    // Search scope is fixed by the session, whatever the caller asks for.
    const session = PassageSession.create(await scopeBefore(db(), t.work.id, t.current));
    const found = await searchPassages(session, { keywords: ['斩断', '血流不止', '左手'] });
    expect(found.passages.every(passage => passage.chapterId === t.ids[1])).toBe(true);
  });

  test('[A7] a source edited while the check runs is never published', async () => {
    const t = await setup({ tools: false });
    t.script(turn => ({ text: conflictJson(refFor(turn, '左手受伤')!, '左手受伤，无法握剑', {}, '林舟双手握剑', t.current) }));
    t.setHook(async turn => { if (turn.kind === 'conflict') await chapters.saveBody(t.ids[1], '阿舟毫发无伤。', 0); });
    await chapters.finalize(t.current);
    await runner.drain(new AbortController().signal);
    expect(await db().all('SELECT * FROM conflicts')).toHaveLength(0);
    expect((await conflictJob(t.work.id)).status).not.toBe('done');
  });

  test('[A7] a temporary ref the task never issued is rejected', async () => {
    const u = await setup({ tools: false });
    u.script(() => ({ text: conflictJson('p99', '左手受伤，无法握剑', {}, '林舟双手握剑', u.current) }));
    await chapters.finalize(u.current);
    await runner.drain(new AbortController().signal);
    expect(await db().all('SELECT * FROM conflicts WHERE work_id=?', [u.work.id])).toHaveLength(0);
    expect((await conflictJob(u.work.id)).error?.code).toBe('AI_FORMAT');
  });

  test('a suspected conflict is stored as a low-severity doubt', async () => {
    const t = await setup({ tools: false });
    t.script(turn => ({ text: conflictJson(refFor(turn, '左手受伤')!, '左手受伤，无法握剑', { certainty: 'suspected', severity: 'high' }, '林舟双手握剑', t.current) }));
    await chapters.finalize(t.current);
    await runner.drain(new AbortController().signal);
    const [row] = await db().all<{ severity: string; explanation: string }>('SELECT severity,explanation FROM conflicts');
    expect(row.severity).toBe('low');
    expect(row.explanation.startsWith('（存疑）')).toBe(true);
  });
});

describe('phase 2: bounded tool loop', () => {
  test.each(['openai_responses', 'anthropic_messages'] as const)('[A1] %s: search, then a verified conflict citing a tool result', async protocol => {
    // The injury is outside the prefetch (no entity in that paragraph), only a search finds it.
    const t = await setup({ protocol, bodies: ['林舟拜入青云门。', `${filler(20)}\n那一战之后，他的左手受伤，无法握剑。\n${filler(10)}`] });
    t.script((turn, index) => {
      if (index === 0) return { calls: [{ id: 'call_1', name: 'search_passages', args: { entryIds: ['林舟'], keywords: ['左手', '受伤'] } }] };
      const ref = refFor(turn, '左手受伤');
      return { text: ref ? conflictJson(ref, '左手受伤，无法握剑', {}, '林舟双手握剑', t.current) : '{"conflicts":[]}' };
    });
    const preview = await previewFinalization(t.current);
    expect(preview.history?.tools).toMatchObject({ maxToolRoundsPerChunk: 2, maxRequestsPerChunk: 3, maxToolRounds: 2 });
    expect(preview.maxPosts).toBe(preview.plannedCalls + 2 + 2);
    await chapters.finalize(t.current, { plan: preview });
    await runner.drain(new AbortController().signal);
    const [first, second] = t.conflictTurns();
    expect(t.conflictTurns()).toHaveLength(2);
    if (protocol === 'openai_responses') {
      expect(first.payload.tools).toEqual([expect.objectContaining({ type: 'function', name: 'search_passages' }), expect.objectContaining({ type: 'function', name: 'read_passage' })]);
      expect(first.payload.tool_choice).toBe('auto');
      const input = second.payload.input as Record<string, unknown>[];
      expect(input).toEqual(expect.arrayContaining([{ type: 'function_call', call_id: 'call_1', name: 'search_passages', arguments: expect.any(String) },
        expect.objectContaining({ type: 'function_call_output', call_id: 'call_1' })]));
    } else {
      expect(first.payload.tools).toEqual([expect.objectContaining({ name: 'search_passages', input_schema: expect.any(Object) }), expect.objectContaining({ name: 'read_passage' })]);
      const messages = second.payload.messages as { role: string; content: Record<string, unknown>[] }[];
      // The assistant turn is replayed exactly, thinking signature included.
      expect(messages[1]).toEqual({ role: 'assistant', content: [{ type: 'thinking', thinking: '先核实伤势。', signature: 'sig-3' }, { type: 'tool_use', id: 'call_1', name: 'search_passages', input: { entryIds: ['林舟'], keywords: ['左手', '受伤'] } }] });
      expect(messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'call_1' });
    }
    expect((await conflictJob(t.work.id)).status).toBe('done');
    const [row] = await db().all<Record<string, unknown>>('SELECT * FROM conflicts');
    expect(row).toMatchObject({ b_ref: `chapter:${t.ids[1]}`, b_quote: '左手受伤，无法握剑' });
    const budget = await db().get<Record<string, number>>("SELECT * FROM ai_requests WHERE task='finalize'");
    expect(budget).toMatchObject({ tool_rounds: 1, max_tool_rounds: 2 });
    const saved = await db().get<{ rounds: string }>("SELECT c.rounds FROM job_chunks c JOIN jobs j ON j.id=c.job_id WHERE j.kind='detect_conflicts'");
    expect(JSON.parse(saved!.rounds)).toMatchObject({ rounds: 1, turns: [{ role: 'assistant' }, { role: 'user', toolResults: [{ callId: 'call_1' }] }] });
  });

  test('two tool rounds, then a forced final judgement; a third tool request is a format error', async () => {
    const t = await setup();
    let calls = 0;
    t.script(() => ({ calls: [{ id: `c${++calls}`, name: 'search_passages', args: { keywords: ['痊愈'] } }] }));
    await chapters.finalize(t.current);
    await runner.drain(new AbortController().signal);
    const turns = t.conflictTurns();
    expect(turns).toHaveLength(3);
    expect(turns.map(turn => turn.payload.tool_choice)).toEqual(['auto', 'auto', 'none']);
    expect((await conflictJob(t.work.id)).error?.code).toBe('AI_FORMAT');
    expect(await db().all('SELECT * FROM conflicts')).toHaveLength(0);
    const attempts = await db().all("SELECT a.* FROM ai_attempts a JOIN ai_requests r ON r.id=a.request_id WHERE r.task='finalize' AND a.candidate_index=2");
    expect(attempts).toHaveLength(3);
  });

  test('extra calls in one round and oversized arguments are answered, not executed', async () => {
    const t = await setup();
    t.script((turn, index) => index === 0 ? { calls: [
      { id: 'a', name: 'search_passages', args: { keywords: ['受伤'] } },
      { id: 'b', name: 'read_passage', args: { ref: 'p999' } },
      { id: 'c', name: 'search_passages', args: { keywords: ['这是一个超过二十个字的非常非常非常长的关键词啊啊啊'] } },
      { id: 'd', name: 'search_passages', args: { keywords: ['握剑'] } },
      { id: 'e', name: 'delete_everything', args: {} },
    ] } : { text: '{"conflicts":[]}' });
    await chapters.finalize(t.current);
    await runner.drain(new AbortController().signal);
    const results = t.conflictTurns()[1].payload.input as { type: string; call_id: string; output: string }[];
    const outputs = Object.fromEntries(results.filter(item => item.type === 'function_call_output').map(item => [item.call_id, item.output]));
    expect(outputs.a).toContain('找到');
    expect(outputs.b).toContain('引用编号不存在');
    expect(outputs.c).toContain('参数不符合要求');
    expect(outputs.d).toContain('这一个未执行');
    expect(outputs.e).toContain('这一个未执行');
    expect((await conflictJob(t.work.id)).status).toBe('done');
  });

  test('[A8] a service that rejects tools falls back to the prefetch-only check', async () => {
    const t = await setup();
    t.script((turn, index) => index === 0
      ? { error: { status: 400, body: { error: { type: 'invalid_request_error', code: 'unsupported_parameter', param: 'tools', message: "Unsupported parameter: 'tools' is not supported with this model." } } } }
      : { text: conflictJson(refFor(turn, '左手受伤')!, '左手受伤，无法握剑', {}, '林舟双手握剑', t.current) });
    await chapters.finalize(t.current);
    await runner.drain(new AbortController().signal);
    const [first, second] = t.conflictTurns();
    expect(first.payload.tools).toBeDefined();
    expect(second.payload.tools).toBeUndefined();
    expect(second.system).not.toContain('search_passages');
    expect((await conflictJob(t.work.id)).status).toBe('done');
    expect(await db().all('SELECT * FROM conflicts')).toHaveLength(1);
  });

  test('[A7] cancel after a saved round, then resume: saved turns are reused and budgets are not reset', async () => {
    const t = await setup();
    const controller = new AbortController();
    t.script((turn, index) => index === 0 ? { calls: [{ id: 'k1', name: 'search_passages', args: { entryIds: ['阿舟'], keywords: ['受伤'] } }] }
      : { text: conflictJson(refFor(turn, '左手受伤')!, '左手受伤，无法握剑', {}, '林舟双手握剑', t.current) });
    t.setHook(async turn => { if (turn.kind === 'conflict' && t.conflictTurns().length === 2) controller.abort(); });
    await chapters.finalize(t.current);
    await runner.drain(controller.signal);
    const job = await conflictJob(t.work.id);
    expect(job.status).not.toBe('done');
    expect(await db().get<{ tool_rounds: number }>("SELECT tool_rounds FROM ai_requests WHERE task='finalize'")).toEqual({ tool_rounds: 1 });
    t.setHook(null);
    await jobs.resume(job.id, { confirmInterrupted: true });
    await runner.drain(new AbortController().signal);
    const turns = t.conflictTurns();
    expect(turns).toHaveLength(3);
    // The resumed request carries the saved tool turn instead of starting over.
    expect((turns[2].payload.input as { type?: string }[]).some(item => item.type === 'function_call_output')).toBe(true);
    expect((await conflictJob(t.work.id)).status).toBe('done');
    expect(await db().get<{ tool_rounds: number }>("SELECT tool_rounds FROM ai_requests WHERE task='finalize'")).toEqual({ tool_rounds: 1 });
    expect(await db().all('SELECT * FROM conflicts')).toHaveLength(1);
  });

  test('the first chapter has no earlier prose: no tools, no history', async () => {
    const t = await setup({ bodies: [] });
    const preview = await previewFinalization(t.current);
    expect(preview.history).toEqual({ chapters: 0, passages: 0, tools: null });
    const conflictsTask = preview.tasks.find(task => task.kind === 'detect_conflicts')!;
    expect(conflictsTask.chunks[0].contextPlan.requests[0].tools).toBeUndefined();
  });
});

describe('[A5] index maintenance through the app flows', () => {
  test('renaming an alias moves mentions; a body edit drops the chapter index until rebuilt', async () => {
    const t = await setup({ tools: false });
    const session = () => scopeBefore(db(), t.work.id, t.current).then(PassageSession.create);
    expect((await searchPassages(await session(), { entryIds: [t.lin.id] })).passages.some(p => p.text.includes('阿舟左手'))).toBe(true);
    await entries.update(t.lin.id, { aliases: ['小舟'] });
    expect((await searchPassages(await session(), { entryIds: [t.lin.id] })).passages.some(p => p.text.includes('阿舟左手'))).toBe(false);
    await chapters.saveBody(t.ids[1], `${filler(3)}\n小舟左手受伤。`, 0);
    expect(await db().all('SELECT id FROM chapter_chunks WHERE chapter_id=?', [t.ids[1]])).toHaveLength(0);
    expect((await searchPassages(await session(), { entryIds: [t.lin.id] })).passages.map(p => p.chapterId)).toContain(t.ids[1]);
    expect((await db().all('SELECT id FROM chapter_chunks WHERE chapter_id=?', [t.ids[1]])).length).toBeGreaterThan(0);
  });
});
