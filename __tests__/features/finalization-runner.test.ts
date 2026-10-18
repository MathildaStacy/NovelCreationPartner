import { db, setDb } from '../../src/data/db';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as services from '../../src/features/modelServices';
import * as jobs from '../../src/features/jobs';
import * as runner from '../../src/features/finalizationRunner';
import * as prefs from '../../src/features/prefs';
import * as proposals from '../../src/features/proposals';
import * as usage from '../../src/features/aiUsage';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { createProvider } from '../../src/ai/providers/httpProvider';
import { TransportFailure, type HttpRequest, type HttpTransport } from '../../src/ai/transport/native';
import { freshDb, tickingClock } from '../helpers/db';
import { fingerprint } from '../../src/ai/context';
import { previewFinalization } from '../../src/features/finalizationPlans';
import * as conflicts from '../../src/features/conflicts';
jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'fixture-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));
beforeEach(async () => { tickingClock(); await freshDb(); });
afterEach(async () => { jest.restoreAllMocks(); await db().close(); setDb(null); });
async function setup() {
  const work = await works.create({ title: '剑途', premise: '寻找丢失的剑' });
  const volume = (await chapters.list(work.id))[0].volume;
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, kind: 'main', title: '失剑' });
  await chapters.saveBody(chapter.id, '小雨使用蓝色的剑。\n今天她失去了那把剑。', 0);
  const entry = await entries.create({ workId: work.id, type: 'character', name: '小雨', facts: [{ field: 'ability', value: '只能使用红色的剑' }] });
  const fact = entry.facts[0];
  const saved = await services.save({ name: 'fixture', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'fixture', options: { ...DEFAULT_OPTIONS, caps: {} } }, 'fixture-key');
  const service = await services.get(saved.service.id);
  await prefs.set('aiNoticeAcknowledged', { 'example.test': new Date().toISOString() });
  const controller = new AbortController();
  const calls: HttpRequest[] = [];
  let hook: ((request: HttpRequest) => Promise<void>) | null = null;
  let extraction= [{ kind: 'update', targetType: 'character', targetName: '小雨', field: 'ability', before: '只能使用红色的剑', after: '失去蓝剑', evidence: '今天她失去了那把剑。', confidence: 'high' }];
  let emptyConflicts=false;
  let override:((system:string)=>string|null)|null=null;
  const transport: HttpTransport = async function* (request) {
    calls.push(request);
    await hook?.(request);
    if (request.signal.aborted) throw new TransportFailure('cancelled');
    const payload = JSON.parse(request.body!);
    const system = payload.instructions as string;
    const content = override?.(system)??(system.includes('60–120') ? '小雨在旅途中失去了自己的剑，决定寻找线索。'
      : system.includes('changes') ? JSON.stringify({ changes: extraction })
      : JSON.stringify({ conflicts: emptyConflicts?[]:[{ type: 'setting', severity: 'high', a: { source: `chapter:${chapter.id}`, quote: '小雨使用蓝色的剑。' }, b: { source: `fact:${fact.id}`, quote: '只能使用红色的剑' }, explanation: '蓝色与红色的能力限制不一致', suggestions: ['若为有意伏笔可以保留'] }] }));
    yield { type: 'headers', status: 200, headers: { 'content-type': 'application/json' } };
    const text = JSON.stringify({ object: 'response', status: 'completed', model: 'fixture', usage: { input_tokens: 100, output_tokens: 35 }, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content }] }] });
    yield { type: 'data', text, bytes: Buffer.byteLength(text) };
  };
  jest.spyOn(services, 'withGeneration').mockImplementation(async (_id, _revision, signal, callback) => callback({ service, signal,
    providerFactory: (evidence, deadline) => createProvider(service, 'fixture-key', { evidence, deadline, transport }) }));
  return { work, chapter, entry, fact, calls, controller, setHook(next: typeof hook) { hook = next; }, setExtraction(next:typeof extraction){extraction=next;},setEmptyConflicts(){emptyConflicts=true;},setOutput(value:typeof override){override=value;} };
}

