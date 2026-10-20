import { db, setDb } from '../../src/data/db';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate, migrations } from '../../src/data/migrations';
import * as chapters from '../../src/features/chapters';
import * as works from '../../src/features/works';
import * as jobs from '../../src/features/jobs';
import * as usage from '../../src/features/aiUsage';
import * as prefs from '../../src/features/prefs';
import { freshDb, tickingClock } from '../helpers/db';
import { emit, on } from '../../src/features/events';
import { useOverlay } from '../../src/components/overlay/store';
import { watchJobFailures } from '../../src/app/jobFailureToast';

beforeEach(async () => { tickingClock(); await freshDb(); });
afterEach(async () => { await db().close(); setDb(null); });

async function setup() {
  const work = await works.create({ premise: '核对定稿任务的完整输入' });
  const volume = (await chapters.list(work.id))[0].volume;
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id });
  await chapters.saveBody(chapter.id, '小雨找到古剑。', 0);
  for (const [id, output] of [['utility', 2000], ['review', 9000]] as const) {
    await db().run(`INSERT INTO model_services (id,name,protocol,base_url,model,options,is_default,has_key,revision,created_at,updated_at)
      VALUES (?,?,'openai_responses','https://example.test/v1','fixture',?,?,1,1,'x','x')`, [id,id,JSON.stringify({maxOutputTokens:output}),id==='utility'?1:0]);
  }
  await prefs.set('aiNoticeAcknowledged', {'example.test':'acknowledged'});
  await prefs.set('serviceBindings', {writing:null,utility:'utility',review:'review'});
  return {work,chapter,volume};
}

test('upgrading legacy jobs preserves authors and services but requires fresh confirmation', async () => {
  const old = openMemoryDb();
  for (const migration of migrations.slice(0,5)) for (const sql of migration) await old.run(sql);
  await old.run('PRAGMA user_version=5');
  await old.run("INSERT INTO works (id,premise,created_at,updated_at) VALUES ('w','保留作品','x','x')");
  await old.run("INSERT INTO jobs (id,work_id,kind,status,created_at,updated_at) VALUES ('j','w','summarize','running','x','x')");
  await old.run("INSERT INTO model_services (id,name,protocol,base_url,model,created_at,updated_at) VALUES ('s','保留服务','openai_responses','https://example.test','m','x','x')");
  await migrate(old);
  expect(await old.get('SELECT status,pause_reason,execution_token FROM jobs')).toEqual({status:'paused',pause_reason:'legacy_input',execution_token:null});
  expect((await old.get('SELECT premise FROM works'))?.premise).toBe('保留作品');
  expect((await old.get('SELECT name FROM model_services'))?.name).toBe('保留服务');
  await old.close();
});

test('batch migration retains earlier small-operation consent and never authorizes previously gated large operations',async()=>{
  const old=openMemoryDb();
  for(const migration of migrations.slice(0,12))for(const sql of migration)await old.run(sql);
  await old.run('PRAGMA user_version=12');
  for(const calls of [3,9])await old.run(`INSERT INTO ai_requests(id,task,policy_version,service_id,service_revision,model,planned_calls,max_posts,max_output_tokens,max_reserved_output,deadline_at,created_at,physical_posts) VALUES(?,'finalize','finalization-2','s',1,'m',?,?,1000,12000,123,'x',2)`,[String(calls),calls,calls+2]);
  await migrate(old);
  expect(await old.all('SELECT planned_calls,authorized_calls,deadline_at,physical_posts FROM ai_requests ORDER BY planned_calls')).toEqual([{planned_calls:3,authorized_calls:3,deadline_at:123,physical_posts:2},{planned_calls:9,authorized_calls:0,deadline_at:123,physical_posts:2}]);
  expect(await old.all('SELECT * FROM finalization_batches')).toEqual([]);await old.close();
});

