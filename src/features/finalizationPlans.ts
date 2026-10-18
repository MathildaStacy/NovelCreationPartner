/** Author preview and runner read the same immutable, durable ContextPlans. No model calls here. */
import { db } from '../data/db';
import { createTaskContextPlan, fingerprint, type ContextPlan, type ContextBlock } from '../ai/context';
import { FINALIZATION_POLICIES, finalizationSystem, type AnalysisEntry, type AnalysisSource } from '../ai/tasks/finalization';
import { changedParagraphs, paragraphs, splitAnalysisChunks } from '../ai/tasks/finalizationChunks';
import { countChars } from '../utils/text';
import { nowIso, uuid } from '../utils/id';
import * as chapters from './chapters';
import * as entries from './entries';
import * as works from './works';
import * as modelServices from './modelServices';
import { inputFingerprintIn } from './jobs';
import { AppError } from './errors';
import type { ID, JobKind, Relation } from './types';
export interface PlannedAnalysisChunk {
  index:number; offset:number; text:string; contextPlan:Readonly<ContextPlan>; sources:AnalysisSource[]; entries:AnalysisEntry[]; summaryLimit:number;
  cachedResult?:unknown;
}
export interface PlannedAnalysisTask { kind:JobKind; serviceId:ID|null; serviceRevision:number|null; model:string; chunks:PlannedAnalysisChunk[]; }
export interface FinalizationPreview {
  id:ID; chapterId:ID; workId:ID; sourceVersionId:ID; inputFingerprint:string; dependencyRevision:number;
  sourceBody:string; summaryBefore:string|null; tasks:PlannedAnalysisTask[]; plannedCalls:number; maxPosts:number;
  maxReservedOutputTokens:number; estimatedInputTokens:number; eligible:boolean; pauseReason:'no_service'|'budget'|null; reason:string|null;
  incremental:boolean; maxOutputTokens:number; routes:{kind:JobKind;name:string;model:string;calls:number}[];
  bindingFingerprint:string;
  batchRequired:boolean; batchSize:6; firstBatch:{start:number;end:number}|null;
}
function frozen<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;}
export const FINALIZATION_KINDS:readonly JobKind[]=['summarize','extract_memory','detect_conflicts'];
/** Pure matching for inputs that were actually included; partial aliases never become entity matches. */
const mentions=(entry:AnalysisEntry,text:string)=>[entry.name,...entry.aliases].some(name=>name&&text.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
export async function previewFinalization(chapterId:ID,options:{kinds?:readonly JobKind[];boundFinalized?:boolean}={}):Promise<Readonly<FinalizationPreview>> {
  const chapter=await chapters.get(chapterId);
  if(chapter.kind!=='main'||!countChars(chapter.body))throw new AppError('VALIDATION','只有有正文内容的正文章节可以定稿分析。');
  const latest=await db().get<{id:string;body:string}>('SELECT id,body FROM chapter_versions WHERE chapter_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',[chapterId]);
  const bound=options.boundFinalized&&chapter.finalizedVersionId?await db().get<{id:string;body:string}>('SELECT id,body FROM chapter_versions WHERE id=? AND chapter_id=?',[chapter.finalizedVersionId,chapterId]):undefined;
  if(options.boundFinalized&&(!bound||bound.body!==chapter.body||chapter.state!=='finalized'))throw new AppError('AI_RESULT_STALE','当前正文不再对应这个定稿版本。');
  const source={version:{id:bound?.id??(latest?.body===chapter.body?latest.id:uuid())}};
  const base=await db().transaction(async tx=>({
    work:await works.get(chapter.workId,tx),
    input:await inputFingerprintIn(tx,chapter.workId,chapterId,source.version.id,chapter.body),
    revision:(await tx.get<{context_revision:number}>('SELECT context_revision FROM works WHERE id=?',[chapter.workId]))!.context_revision,
    baseline:await tx.get<{body:string}>(`SELECT v.body FROM chapters c JOIN chapter_versions v ON v.id=c.finalized_version_id WHERE c.id=? AND c.finalized_version_id!=?`,[chapterId,source.version.id]),
  }));
  const {work}=base;
  // An unanalyzed version or unreviewed old suggestions cannot be a coverage baseline.
  const covered=await db().get(`SELECT j.id FROM jobs j JOIN chapters c ON c.id=j.chapter_id WHERE j.chapter_id=? AND j.kind='extract_memory' AND j.status='done' AND j.source_version_id=c.finalized_version_id LIMIT 1`,[chapterId]);
  const pending=await db().get("SELECT id FROM memory_proposals WHERE chapter_id=? AND status='pending' LIMIT 1",[chapterId]);
  if(!covered||pending)base.baseline=undefined;
  const settings=await db().get<{value:string}>("SELECT value FROM preferences WHERE key='serviceBindings'");let bindings:Record<string,string|null>={};try{bindings=JSON.parse(settings?.value??'{}');}catch{/* defaults */}
  const defaultId=(await db().get<{id:string}>('SELECT id FROM model_services WHERE is_default=1'))?.id;
  const resolve=async(route:'utility'|'review')=>{const id=bindings[route]??defaultId;if(!id)return null;try{return await modelServices.get(id);}catch{return null;}};
  const utility=await resolve('utility'),review=await resolve('review');
  const directory=await entries.list(work.id);
  const formalStates=new Set(['CONFIRMED','ESTABLISHED','CONFLICTED']);
  const formalIds=new Set(directory.filter(entry=>formalStates.has(entry.state)).map(entry=>entry.id));
  const formalRelation=(relation:Relation)=>formalStates.has(relation.state)&&formalIds.has(relation.fromEntryId)&&formalIds.has(relation.toEntryId);
  const known:AnalysisEntry[]=await Promise.all(directory.map(async item=>{const detail=await entries.get(item.id,{atChapterId:chapter.id});return {id:detail.id,type:detail.type,name:detail.name,aliases:detail.aliases};}));
  const order=await chapters.listNumbered(db(),work.id),at=order.findIndex(ch=>ch.id===chapterId);
  const intentional=await db().all<{fingerprint:string;a_quote:string;b_quote:string;note:string|null}>("SELECT fingerprint,a_quote,b_quote,note FROM conflicts WHERE work_id=? AND status='intentional' ORDER BY fingerprint",[work.id]);
  const full=splitAnalysisChunks(chapter.body),changed=splitAnalysisChunks(chapter.body,changedParagraphs(chapter.body,base.baseline?.body??null));
  const cached=await db().all<{id:string;context_plan:string;result:string}>(`SELECT c.id,c.context_plan,c.result FROM job_chunks c JOIN jobs j ON j.id=c.job_id
    WHERE j.work_id=? AND j.chapter_id=? AND j.source_version_id=? AND j.input_fingerprint=? AND c.status='done' AND c.result IS NOT NULL`,[work.id,chapterId,source.version.id,base.input]);
  const cachedByDigest=new Map(cached.map(c=>[(JSON.parse(c.context_plan) as ContextPlan).dependencyFingerprint,JSON.parse(c.result) as unknown]));
  const tasks:PlannedAnalysisTask[]=[];let errorReason:string|null=null;
  for(const kind of options.kinds??FINALIZATION_KINDS) {
    const service=kind==='detect_conflicts'?review:utility;
    const selected=kind==='extract_memory'?changed:full;
    const task:PlannedAnalysisTask={kind,serviceId:service?.id??null,serviceRevision:service?.revision??null,model:service?.model??'',chunks:[]};tasks.push(task);
    if(!service)continue;
    for(const [index,chunk] of selected.entries()) {
      const sources:AnalysisSource[]=[{id:`chapter:${chapterId}`,label:chapter.title,text:chunk.text,entryId:null}];
      const blocks:ContextBlock[]=[{sourceId:`work:${work.id}`,sourceVersion:String(base.revision),state:'CONFIRMED',atChapterId:chapterId,text:`作品：${work.title??'未命名'}\n题材：${work.genre??'未设置'}\n梗概：${work.premise}`,required:true,priority:3}];
      if(kind!=='summarize') {
        const related=known.filter(e=>mentions(e,chunk.text));
        // Keep the complete directory local for deterministic validation, while the model
        // receives only names in this block or the endpoints of their captured relations.
        const directoryIds=new Set(related.map(e=>e.id));
        for(const entity of related){
          const detail=await entries.get(entity.id,{atChapterId:chapterId});
          for(const relation of detail.relations.filter(formalRelation)){directoryIds.add(relation.fromEntryId);directoryIds.add(relation.toEntryId);}
        }
        const relevantDirectory=known.filter(e=>directoryIds.has(e.id));
        blocks.push({sourceId:'entry-directory',sourceVersion:String(base.revision),state:'CONFIRMED',atChapterId:chapterId,text:`本块相关条目名称及别名（只用于实体匹配，不能作为事实；完整目录留在本地校验）：\n${relevantDirectory.map(e=>`${e.id} ${e.type} ${e.name} ${e.aliases.join('、')}`).join('\n')}\n字段白名单：${JSON.stringify(entries.ENTRY_FIELDS)}`,required:true,priority:3});
        const seenRelations=new Set<string>();
        for(const entity of related) {
          const detail=await entries.get(entity.id,{atChapterId:chapterId});
          if(!['CONFIRMED','ESTABLISHED','CONFLICTED'].includes(detail.state))continue;
          for(const fact of detail.facts.filter(f=>['CONFIRMED','ESTABLISHED','CONFLICTED'].includes(f.state))) {
            sources.push({id:`fact:${fact.id}`,label:`${detail.name}的${entries.FIELD_LABELS[fact.field]??fact.field}`,text:fact.value,entryId:detail.id});
            blocks.push({sourceId:`fact:${fact.id}`,sourceVersion:fact.id,state:fact.state,atChapterId:chapterId,text:`${detail.name} ${entries.FIELD_LABELS[fact.field]??fact.field}：${fact.value}\n原值证据：${fact.value}；生效起：${fact.fromChapterId??'全局'}；生效止：${fact.toChapterId??'无'}`,required:true,priority:4});
          }
          for(const relation of detail.relations) {
            if(seenRelations.has(relation.id)||!formalRelation(relation))continue;seenRelations.add(relation.id);
            const text=`${relation.fromName} —${relation.kind}→ ${relation.toName}${relation.note?`：${relation.note}`:''}`;
            sources.push({id:`relation:${relation.id}`,label:'已确认关系',text,entryId:detail.id});
            blocks.push({sourceId:`relation:${relation.id}`,sourceVersion:fingerprint(relation),state:relation.state,atChapterId:chapterId,text,required:true,priority:4});
          }
        }
        // Recheck other paragraphs mentioning the same entities so a changed assertion is not isolated from its consequences.
        if(kind==='detect_conflicts')for(const p of paragraphs(chapter.body)) {
          if(p.offset>=chunk.offset&&p.offset<chunk.offset+chunk.text.length||!related.some(e=>mentions(e,p.text)))continue;
          const id=`chapter-extra:${p.offset}`;sources.push({id,label:`${chapter.title}关联段落`,text:p.text,entryId:null});
          blocks.push({sourceId:id,sourceVersion:source.version.id,state:'FINALIZED',atChapterId:chapterId,text:`关联正文；来源 ${id}：\n${p.text}`,required:true,priority:4});
        }
        for(const prior of order.slice(Math.max(0,at-3),at))if(prior.summary)blocks.push({sourceId:`summary:${prior.id}`,sourceVersion:fingerprint(prior.summary),state:'SUMMARY',atChapterId:prior.id,text:`${prior.title} 摘要（不可作为逐字证据）：${prior.summary}`,required:false,priority:7});
        if(kind==='detect_conflicts'&&intentional.length)blocks.push({sourceId:'intentional',sourceVersion:fingerprint(intentional),state:'AUTHOR_DECISION',atChapterId:chapterId,text:`作者已确认不是问题，不要重复报告：\n${intentional.map(item=>`${item.a_quote} / ${item.b_quote}；${item.note??'有意为之'}`).join('\n')}`,required:true,priority:4});
      }
      const summaryLimit=selected.length===1?150:Math.floor((150-(selected.length-1))/selected.length);
      let system=finalizationSystem(kind);
      if(kind==='summarize'&&selected.length>1)system+=` 本次是第 ${index+1}/${selected.length} 块，仅输出本块事件的完整短句，最多 ${summaryLimit} 字；应用会按原文顺序拼接，不推测其他块。`;
      try {
        const plan=createTaskContextPlan({planId:uuid(),workId:work.id,sourceVersion:source.version.id,dependencies:{input:base.input,revision:base.revision,version:source.version.id,chunk:chunk.offset},serviceSnapshot:{...service,pricingVersion:null},policy:FINALIZATION_POLICIES[kind],system,messages:[{role:'user',content:`【绑定的定稿正文；来源 chapter:${chapterId}；原文偏移 ${chunk.offset}；第 ${index+1}/${selected.length} 块】\n${chunk.text}`}],blocks,stream:false});
        const cachedResult=cachedByDigest.get(plan.dependencyFingerprint);
        task.chunks.push({index,offset:chunk.offset,text:chunk.text,contextPlan:plan,sources,entries:known,summaryLimit,...(cachedResult===undefined?{}:{cachedResult})});
      }catch(error){if(error instanceof AppError&&error.code==='AI_CONTEXT_TOO_LONG'){errorReason=error.message;break;}throw error;}
    }
  }
  const all=tasks.flatMap(t=>t.chunks).filter(c=>c.cachedResult===undefined),outputs=all.map(c=>c.contextPlan.maxOutputTokens),maximum=Math.max(0,...outputs),plannedCalls=all.length;
  const missing=tasks.some(t=>!t.serviceId),over=full.some(c=>countChars(c.text)>12000);
  const preview:FinalizationPreview={id:uuid(),chapterId,workId:work.id,sourceVersionId:source.version.id,inputFingerprint:base.input,dependencyRevision:base.revision,bindingFingerprint:fingerprint({bindings:settings?.value??null,defaultId:defaultId??null}),batchRequired:plannedCalls>6,batchSize:6,firstBatch:plannedCalls?{start:1,end:Math.min(6,plannedCalls)}:null,sourceBody:chapter.body,summaryBefore:chapter.summary,tasks,plannedCalls,maxPosts:plannedCalls+2,maxReservedOutputTokens:outputs.reduce((a,b)=>a+b,0)+2*maximum,estimatedInputTokens:all.reduce((n,c)=>n+c.contextPlan.estimatedInputTokens,0),eligible:!missing&&!over&&!errorReason,pauseReason:missing?'no_service':over||errorReason?'budget':null,reason:missing?'请先配置本次任务需要的服务':errorReason??(over?'本次分析存在过长单段，请拆分该段后重新预览；未发送请求。':null),incremental:!!base.baseline,maxOutputTokens:maximum,routes:tasks.map(t=>({kind:t.kind,name:(t.kind==='detect_conflicts'?review:utility)?.name??'未绑定',model:t.model,calls:t.chunks.filter(c=>c.cachedResult===undefined).length}))};
  await db().transaction(async tx=>{
    if(base.input!==await inputFingerprintIn(tx,work.id,chapterId,source.version.id,chapter.body)||(await tx.get<{body:string}>('SELECT body FROM chapters WHERE id=?',[chapterId]))?.body!==chapter.body)throw new AppError('AI_RESULT_STALE','预览期间正文或设定变化，请重新预览。');
    for(const task of tasks)if(task.serviceId&&(await tx.get<{revision:number}>('SELECT revision FROM model_services WHERE id=?',[task.serviceId]))?.revision!==task.serviceRevision)throw new AppError('AI_RESULT_STALE','模型服务已变化，请重新预览。');
    const used=nowIso();
    await tx.run('INSERT INTO finalization_plans(id,chapter_id,source_version_id,input_fingerprint,body,created_at,last_used_at) VALUES(?,?,?,?,?,?,?)',[preview.id,chapterId,source.version.id,base.input,JSON.stringify(preview),used,used]);
    for(const chunk of cached)await tx.run('UPDATE job_chunks SET last_used_at=? WHERE id=?',[used,chunk.id]);
    await pruneFinalizationStorageIn(tx,preview.id);
  });
  return frozen(preview);
}
export function decodePreview(raw:string):Readonly<FinalizationPreview>{return frozen(JSON.parse(raw) as FinalizationPreview);}
export function validatePreviewPolicy(plan:FinalizationPreview):boolean{return plan.tasks.every(task=>task.chunks.every(chunk=>fingerprint(chunk.contextPlan.policy)===fingerprint(FINALIZATION_POLICIES[task.kind])&&chunk.contextPlan.requests[0].system.startsWith(finalizationSystem(task.kind))));}

/** Bounded disposable payloads; active checkpoints, evidence versions and job audit rows are retained. */
export async function pruneFinalizationStorageIn(tx:import('../data/db').Db,keepPreviewId?:ID):Promise<void> {
  const limit=20*1024*1024;
  const previews=await tx.all<{id:string;bytes:number;last_used_at:string}>(`SELECT p.id,p.last_used_at,length(CAST(p.body AS BLOB)) bytes FROM finalization_plans p
    WHERE NOT EXISTS(SELECT 1 FROM jobs j WHERE j.plan_id=p.id AND j.status IN ('queued','running','paused','failed'))`);
  const chunks=await tx.all<{id:string;bytes:number;last_used_at:string}>(`SELECT c.id,c.last_used_at,length(CAST(c.context_plan AS BLOB))+length(CAST(c.analysis_context AS BLOB))+coalesce(length(CAST(c.result AS BLOB)),0) bytes
    FROM job_chunks c JOIN jobs j ON j.id=c.job_id WHERE j.status IN ('done','cancelled')`);
  let bytes=0;
  const payloads=[...previews.map(row=>({...row,table:'finalization_plans'})),...chunks.map(row=>({...row,table:'job_chunks'}))].sort((a,b)=>Number(b.id===keepPreviewId)-Number(a.id===keepPreviewId)||b.last_used_at.localeCompare(a.last_used_at));
  for(const row of payloads){if(bytes+row.bytes<=limit||row.id===keepPreviewId){bytes+=row.bytes;continue;}await tx.run(`DELETE FROM ${row.table} WHERE id=?`,[row.id]);}
}