test('three jobs share one persisted N3 budget and produce only reviewable derived data', async () => {
  const { work, chapter, entry, calls, controller } = await setup();
  const finalized = await chapters.finalize(chapter.id);
  await runner.drain(controller.signal);
  expect(calls).toHaveLength(3);
  expect((await jobs.list(work.id)).map(job => job.status)).toEqual(['done', 'done', 'done']);
  const budget = await db().get<{ planned_calls: number; max_posts: number; physical_posts: number }>('SELECT * FROM ai_requests WHERE task=?', ['finalize']);
  expect(budget).toMatchObject({ planned_calls: 3, max_posts: 5, physical_posts: 3 });
  expect((await db().all('SELECT * FROM ai_attempts')).map(row => row.candidate_index)).toEqual([0, 1, 2]);
  const pending = await db().all('SELECT * FROM memory_proposals');
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({ status: 'pending', evidence: '今天她失去了那把剑。', source_job_id: finalized.jobIds[1] });
  expect(await db().all('SELECT * FROM conflicts')).toHaveLength(1);
  expect((await entries.get(entry.id)).facts[0].value).toBe('只能使用红色的剑');
  expect((await chapters.get(chapter.id)).summary).toContain('失去');
  await runner.drain(controller.signal);
  expect(calls).toHaveLength(3);
  expect((await usage.summary()).unknown).toBe(0);
});

test('late result after body edit never overwrites manual summary or creates derived results', async () => {
  const { work, chapter, calls, controller, setHook } = await setup();
  await chapters.finalize(chapter.id);
  setHook(async () => { await chapters.saveBody(chapter.id, '作者已重写。', 0); await db().run('UPDATE chapters SET summary=? WHERE id=?', ['手工摘要', chapter.id]); });
  await runner.runNext(controller.signal);
  expect(calls).toHaveLength(1);
  expect((await chapters.get(chapter.id)).summary).toBe('手工摘要');
  expect((await jobs.list(work.id))[0]).toMatchObject({ status: 'paused', pauseReason: 'stale' });
  expect(await db().all('SELECT * FROM memory_proposals')).toHaveLength(0);
});

test('cancellation with possible billing pauses interrupted and retains unknown reservation', async () => {
  const { work, chapter, controller, calls, setHook } = await setup();
  await chapters.finalize(chapter.id);
  setHook(async () => { controller.abort(); });
  await runner.runNext(controller.signal);
  expect(calls).toHaveLength(1);
  expect((await jobs.list(work.id))[0]).toMatchObject({ status: 'paused', pauseReason: 'interrupted' });
  expect((await usage.summary()).unknown).toBe(1);
  const requests = await db().get<{ reserved_output: number }>('SELECT * FROM ai_requests WHERE task=?', ['finalize']);
  expect(requests?.reserved_output).toBe(1000);
  await runner.drain(new AbortController().signal);
  expect(calls).toHaveLength(1);
});

test('manual summary edit alone wins against a late successful result', async () => {
  const { work, chapter, controller, setHook } = await setup();
  await chapters.finalize(chapter.id);
  setHook(async () => { await db().run('UPDATE chapters SET summary=? WHERE id=?', ['作者自己的摘要', chapter.id]); });
  await runner.runNext(controller.signal);
  expect((await chapters.get(chapter.id)).summary).toBe('作者自己的摘要');
  expect((await jobs.list(work.id))[0]).toMatchObject({ status: 'paused', pauseReason: 'stale' });
});

