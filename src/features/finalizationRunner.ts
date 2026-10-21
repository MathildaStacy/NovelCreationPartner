/** Foreground durable chunks. The exact approved plan is sent, never reconstructed here. */
import { fingerprint } from '../ai/context';
import { executeTaskPlan } from '../ai/runtime';
import { validateDetectedConflicts, validateExtraction, validateSummary, type ValidatedChange, type ValidatedConflict } from '../ai/tasks/finalization';
import { aiFailure } from '../ai/providers/errors';
import { nowIso, uuid } from '../utils/id';
import { AiCallError, AppError } from './errors';
import * as jobs from './jobs';
import * as entries from './entries';
import * as modelServices from './modelServices';
import * as usage from './aiUsage';
import * as proposals from './proposals';
import * as passages from './passages';
import { runToolChunk, type ToolChunkResult } from './conflictToolLoop';
import { validateRelationChanges,insertRelationChangesIn,type RelationChange } from './relationExtraction';
import { on } from './events';
import type { AiErrorInfo, Job } from './types';
let active:Promise<Job|null>|null=null;
export function runNext(signal:AbortSignal):Promise<Job|null>{if(active)return active;if(signal.aborted)return Promise.resolve(null);const next=run(signal);active=next;next.finally(()=>{if(active===next)active=null;}).catch(()=>{});return next;}
export async function drain(signal:AbortSignal):Promise<void>{while(!signal.aborted&&await runNext(signal)){/* explicit author-authorized worker */}}
interface ChunkResult {summary?:string;changes?:ValidatedChange[];relations?:RelationChange[];conflicts?:ValidatedConflict[];}
async function run(external:AbortSignal):Promise<Job|null>{
  const job=await jobs.claimNext();if(!job)return null;const token=job.executionToken!;
  const controller=new AbortController();const abort=()=>controller.abort();external.addEventListener('abort',abort,{once:true});if(external.aborted)abort();
  let context={protocol:'openai_responses' as const,serviceName:'模型服务',model:'模型',baseUrl:'https://example.invalid'} as Parameters<typeof aiFailure>[1];let invalidated=false;
  const changed=()=>{jobs.capture(job.id).then(value=>{if(value.job.executionToken!==token){invalidated=true;controller.abort();}}).catch(()=>{invalidated=true;controller.abort();});};
  const off=[on('jobs.changed',changed),on('chapters.changed',changed),on('entries.changed',changed),on('work.removed',changed),on('work.updated',changed),on('chapter.saved',changed),on('services.changed',changed),on('prefs.changed',changed)];
  try{
    let captured=await jobs.capture(job.id);const {chapter,work,service}=captured;
    context={protocol:service.protocol,serviceName:service.name,model:service.model,baseUrl:service.baseUrl};
    const outputs:ChunkResult[]=[];
    // Once the service rejected tools in this run, later chunks go straight to the prefetch-only request.
    let toolsRejected=false;
    for(const chunk of captured.chunks){
      if(chunk.status==='done'){outputs.push(chunk.result as ChunkResult);continue;}
      if(controller.signal.aborted)throw new AppError('AI_CANCELLED','已停止分析');
      captured=await jobs.capture(job.id);
      const current=captured.chunks.find(c=>c.id===chunk.id)!;
      if(!current.authorized){await jobs.fail(job.id,token,null,{reason:'batch'});return (await jobs.list(job.workId)).find(item=>item.id===job.id)??job;}
      const first=current.firstStartedAt===null?Date.now():Date.parse(current.firstStartedAt);
      const budget={...captured.budget,deadlineAt:Math.min(captured.budget.deadlineAt,Number.isFinite(first)?first+5*60000:0)};
      if(Date.now()>=budget.deadlineAt)throw new AppError('AI_BUDGET_EXCEEDED','该请求块的五分钟期限已用尽，请重新预览并确认后分析。');
      const retrieval=job.kind==='detect_conflicts'?current.context.retrieval:undefined;
      if(retrieval?.tools){
        const limits=retrieval.tools;
        const state:jobs.ToolLoopState=current.toolState??{session:retrieval.session,turns:[],sources:[],rounds:0,...(toolsRejected?{fallback:true}:{})};
        const looped:ToolChunkResult=await modelServices.withGeneration(service.id,service.revision,controller.signal,scope=>runToolChunk({jobId:job.id,token,operationId:job.operationId!,chunkId:chunk.id,candidateOffset:chunk.candidateOffset,
          plan:chunk.plan,budget,baseSources:current.context.sources,limits,state,signal:scope.signal,providerFactory:scope.providerFactory,
          current:async():Promise<{attempts:number;tools:jobs.ToolBudgetState}>=>{const fresh=await jobs.capture(job.id);if(fresh.job.executionToken!==token)throw new AppError('AI_RESULT_STALE','定稿任务已变化。');return {attempts:fresh.chunks.find(c=>c.id===chunk.id)!.attempts,tools:fresh.tools};}}));
        toolsRejected||=looped.toolsDropped;
        const output={conflicts:validateDetectedConflicts(looped.text,looped.sources,`chapter:${chapter.id}`)};
        await jobs.checkpoint(job.id,token,chunk.id,output);outputs.push(output);
        continue;
      }
      const generated=await modelServices.withGeneration(service.id,service.revision,controller.signal,scope=>executeTaskPlan({logicalRequestId:job.operationId!,operationKey:chunk.id,budgetCandidateOffset:chunk.candidateOffset,attemptNumberOffset:current.attempts,plan:chunk.plan,budget,signal:scope.signal,providerFactory:scope.providerFactory,ledger:usage.ledger}));
      const candidate=generated.candidates[0];if(candidate.error)throw new AiCallError(candidate.error);
      let output:ChunkResult;
      if(job.kind==='summarize')output={summary:validateSummary(candidate.text,chunk.context.summaryLimit)};
      else if(job.kind==='extract_memory')output={changes:validateExtraction(candidate.text,{body:chunk.context.text,entries:chunk.context.entries,allowedFields:entries.ENTRY_FIELDS}).map(c=>({...c,evidenceOffset:c.evidenceOffset+chunk.context.offset})),relations:validateRelationChanges(candidate.text,{body:chunk.context.text,entries:chunk.context.entries}).map(c=>({...c,evidenceOffset:c.evidenceOffset+chunk.context.offset}))};
      else output={conflicts:validateDetectedConflicts(candidate.text,chunk.context.sources,`chapter:${chapter.id}`)};
      await jobs.checkpoint(job.id,token,chunk.id,output);outputs.push(output);
    }
    await jobs.commit(job.id,token,async tx=>{
      if(job.kind==='summarize'){
        const summary=validateSummary(outputs.map(o=>o.summary??'').join(' '));
        if((await tx.get<{summary:string|null}>('SELECT summary FROM chapters WHERE id=?',[chapter.id]))?.summary!==captured.summaryBefore)throw new AppError('AI_RESULT_STALE','作者已编辑摘要，旧分析未覆盖');
        await tx.run('UPDATE chapters SET summary=?,summary_source_version_id=? WHERE id=?',[summary,job.sourceVersionId,chapter.id]);
      }else if(job.kind==='extract_memory'){
        const changes=[...new Map(outputs.flatMap(o=>o.changes??[]).map(change=>[JSON.stringify([change.targetEntryId??change.targetName,change.targetType,change.field,change.kind,change.after]),change])).values()];
        const relationChanges=[...new Map(outputs.flatMap(o=>o.relations??[]).map(change=>[JSON.stringify([change.fromEntryId,change.toEntryId,change.relationKind,change.kind,change.after]),change])).values()];
        if(changes.length+relationChanges.length>30)throw new AppError('AI_FORMAT','合并后的字段与关系提案超过 30 项，请缩小分析范围。');
        for(const change of changes)await tx.run(`INSERT OR IGNORE INTO memory_proposals(id,work_id,chapter_id,kind,target_type,target_entry_id,target_name,field,before_value,after_value,evidence,evidence_offset,confidence,status,created_at,source_job_id,evidence_version_id,origin) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,'extraction')`,[uuid(),work.id,chapter.id,change.kind,change.targetType,change.targetEntryId,change.targetName,change.field,change.before,change.after,change.evidence,change.evidenceOffset,change.confidence,nowIso(),job.id,job.sourceVersionId]);
        await insertRelationChangesIn(tx,relationChanges,{workId:work.id,chapterId:chapter.id,jobId:job.id,versionId:job.sourceVersionId!});
        await proposals.proposeRemovedEvidenceIn(tx,{workId:work.id,chapterId:chapter.id,versionId:job.sourceVersionId!,jobId:job.id,body:captured.sourceVersionBody});
      }else{
        // History prose is identified durably by chapter + quote; the temporary p ref never leaves this job.
        const durableB=(conflict:ValidatedConflict)=>conflict.b.passage?`chapter:${conflict.b.passage.chapterId}`:conflict.b.source;
        const combined=new Map(outputs.flatMap(o=>o.conflicts??[]).map(conflict=>[fingerprint({type:conflict.type,a:conflict.a.source,aQuote:conflict.a.quote,b:durableB(conflict),bQuote:conflict.b.quote}),conflict]));
        if(combined.size>10)throw new AppError('AI_FORMAT','合并后的冲突超过 10 项，请缩小分析范围。');
        for(const [digest,conflict] of combined){
          if(await tx.get("SELECT id FROM conflicts WHERE work_id=? AND fingerprint=? AND status IN ('open','later','intentional')",[work.id,digest]))continue;
          // Final check inside the commit: allowed scope, quote really in the bound source, source unchanged since it was read.
          const history=conflict.b.passage?await passages.verifyPassageQuoteIn(tx,work.id,chapter.id,conflict.b.passage,conflict.b.quote):null;
          const sameChapter=conflict.b.source.startsWith('chapter-extra:');
          await tx.run(`INSERT OR IGNORE INTO conflicts(id,work_id,chapter_id,entry_id,type,severity,a_label,a_ref,a_quote,b_label,b_ref,b_quote,explanation,suggestions,status,fingerprint,created_at,source_job_id,a_version_id,a_offset,b_version_id,b_source_hash,b_offset,b_anchor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?,?,?,?,?,?,?)`,[uuid(),work.id,chapter.id,conflict.entryId,conflict.type,conflict.severity,conflict.a.label,conflict.a.source,conflict.a.quote,history?history.label:conflict.b.label,durableB(conflict),conflict.b.quote,conflict.explanation,JSON.stringify(conflict.suggestions),digest,nowIso(),job.id,
            job.sourceVersionId,conflict.a.offset??null,history?history.versionId:sameChapter?job.sourceVersionId:null,history?.sourceHash??null,history?history.offset:sameChapter?conflict.b.offset??null:null,history?JSON.stringify(history.anchor):null]);
        }
      }
    });
  }catch(error){
    const info:AiErrorInfo=error instanceof AiCallError?error.info:error instanceof AppError?{...aiFailure('AI_FORMAT',context).info,code:error.code,message:error.message}:aiFailure('AI_NETWORK',context).info;
    await jobs.fail(job.id,token,info,{interrupted:['AI_CANCELLED','AI_NETWORK','AI_TIMEOUT','AI_STREAM_INTERRUPTED'].includes(info.code),reason:invalidated?'stale':info.code==='AI_BUDGET_EXCEEDED'||info.code==='AI_CONTEXT_TOO_LONG'?'budget':info.code==='AI_RESULT_STALE'?'stale':undefined});
  }finally{off.forEach(release=>release());external.removeEventListener('abort',abort);}
  return (await jobs.list(job.workId)).find(item=>item.id===job.id)??job;
}