test('finalization freezes routes, source and one shared parent allowance; claims serialize', async () => {
  const {work,chapter} = await setup();
  await chapters.finalize(chapter.id);
  const queued = await jobs.list(work.id);
  expect(queued.map(job=>job.serviceId)).toEqual(['utility','utility','review']);
  expect(new Set(queued.map(job=>job.sourceVersionId)).size).toBe(1);
  expect(new Set(queued.map(job=>job.operationId)).size).toBe(1);
  expect(await db().get('SELECT planned_calls,max_posts,max_reserved_output FROM ai_requests')).toEqual({planned_calls:3,max_posts:5,max_reserved_output:31000});
  const claims = await Promise.all([jobs.claim(queued[0].id),jobs.claim(queued[0].id)]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(await jobs.claim(queued[1].id)).toBeNull();
  await prefs.set('serviceBindings',{writing:null,utility:'review',review:'utility'});
  expect((await jobs.capture(queued[0].id)).service.id).toBe('utility');
});

test('crash recovery distinguishes an unsent bound job from any recorded physical attempt', async () => {
  const {work,chapter} = await setup();
  await chapters.finalize(chapter.id);
  let first = (await jobs.list(work.id))[0];
  await jobs.claim(first.id);
  await jobs.recoverRunning();
  expect((await jobs.list(work.id))[0]).toMatchObject({status:'queued',executionToken:null});
  first = (await jobs.claim(first.id))!;
  const captured = await jobs.capture(first.id);
  await usage.ledger.reserve({id:'sent',logicalRequestId:first.operationId!,workId:work.id,task:first.kind,policyVersion:'policy-test',serviceId:'utility',serviceRevision:1,model:'fixture',candidateIndex:0,attemptNumber:1,reason:'initial',startedAt:new Date().toISOString(),estimatedInputTokens:40,reservedOutputTokens:2000},captured.budget);
  await usage.recoverInterrupted();
  await jobs.recoverRunning();
  expect((await jobs.list(work.id))[0]).toMatchObject({status:'paused',pauseReason:'interrupted',executionToken:null});
  expect(await jobs.claimNext()).toBeNull();
  expect(await db().get('SELECT status,actual_input,actual_output,cost,policy_version,service_id FROM ai_attempts')).toEqual({status:'interrupted',actual_input:null,actual_output:null,cost:null,policy_version:'policy-test',service_id:'utility'});
  await expect(jobs.resume(first.id)).rejects.toMatchObject({code:'CONFLICT_STATE'});
});

test.each(['body','order','service','unfinalize','delete'] as const)('%s changes reject a late result atomically', async mutation => {
  const {work,chapter,volume} = await setup();
  const sibling = await chapters.create({workId:work.id,volumeId:volume.id});
  await chapters.finalize(chapter.id);
  const job = (await jobs.claimNext())!;
  if (mutation==='body') await chapters.saveBody(chapter.id,'作者已经修改。',0);
  if (mutation==='order') await chapters.reorder(work.id,[{volumeId:volume.id,chapterIds:[sibling.id,chapter.id]}]);
  if (mutation==='service') await db().run("UPDATE model_services SET revision=2 WHERE id='utility'");
  if (mutation==='unfinalize') await chapters.unfinalize(chapter.id);
  if (mutation==='delete') await chapters.remove(chapter.id);
  await expect(jobs.commit(job.id,job.executionToken!,async tx=>{
    await tx.run('UPDATE chapters SET summary=? WHERE id=?',['迟到结果',chapter.id]);
  })).rejects.toMatchObject({code:'AI_RESULT_STALE'});
  expect((await db().get('SELECT summary FROM chapters WHERE id=?',[chapter.id]))?.summary).toBeNull();
  if (['unfinalize','delete'].includes(mutation)) expect((await jobs.list(work.id))[0]).toMatchObject({status:'cancelled',executionToken:null});
});

test('S05b 继续 after D01 confirmation counts for this resume even when the acknowledgement could not be stored', async () => {
  const {work,chapter} = await setup();
  await prefs.set('aiNoticeAcknowledged', {});
  await chapters.finalize(chapter.id);
  const [first] = await jobs.list(work.id);
  expect(await jobs.claim(first.id)).toBeNull();
  expect((await jobs.list(work.id))[0]).toMatchObject({status:'paused',pauseReason:'notice'});
  // Without a stored or session acknowledgement the runner pauses again.
  await jobs.resume(first.id);
  expect(await jobs.claim(first.id)).toBeNull();
  expect((await jobs.list(work.id))[0]).toMatchObject({status:'paused',pauseReason:'notice'});
  // The author confirmed D01 but the preference write failed: this resume still proceeds.
  await jobs.resume(first.id, {acknowledgedHost:'example.test'});
  expect(await jobs.claim(first.id)).toMatchObject({id:first.id,status:'running'});
  expect(await prefs.get('aiNoticeAcknowledged')).toEqual({});
});

test('a failed (not paused) job emits jobs.failed once; the app toast offers 查看 → S05b unless S05b is open', async () => {
  const {work,chapter} = await setup();
  await chapters.finalize(chapter.id);
  const [first, second] = await jobs.list(work.id);
  const seen: unknown[] = []; const off = on('jobs.failed', event => { seen.push(event); });
  const claimed = await jobs.claim(first.id);
  await jobs.fail(first.id, claimed!.executionToken!, null, {interrupted:true});
  expect(seen).toEqual([]);
  await jobs.resume(first.id,{confirmInterrupted:true});
  const again = await jobs.claim(first.id);
  await jobs.fail(first.id, again!.executionToken!, null);
  expect(seen).toEqual([{workId:work.id,jobId:first.id,chapterId:chapter.id}]);
  off();

  useOverlay.setState({toast:null,dialogs:[],depth:0});
  const navigate = jest.fn(); let current: {name:string;params?:object} = {name:'Editor'};
  const stop = watchJobFailures({isReady:()=>true,getCurrentRoute:()=>current as never,navigate:navigate as never});
  emit('jobs.failed',{workId:work.id,jobId:second.id,chapterId:chapter.id});
  for (let n = 0; n < 20 && !useOverlay.getState().toast; n++) await new Promise(resolve => setTimeout(resolve, 0));
  const shown = useOverlay.getState().toast!;
  expect(shown.message).toBe('第 1 章的定稿整理没有完成');
  shown.action!.onPress();
  expect(navigate).toHaveBeenCalledWith('Jobs',{workId:work.id});
  useOverlay.setState({toast:null});
  current = {name:'Jobs',params:{workId:work.id}};
  emit('jobs.failed',{workId:work.id,jobId:second.id,chapterId:chapter.id});
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(useOverlay.getState().toast).toBeNull();
  stop();
});