test('intentional conflicts suppress repeat findings by stable evidence fingerprint', async () => {
  const { work, chapter, fact, controller } = await setup();
  const digest = fingerprint({ type: 'setting', a: `chapter:${chapter.id}`, aQuote: '小雨使用蓝色的剑。', b: `fact:${fact.id}`, bQuote: '只能使用红色的剑' });
  await db().run(`INSERT INTO conflicts (id,work_id,chapter_id,type,severity,a_label,a_ref,a_quote,b_label,b_ref,b_quote,explanation,status,fingerprint,created_at)
    VALUES ('intentional',?,?,'setting','high','正文',?,'小雨使用蓝色的剑。','能力',?,'只能使用红色的剑','有意误导','intentional',?,?)`, [work.id, chapter.id, `chapter:${chapter.id}`, `fact:${fact.id}`, digest, new Date().toISOString()]);
  await chapters.finalize(chapter.id);
  await runner.drain(controller.signal);
  expect(await db().all('SELECT * FROM conflicts')).toHaveLength(1);
  expect((await jobs.list(work.id))[2].status).toBe('done');
});

test('author-confirmed interrupted resume keeps spent reservation and uses remaining child ordinal', async () => {
  const { work, chapter, controller, calls, setHook } = await setup();
  await chapters.finalize(chapter.id);
  setHook(async () => { controller.abort(); });
  await runner.runNext(controller.signal);
  const [job] = await jobs.list(work.id);
  await expect(jobs.resume(job.id)).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  await jobs.resume(job.id, { confirmInterrupted: true });
  setHook(null);
  await runner.runNext(new AbortController().signal);
  expect(calls).toHaveLength(2);
  expect((await jobs.list(work.id))[0].status).toBe('done');
  const attempts = await db().all('SELECT ordinal,status FROM ai_attempts WHERE candidate_index=0 ORDER BY ordinal');
  expect(attempts.map(attempt => attempt.ordinal)).toEqual([1, 2]);
  expect(attempts.map(attempt => attempt.status)).toEqual(['cancelled', 'succeeded']);
  const budget = await db().get('SELECT reserved_output FROM ai_requests WHERE task=?', ['finalize']);
  expect(budget?.reserved_output).toBe(1035);
});

test('review acceptance establishes chapter-scoped fact and safe undo restores its previous end range', async () => {
  const { work, chapter, entry, controller } = await setup();
  await chapters.finalize(chapter.id);
  await runner.drain(controller.signal);
  const [proposal] = await proposals.list(work.id);
  expect(proposal.chapterNumber).toBe(1);
  await proposals.accept(proposal.id);
  const reviewed = await entries.get(entry.id);
  expect(reviewed.facts.find(fact => fact.field === 'ability')).toMatchObject({ value: '失去蓝剑', state: 'ESTABLISHED', fromChapterId: chapter.id });
  await proposals.undo(proposal.id);
  const restored = await entries.get(entry.id);
  expect(restored.facts.find(fact => fact.field === 'ability')).toMatchObject({ value: '只能使用红色的剑', state: 'CONFIRMED', toChapterId: null });
  expect((await proposals.list(work.id))[0].status).toBe('pending');
});

test('old extraction proposals cannot be accepted after a source edit or later finalization', async () => {
  const { work, chapter, entry, controller } = await setup();
  await chapters.finalize(chapter.id);
  await runner.drain(controller.signal);
  const [proposal] = await proposals.list(work.id);
  await chapters.saveBody(chapter.id, '小雨决定回家。', 0);
  await chapters.finalize(chapter.id);
  await expect(proposals.accept(proposal.id, { value: '作者改写的值' })).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  expect((await entries.get(entry.id)).facts[0].value).toBe('只能使用红色的剑');
});

test('review undo refuses to remove later changes and rejection undo stays local', async () => {
  const { work, chapter, entry, controller } = await setup();
  await chapters.finalize(chapter.id);
  await runner.drain(controller.signal);
  const [proposal] = await proposals.list(work.id);
  await proposals.reject(proposal.id, '作者不要这条');
  await proposals.undo(proposal.id);
  expect((await proposals.list(work.id))[0]).toMatchObject({ status: 'pending' });
  await proposals.accept(proposal.id);
  await entries.update(entry.id, { facts: [{ field: 'ability', value: '后来作者另改' }] });
  await expect(proposals.undo(proposal.id)).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  expect((await entries.get(entry.id)).facts.find(fact => fact.field === 'ability')?.value).toBe('后来作者另改');
});

