import { db, setDb } from '../../src/data/db';
import * as chapters from '../../src/features/chapters';
import * as works from '../../src/features/works';
import * as entries from '../../src/features/entries';
import * as relations from '../../src/features/relations';
import * as proposals from '../../src/features/proposals';
import * as jobs from '../../src/features/jobs';
import { insertRelationChangesIn, validateRelationChanges } from '../../src/features/relationExtraction';
import { freshDb, tickingClock } from '../helpers/db';

beforeEach(async()=>{tickingClock();await freshDb();});
afterEach(async()=>{await db().close();setDb(null);});
async function setup(kind:'add'|'update'|'retire'='add') {
  const work=await works.create({premise:'两个人物关系的变化'});
  const volume=(await chapters.list(work.id))[0].volume;
  const prior=await chapters.create({workId:work.id,volumeId:volume.id});
  const chapter=await chapters.create({workId:work.id,volumeId:volume.id});
  const body='小雨与阿风从此结为盟友。';await chapters.saveBody(chapter.id,body,0);
  const a=await entries.create({workId:work.id,type:'character',name:'小雨',aliases:['雨儿']});
  const b=await entries.create({workId:work.id,type:'character',name:'阿风'});
  const old=kind==='add'?null:await relations.upsert({fromEntryId:a.id,toEntryId:b.id,kind:'盟友',note:'临时联手',fromChapterId:prior.id});
  await chapters.finalize(chapter.id);
  const job=(await jobs.list(work.id)).find(item=>item.kind==='extract_memory')!;
  await db().run("UPDATE jobs SET status='done' WHERE id=?",[job.id]);
  const raw=JSON.stringify({changes:[],relations:[{fromName:'雨儿',toName:'阿风',kind,relationKind:'盟友',before:old?'临时联手':null,after:'共同守护古剑',evidence:body,confidence:'high'}]});
  const changes=validateRelationChanges(raw,{body,entries:[{id:a.id,type:'character',name:a.name,aliases:a.aliases},{id:b.id,type:'character',name:b.name,aliases:[]}]});
  await db().transaction(tx=>insertRelationChangesIn(tx,changes,{workId:work.id,chapterId:chapter.id,jobId:job.id,versionId:job.sourceVersionId!}));
  return {work,prior,chapter,a,b,old,raw,body};
}
test('strict evidence, unique endpoints and same-work references are required',async()=>{
  const {raw,body,a,b}=await setup();
  const directory=[{id:a.id,type:'character' as const,name:a.name,aliases:a.aliases},{id:b.id,type:'character' as const,name:b.name,aliases:[]}];
  expect(()=>validateRelationChanges(raw.replace(body,'不存在的引用'),{body,entries:directory})).toThrow();
  expect(()=>validateRelationChanges(raw,{body,entries:[...directory,{...directory[0],id:'ambiguous'}]})).toThrow();
  const other=await works.create({premise:'另一部作品'});
  const outsider=await entries.create({workId:other.id,type:'character',name:'别处的人'});
  const changes=validateRelationChanges(raw,{body,entries:directory});
  await expect(db().transaction(tx=>insertRelationChangesIn(tx,[{...changes[0],toEntryId:outsider.id}],{workId:a.workId,chapterId:'x',jobId:'x',versionId:'x'}))).rejects.toMatchObject({code:'AI_RESULT_STALE'});
});
test.each(['add','update','retire'] as const)('author %s keeps chapter history and can safely undo',async kind=>{
  const {work,prior,chapter,a,b,old}=await setup(kind);
  const [proposal]=await proposals.list(work.id);
  expect(proposal.entryType).toBe('relation');
  expect((await relations.list(a.id,{atChapterId:chapter.id})).length).toBe(old?1:0);
  await proposals.accept(proposal.id);
  const current=await relations.list(a.id,{atChapterId:chapter.id});
  if(kind==='retire')expect(current).toEqual([]);
  else expect(current).toMatchObject([{fromEntryId:a.id,toEntryId:b.id,note:'共同守护古剑',state:'ESTABLISHED'}]);
  const before=await relations.list(a.id,{atChapterId:prior.id});
  expect(before.length).toBe(old?1:0);
  if(old)expect(before[0].note).toBe('临时联手');
  await proposals.undo(proposal.id);
  const restored=await relations.list(a.id,{atChapterId:chapter.id});
  expect(restored.length).toBe(old?1:0);
  if(old)expect(restored[0]).toMatchObject({id:old.id,note:'临时联手',toChapterId:null});
});
test('a later author edit blocks undo instead of replacing the new relationship',async()=>{
  const {work,a}=await setup();const [proposal]=await proposals.list(work.id);
  await proposals.accept(proposal.id);
  const [relation]=await relations.list(a.id);
  await relations.upsert({...relation,note:'作者后来写的说明'});
  await expect(proposals.undo(proposal.id)).rejects.toMatchObject({code:'AI_RESULT_STALE'});
  expect((await relations.list(a.id))[0].note).toBe('作者后来写的说明');
});