test('reviewing siblings advances only this extraction audit and outside archive edits still invalidate it', async () => {
  const {work,chapter,entry,controller,setExtraction}=await setup();
  setExtraction([
    {kind:'update',targetType:'character',targetName:'小雨',field:'ability',before:'只能使用红色的剑',after:'失去蓝剑',evidence:'今天她失去了那把剑。',confidence:'high'},
    {kind:'add',targetType:'character',targetName:'小雨',field:'identity',before:'',after:'剑客',evidence:'小雨使用蓝色的剑。',confidence:'high'},
  ]);
  await chapters.finalize(chapter.id);await runner.drain(controller.signal);
  const pending=await proposals.list(work.id);
  const ability=pending.find(p=>p.field==='ability')!,identity=pending.find(p=>p.field==='identity')!;
  await proposals.accept(ability.id);
  await proposals.accept(identity.id,{value:'作者确认的剑客'});
  expect((await entries.get(entry.id)).facts.map(f=>f.value)).toEqual(expect.arrayContaining(['失去蓝剑','作者确认的剑客']));
  await proposals.undo(identity.id);
  await entries.update(entry.id,{facts:[{field:'personality',value:'作者后来新增的性格'}]});
  await expect(proposals.accept(identity.id)).rejects.toMatchObject({code:'AI_RESULT_STALE'});
});

test('removed accepted evidence yields a version-bound retirement proposal and never deletes facts automatically',async()=>{
  const {work,chapter,entry,controller,setExtraction}=await setup();
  await chapters.finalize(chapter.id);await runner.drain(controller.signal);
  const [original]=await proposals.list(work.id);await proposals.accept(original.id);
  await chapters.saveBody(chapter.id,'小雨决定回家。',0);setExtraction([]);
  await chapters.finalize(chapter.id);await runner.drain(controller.signal);
  const deletion=(await proposals.list(work.id)).find(p=>p.origin==='deletion')!;
  expect(deletion).toMatchObject({kind:'retire',before:'失去蓝剑',after:'',status:'pending',evidenceVersionId:original.evidenceVersionId,evidence:'今天她失去了那把剑。'});
  expect((await entries.get(entry.id)).facts.find(f=>f.field==='ability')?.value).toBe('失去蓝剑');
  await proposals.accept(deletion.id);
  expect((await entries.get(entry.id)).facts.find(f=>f.field==='ability')).toBeUndefined();
  await proposals.undo(deletion.id);
  expect((await entries.get(entry.id)).facts.find(f=>f.field==='ability')?.value).toBe('失去蓝剑');
});

test('removed evidence is not proposed when author has independently changed the accepted field',async()=>{
  const {work,chapter,entry,controller,setExtraction}=await setup();
  await chapters.finalize(chapter.id);await runner.drain(controller.signal);
  const [original]=await proposals.list(work.id);await proposals.accept(original.id);
  await entries.update(entry.id,{facts:[{field:'ability',value:'作者另有解释'}]});
  await chapters.saveBody(chapter.id,'小雨决定回家。',0);setExtraction([]);
  await chapters.finalize(chapter.id);await runner.drain(controller.signal);
  expect((await proposals.list(work.id)).filter(p=>p.origin==='deletion')).toHaveLength(0);
  expect((await entries.get(entry.id)).facts.find(f=>f.field==='ability')?.value).toBe('作者另有解释');
});

test('deletion approval revalidates live field and absence instead of trusting proposal metadata',async()=>{
  const {work,chapter,entry,controller,setExtraction}=await setup();
  await chapters.finalize(chapter.id);await runner.drain(controller.signal);
  const [original]=await proposals.list(work.id);await proposals.accept(original.id);
  await chapters.saveBody(chapter.id,'小雨决定回家。',0);setExtraction([]);
  await chapters.finalize(chapter.id);await runner.drain(controller.signal);
  const deletion=(await proposals.list(work.id)).find(p=>p.origin==='deletion')!;
  await entries.update(entry.id,{facts:[{field:'ability',value:'现在持有新剑'}]});
  await expect(proposals.accept(deletion.id)).rejects.toMatchObject({code:'AI_RESULT_STALE'});
  expect((await entries.get(entry.id)).facts.find(f=>f.field==='ability')?.value).toBe('现在持有新剑');
});

test('preview is immutable, creates no permanent version, and send uses its exact approved request',async()=>{
  const {chapter,calls,controller}=await setup();
  const before=await db().all('SELECT * FROM chapter_versions');
  const preview=await previewFinalization(chapter.id);
  expect(Object.isFrozen(preview.tasks[0].chunks[0].contextPlan.requests[0])).toBe(true);
  expect(await db().all('SELECT * FROM chapter_versions')).toEqual(before);
  await chapters.finalize(chapter.id,{plan:preview});await runner.runNext(controller.signal);
  const payload=JSON.parse(calls[0].body!);
  const request=preview.tasks[0].chunks[0].contextPlan.requests[0];
  expect(payload.instructions).toBe(request.system);
  expect(payload.input[0].content).toBe(request.messages[0].content);
});

test('edited inputs reject the approved preview before jobs or versions are created',async()=>{
  const {work,chapter}=await setup();const preview=await previewFinalization(chapter.id);
  await chapters.saveBody(chapter.id,'作者在预览后修改正文。',0);
  await expect(chapters.finalize(chapter.id,{plan:preview})).rejects.toMatchObject({code:'AI_RESULT_STALE'});
  expect(await jobs.list(work.id)).toHaveLength(0);expect(await db().all('SELECT * FROM chapter_versions')).toHaveLength(0);
});

test('six planned chunks share N+2, preserve validated chunks after interruption, and resume the unfinished child',async()=>{
  const {work,chapter,calls,controller,setExtraction,setEmptyConflicts,setHook}=await setup();
  await chapters.saveBody(chapter.id,`${'甲'.repeat(8000)}。\n${'乙'.repeat(8000)}。`,0);setExtraction([]);setEmptyConflicts();
  const plan=await previewFinalization(chapter.id);expect(plan).toMatchObject({eligible:true,plannedCalls:6,maxPosts:8});
  await chapters.finalize(chapter.id,{plan});setHook(async()=>{if(calls.length===2)controller.abort();});
  await runner.runNext(controller.signal);
  let [summary]=await jobs.list(work.id);expect(summary).toMatchObject({status:'paused',pauseReason:'interrupted',totalChunks:2,completedChunks:1});
  expect((await chapters.get(chapter.id)).summary).toBeNull();
  await jobs.resume(summary.id,{confirmInterrupted:true});setHook(null);await runner.drain(new AbortController().signal);
  [summary]=await jobs.list(work.id);expect(summary).toMatchObject({status:'done',totalChunks:2,completedChunks:2});
  expect(calls).toHaveLength(7);expect((await jobs.list(work.id)).every(j=>j.status==='done')).toBe(true);
  expect(await db().all('SELECT ordinal,status FROM ai_attempts WHERE candidate_index=1 ORDER BY ordinal')).toEqual([{ordinal:1,status:'cancelled'},{ordinal:2,status:'succeeded'}]);
  expect((await chapters.get(chapter.id)).summary!.length).toBeLessThanOrEqual(150);
});