test('adding a relationship in an earlier gap preserves a future chapter phase',async()=>{
  const work=await works.create({premise:'关系的不同阶段'});
  const volume=(await chapters.list(work.id))[0].volume;
  const earlier=await chapters.create({workId:work.id,volumeId:volume.id});
  const future=await chapters.create({workId:work.id,volumeId:volume.id});
  const a=await entries.create({workId:work.id,type:'character',name:'小雨'});
  const b=await entries.create({workId:work.id,type:'character',name:'阿风'});
  const futureRelation=await relations.upsert({fromEntryId:a.id,toEntryId:b.id,kind:'盟友',note:'生死相托',fromChapterId:future.id});
  const body='小雨与阿风暂时结为盟友。';await chapters.saveBody(earlier.id,body,0);
  await chapters.finalize(earlier.id);
  const job=(await jobs.list(work.id)).find(item=>item.kind==='extract_memory')!;
  await db().run("UPDATE jobs SET status='done' WHERE id=?",[job.id]);
  await db().transaction(tx=>insertRelationChangesIn(tx,[{fromEntryId:a.id,toEntryId:b.id,fromName:a.name,toName:b.name,kind:'add',relationKind:'盟友',before:null,after:'临时联手',evidence:body,evidenceOffset:0,confidence:'high'}],{workId:work.id,chapterId:earlier.id,jobId:job.id,versionId:job.sourceVersionId!}));
  const [proposal]=await proposals.list(work.id);await proposals.accept(proposal.id);
  expect(await relations.list(a.id,{atChapterId:earlier.id})).toMatchObject([{note:'临时联手',toChapterId:earlier.id}]);
  expect(await relations.list(a.id,{atChapterId:future.id})).toMatchObject([{id:futureRelation.id,note:'生死相托'}]);
  await proposals.undo(proposal.id);
  expect(await relations.list(a.id,{atChapterId:earlier.id})).toEqual([]);
  expect(await relations.list(a.id,{atChapterId:future.id})).toMatchObject([{id:futureRelation.id,note:'生死相托'}]);
});

test('removing accepted relation evidence only creates a version-bound author retirement review and safe undo',async()=>{
  const {work,chapter,a}=await setup();const [original]=await proposals.list(work.id);await proposals.accept(original.id);
  await chapters.saveBody(chapter.id,'小雨与阿风各自回家。',0);await chapters.finalize(chapter.id);
  const job=(await jobs.list(work.id)).filter(j=>j.kind==='extract_memory').at(-1)!;
  await db().run("UPDATE jobs SET status='done' WHERE id=?",[job.id]);
  await db().transaction(tx=>proposals.proposeRemovedEvidenceIn(tx,{workId:work.id,chapterId:chapter.id,versionId:job.sourceVersionId!,jobId:job.id,body:'小雨与阿风各自回家。'}));
  const deletion=(await proposals.list(work.id)).find(p=>p.origin==='deletion')!;
  expect(deletion).toMatchObject({entryType:'relation',kind:'retire',evidenceVersionId:original.evidenceVersionId,status:'pending',before:'共同守护古剑'});
  expect(await relations.list(a.id,{atChapterId:chapter.id})).toHaveLength(1);
  await proposals.accept(deletion.id);expect(await relations.list(a.id,{atChapterId:chapter.id})).toHaveLength(0);
  await proposals.undo(deletion.id);expect(await relations.list(a.id,{atChapterId:chapter.id})).toMatchObject([{note:'共同守护古剑'}]);
});

test('removed relation evidence cannot retire a relation the author edited since extraction',async()=>{
  const {work,chapter,a}=await setup();const [original]=await proposals.list(work.id);await proposals.accept(original.id);
  await chapters.saveBody(chapter.id,'小雨与阿风各自回家。',0);await chapters.finalize(chapter.id);
  const job=(await jobs.list(work.id)).filter(j=>j.kind==='extract_memory').at(-1)!;
  await db().run("UPDATE jobs SET status='done' WHERE id=?",[job.id]);
  await db().transaction(tx=>proposals.proposeRemovedEvidenceIn(tx,{workId:work.id,chapterId:chapter.id,versionId:job.sourceVersionId!,jobId:job.id,body:'小雨与阿风各自回家。'}));
  const deletion=(await proposals.list(work.id)).find(p=>p.origin==='deletion')!;
  const [relation]=await relations.list(a.id,{atChapterId:chapter.id});await relations.upsert({...relation,note:'作者重新确认合作'});
  await expect(proposals.accept(deletion.id)).rejects.toMatchObject({code:'AI_RESULT_STALE'});
  expect(await relations.list(a.id,{atChapterId:chapter.id})).toMatchObject([{note:'作者重新确认合作'}]);
});