test('more than six requests pauses the entire operation and completed identical snapshots are reused without sends',async()=>{
  const {work,chapter,calls,controller,setExtraction,setEmptyConflicts}=await setup();
  setExtraction([]);setEmptyConflicts();await chapters.finalize(chapter.id);await runner.drain(controller.signal);
  const first=(await jobs.list(work.id)).map(j=>j.id);
  await chapters.finalize(chapter.id);await runner.drain(controller.signal);
  expect(calls).toHaveLength(3);expect((await jobs.list(work.id)).map(j=>j.id)).toEqual(first);
  await chapters.saveBody(chapter.id,Array.from({length:3},(_,i)=>`${String.fromCharCode(0x7532+i).repeat(8000)}。`).join('\n'),0);
  const preview=await previewFinalization(chapter.id);expect(preview.eligible).toBe(false);expect(preview.plannedCalls).toBeGreaterThan(6);
  await chapters.finalize(chapter.id,{plan:preview});await runner.drain(controller.signal);
  expect(calls).toHaveLength(3);expect((await jobs.list(work.id)).slice(-3).every(j=>j.pauseReason==='budget')).toBe(true);
});

test('incremental extraction includes changed paragraph and neighbors, while review-only rerun omits other tasks',async()=>{
  const {chapter,calls,controller,setExtraction,setEmptyConflicts}=await setup();setExtraction([]);setEmptyConflicts();
  await chapters.saveBody(chapter.id,['首段。','第二段。','第三段。','第四段。','末段。'].join('\n'),0);await chapters.finalize(chapter.id);await runner.drain(controller.signal);
  await chapters.saveBody(chapter.id,['首段。','第二段。','第三段已经变化。','第四段。','末段。'].join('\n'),0);
  const plan=await previewFinalization(chapter.id);expect(plan.incremental).toBe(true);
  const extract=plan.tasks.find(t=>t.kind==='extract_memory')!.chunks.map(c=>c.text).join('');
  expect(extract).toContain('第二段。');expect(extract).toContain('第三段已经变化。');expect(extract).toContain('第四段。');expect(extract).not.toContain('首段。');expect(extract).not.toContain('末段。');
  await chapters.finalize(chapter.id,{plan});await runner.drain(controller.signal);
  const review=await conflicts.prepareRecheck(chapter.id);expect(review.tasks.map(t=>t.kind)).toEqual(['detect_conflicts']);
  const count=calls.length;await conflicts.recheck(chapter.id,review);await runner.drain(controller.signal);expect(calls).toHaveLength(count);
});

test('a new approved operation reuses only dependency-identical validated chunks and preserves spent ledger entries',async()=>{
  const {work,chapter,calls,controller,setExtraction,setEmptyConflicts,setHook}=await setup();
  await chapters.saveBody(chapter.id,`${'甲'.repeat(8000)}。\n${'乙'.repeat(8000)}。`,0);setExtraction([]);setEmptyConflicts();
  await chapters.finalize(chapter.id);setHook(async()=>{if(calls.length===2)controller.abort();});await runner.runNext(controller.signal);
  const previous=(await jobs.list(work.id))[0];expect(previous.completedChunks).toBe(1);
  const preview=await previewFinalization(chapter.id);expect(preview).toMatchObject({plannedCalls:5,maxPosts:7});
  expect(preview.tasks[0].chunks[0].cachedResult).toBeDefined();
  setHook(null);await chapters.finalize(chapter.id,{plan:preview});await runner.drain(new AbortController().signal);
  expect(calls).toHaveLength(7);expect((await usage.summary()).unknown).toBe(1);
  expect((await jobs.list(work.id)).slice(-3).every(j=>j.status==='done')).toBe(true);
  // A formal archive edit invalidates even the already validated content cache.
  await entries.create({workId:work.id,type:'place',name:'新地点'});
  const invalidated=await previewFinalization(chapter.id);expect(invalidated.plannedCalls).toBe(6);expect(invalidated.tasks.every(t=>t.chunks.every(c=>c.cachedResult===undefined))).toBe(true);
});

test('pure deletion supersedes old unreviewed evidence and does not skip surviving border context',async()=>{
  const {work,chapter,controller,setExtraction,setEmptyConflicts}=await setup();setEmptyConflicts();
  await chapters.finalize(chapter.id);await runner.drain(controller.signal);const [old]=await proposals.list(work.id);
  await chapters.saveBody(chapter.id,'小雨使用蓝色的剑。',0);setExtraction([]);
  const preview=await previewFinalization(chapter.id);expect(preview.tasks.find(t=>t.kind==='extract_memory')!.chunks[0].text).toContain('小雨使用蓝色的剑。');
  await chapters.finalize(chapter.id,{plan:preview});
  expect((await proposals.list(work.id)).find(p=>p.id===old.id)?.status).toBe('superseded');
});

test('the same approval can publish once even under concurrent confirm retries',async()=>{
  const {work,chapter}=await setup();const preview=await previewFinalization(chapter.id);
  const results=await Promise.all([chapters.finalize(chapter.id,{plan:preview}),chapters.finalize(chapter.id,{plan:preview})]);
  expect(results[0]).toEqual(results[1]);expect(await jobs.list(work.id)).toHaveLength(3);
  expect(await db().all('SELECT * FROM ai_requests')).toHaveLength(1);
  const running=await jobs.claimNext();expect(running).not.toBeNull();
  await chapters.finalize(chapter.id,{plan:preview});expect((await jobs.list(work.id))[0].status).toBe('running');
});

test('incremental coverage requires a completed previous extraction and keeps old unreviewed paragraphs in scope',async()=>{
  const {chapter,controller,setExtraction,setEmptyConflicts}=await setup();setEmptyConflicts();
  const original=['第一段。','第二段。','第三段。','第四段。','末段。'].join('\n');
  await chapters.saveBody(chapter.id,original,0);await chapters.finalize(chapter.id);
  await chapters.saveBody(chapter.id,original.replace('第四段','第四段变更'),0);
  let preview=await previewFinalization(chapter.id);expect(preview.incremental).toBe(false);expect(preview.tasks.find(t=>t.kind==='extract_memory')!.chunks[0].text).toContain('第一段。');
  await chapters.saveBody(chapter.id,'小雨使用蓝色的剑。\n今天她失去了那把剑。\n第三段。\n第四段。\n末段。',0);
  await chapters.finalize(chapter.id);await runner.drain(controller.signal);setExtraction([]);
  await chapters.saveBody(chapter.id,'小雨使用蓝色的剑。\n今天她失去了那把剑。\n第三段。\n第四段变更。\n末段。',0);
  preview=await previewFinalization(chapter.id);expect(preview.incremental).toBe(false);expect(preview.tasks.find(t=>t.kind==='extract_memory')!.chunks[0].text).toContain('小雨使用蓝色的剑。');
});

test('explicitly cancelling extraction still allows independent conflict review after summary',async()=>{
  const {work,chapter,calls,controller}=await setup();await chapters.finalize(chapter.id);await runner.runNext(controller.signal);
  const extract=(await jobs.list(work.id)).find(j=>j.kind==='extract_memory')!;await jobs.cancel(extract.id);await runner.drain(controller.signal);
  expect(calls).toHaveLength(2);expect((await jobs.list(work.id)).find(j=>j.kind==='detect_conflicts')?.status).toBe('done');
  expect(await proposals.list(work.id)).toHaveLength(0);
});

test('field and relation proposals share one thirty-item cap and invalid totals publish no partial suggestions',async()=>{
  const {work,chapter,controller,setOutput}=await setup();await entries.create({workId:work.id,type:'character',name:'老李'});
  setOutput(system=>system.includes('changes')?JSON.stringify({changes:Array.from({length:30},(_,i)=>({kind:'add',targetType:'character',targetName:'小雨',field:'identity',before:null,after:`身份${i}`,evidence:'小雨使用蓝色的剑。',confidence:'high'})),relations:[{fromName:'小雨',toName:'老李',kind:'add',relationKind:'师徒',before:null,after:'老师',evidence:'小雨使用蓝色的剑。',confidence:'high'}]}):null);
  await chapters.finalize(chapter.id);await runner.drain(controller.signal);
  expect((await jobs.list(work.id)).find(j=>j.kind==='extract_memory')).toMatchObject({status:'failed',error:{code:'AI_FORMAT'}});
  expect(await proposals.list(work.id)).toHaveLength(0);
});

test('more than ten merged unique conflicts fails the complete job without publishing a partial clean review',async()=>{
  const {work,chapter,fact,controller,setExtraction,setOutput}=await setup();setExtraction([]);
  await chapters.saveBody(chapter.id,`小雨${'甲'.repeat(8000)}。\n小雨${'乙'.repeat(8000)}。`,0);let conflictChunk=0;
  setOutput(system=>{
    if(system.includes('60–120')||system.includes('changes'))return null;
    const character=conflictChunk++===0?'甲':'乙';
    return JSON.stringify({conflicts:Array.from({length:6},(_,i)=>({type:'setting',severity:'high',a:{source:`chapter:${chapter.id}`,quote:character.repeat(i+1)},b:{source:`fact:${fact.id}`,quote:'只能使用红色的剑'},explanation:'捕获的正文与原设定不同',suggestions:[]}))});
  });
  await chapters.finalize(chapter.id);await runner.drain(controller.signal);
  expect((await jobs.list(work.id)).find(j=>j.kind==='detect_conflicts')).toMatchObject({status:'failed',completedChunks:2,error:{code:'AI_FORMAT'}});
  expect(await db().all('SELECT * FROM conflicts')).toHaveLength(0);
});

test('review-only plans bind finalized evidence rather than a later equivalent snapshot and preview binding changes require renewed approval',async()=>{
  const {chapter}=await setup();await chapters.finalize(chapter.id);
  const version=(await chapters.get(chapter.id)).finalizedVersionId;
  await db().run("INSERT INTO chapter_versions(id,chapter_id,body,reason,char_count,created_at) SELECT 'later',id,body,'auto',char_count,'9999' FROM chapters WHERE id=?",[chapter.id]);
  const plan=await conflicts.prepareRecheck(chapter.id);expect(plan.sourceVersionId).toBe(version);
  await prefs.set('serviceBindings',{writing:null,utility:null,review:'missing'});
  await expect(conflicts.recheck(chapter.id,plan)).rejects.toMatchObject({code:'AI_RESULT_STALE'});
});

test('only locally relevant directory names and necessary relationship endpoints enter each request',async()=>{
  const {work,chapter,entry}=await setup();
  await entries.create({workId:work.id,type:'character',name:'无关角色',facts:[{field:'secret',value:'不应发出的秘密'}]});
  const target=await entries.create({workId:work.id,type:'character',name:'关系另一端'});
  await db().run("INSERT INTO relations(id,work_id,from_entry,to_entry,kind,note,state,created_at,updated_at) VALUES('linked',?,?,?,'朋友','必要关系','CONFIRMED','x','x')",[work.id,entry.id,target.id]);
  const preview=await previewFinalization(chapter.id);const chunk=preview.tasks.find(t=>t.kind==='extract_memory')!.chunks[0];
  expect(chunk.contextPlan.serializedRequest).not.toContain('无关角色');expect(chunk.contextPlan.serializedRequest).not.toContain('不应发出的秘密');
  expect(chunk.contextPlan.serializedRequest).toContain('关系另一端');expect(chunk.entries.some(e=>e.name==='无关角色')).toBe(true);
});

test('explicit resume does not reset the five-minute deadline of a physically attempted chunk',async()=>{
  const {work,chapter,calls,controller,setHook}=await setup();await chapters.finalize(chapter.id);
  setHook(async()=>controller.abort());await runner.runNext(controller.signal);
  const [job]=await jobs.list(work.id);await db().run('UPDATE ai_attempts SET started_at=? WHERE request_id=?',[new Date(Date.now()-6*60000).toISOString(),job.operationId!]);
  await jobs.resume(job.id,{confirmInterrupted:true});setHook(null);await runner.runNext(new AbortController().signal);
  expect(calls).toHaveLength(1);expect((await jobs.list(work.id))[0]).toMatchObject({status:'paused',pauseReason:'budget'});
  expect(await db().all('SELECT * FROM ai_attempts')).toHaveLength(1);
});
