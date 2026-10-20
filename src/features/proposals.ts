/** Evidence-backed suggestions stay pending until the author explicitly accepts them. */
import { db, type Db } from '../data/db';
import { fingerprint } from '../ai/context';
import { inputFingerprintIn } from './jobs';
import { acceptRelationIn,undoRelationIn,removedRelationEvidenceIn,validRemovedRelationIn,insertRelationChangesIn } from './relationExtraction';
import { nowIso, uuid } from '../utils/id';
import { AppError, notFound } from './errors';
import { emit } from './events';
import * as entries from './entries';
import { numberOf } from './chapters';
import { chapterOrderIn, effectiveFacts, requireWorkIn, type FactRow } from './archiveSupport';
import type { EntryType, ID } from './types';
interface Row {
  id: string; work_id: string; chapter_id: string; kind: 'add'|'update'|'retire'; target_type: EntryType|'relation';
  target_entry_id: string|null; target_name: string; field: string|null; before_value: string|null; after_value: string;
  evidence: string; evidence_offset: number|null; confidence: 'high'|'medium'|'low'; status: 'pending'|'accepted'|'rejected'|'superseded';
  accepted_value: string|null; applied_fact_ids: string|null; created_at: string; source_job_id: string|null;
  evidence_version_id: string|null; origin: 'extraction'|'deletion'; evidence_proposal_id:string|null;
}
export interface Proposal {
  id: string; workId: string; chapterId: string; chapterNumber?: number|null; targetEntryId: string|null; entryName: string; targetName: string;
  type: 'new_entry'|'new_fact'|'update_fact'|'retire_fact'; kind: Row['kind']; entryType: Row['target_type'];
  field: string|null; before: string|null; after: string; evidence: string; evidenceOffset: number|null;
  confidence: Row['confidence']; status: Row['status']; createdAt: string;
  acceptedValue: string|null; edited: boolean; origin: Row['origin']; evidenceVersionId:string|null;
}
const map = (r: Row): Proposal => ({ id:r.id,workId:r.work_id,chapterId:r.chapter_id,targetEntryId:r.target_entry_id,
  entryName:r.target_name,targetName:r.target_name,type:!r.target_entry_id?'new_entry':r.kind==='retire'?'retire_fact':r.kind==='update'?'update_fact':'new_fact',
  kind:r.kind,entryType:r.target_type,field:r.field,before:r.before_value,after:r.after_value,evidence:r.evidence,evidenceOffset:r.evidence_offset,
  confidence:r.confidence,status:r.status,acceptedValue:r.accepted_value??null,edited:r.accepted_value!=null&&r.accepted_value!==r.after_value,createdAt:r.created_at,origin:r.origin,evidenceVersionId:r.evidence_version_id });
async function rowIn(tx: Db,id:ID): Promise<Row> {
  const row = await tx.get<Row>(`SELECT p.* FROM memory_proposals p JOIN works w ON w.id=p.work_id WHERE p.id=? AND w.deleted_at IS NULL`,[id]);
  if(!row) throw notFound('提议'); return row;
}
export async function list(workId:ID, options:{chapterId?:ID}={}):Promise<Proposal[]> {
  await requireWorkIn(db(),workId);
  const rows=await db().all<Row>(`SELECT p.* FROM memory_proposals p JOIN chapters c ON c.id=p.chapter_id AND c.work_id=p.work_id WHERE p.work_id=? AND c.deleted_at IS NULL${options.chapterId?' AND p.chapter_id=?':''} ORDER BY p.created_at DESC,p.rowid DESC`,options.chapterId?[workId,options.chapterId]:[workId]);
  return Promise.all(rows.map(async row=>({...map(row),chapterNumber:await numberOf(row.chapter_id)})));
}
export async function pendingCount(chapterId: ID): Promise<number> {
  const row=await db().get<{n:number}>(`SELECT (SELECT count(*) FROM memory_proposals p WHERE p.chapter_id=c.id AND p.status='pending') n FROM chapters c JOIN works w ON w.id=c.work_id WHERE c.id=? AND c.deleted_at IS NULL AND w.deleted_at IS NULL`,[chapterId]);
  if(!row) throw notFound('章节'); return Number(row.n);
}
/** Re-finalization retires only unreviewed derived results; accepted facts remain author owned. */
export async function supersedeStaleIn(tx:Db,workId:ID,chapterId:ID,versionId:ID,inputFingerprint?:string):Promise<void> {
  await tx.run(`UPDATE memory_proposals SET status='superseded',decided_at=? WHERE work_id=? AND chapter_id=? AND status='pending'
    AND (source_job_id IS NULL OR NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id=memory_proposals.source_job_id AND j.source_version_id=? AND (? IS NULL OR j.input_fingerprint=?)))`,[nowIso(),workId,chapterId,versionId,inputFingerprint??null,inputFingerprint??null]);
  await tx.run(`UPDATE conflicts SET status='superseded',resolved_at=? WHERE work_id=? AND chapter_id=? AND status IN ('open','later')
    AND source_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id=conflicts.source_job_id AND j.source_version_id=? AND (? IS NULL OR j.input_fingerprint=?))`,[nowIso(),workId,chapterId,versionId,inputFingerprint??null,inputFingerprint??null]);
}
async function liveFactIn(tx:Db,p:Row):Promise<FactRow|undefined> {
  if(!p.target_entry_id)return undefined;
  const {rank}=await chapterOrderIn(tx,p.work_id);
  return effectiveFacts(await tx.all<FactRow>('SELECT * FROM entry_facts WHERE entry_id=? ORDER BY created_at,rowid',[p.target_entry_id]),rank,rank.get(p.chapter_id))
    .find(f=>f.field===p.field);
}
const stale=()=>new AppError('AI_RESULT_STALE','来源版本或设定已变化，请重新核实后定稿分析。');
/** Only our own audited accept/undo transactions can advance a batch's dependency digest. */
async function assertSourceIn(tx:Db,p:Row,checkUnapplied=true) {
  if(!p.source_job_id || p.evidence_offset===null || !p.evidence_version_id)throw stale();
  const source=await tx.get<{body:string;source_version_id:string;input_fingerprint:string;status:string}>(`SELECT v.body,j.source_version_id,j.input_fingerprint,j.status FROM jobs j
    JOIN chapter_versions v ON v.id=j.source_version_id AND v.chapter_id=j.chapter_id
    JOIN chapters c ON c.id=j.chapter_id AND c.work_id=j.work_id
    WHERE j.id=? AND j.work_id=? AND j.chapter_id=? AND j.kind='extract_memory'
      AND c.deleted_at IS NULL AND c.state='finalized' AND c.finalized_version_id=j.source_version_id`,[p.source_job_id,p.work_id,p.chapter_id]);
  if(!source||source.status!=='done')throw stale();
  if(p.origin==='deletion') {
    const old=await tx.get<Row>('SELECT * FROM memory_proposals WHERE id=?',[p.evidence_proposal_id??'']);
    const oldVersion=await tx.get<{body:string}>('SELECT body FROM chapter_versions WHERE id=? AND chapter_id=?',[p.evidence_version_id,p.chapter_id]);
    if(p.kind!=='retire'||!old||old.status!=='accepted'||old.origin!=='extraction'||old.kind==='retire'||old.work_id!==p.work_id||old.chapter_id!==p.chapter_id||old.evidence_version_id!==p.evidence_version_id||
      old.target_type!==p.target_type||old.target_entry_id!==p.target_entry_id||old.field!==p.field||old.evidence!==p.evidence||old.evidence_offset!==p.evidence_offset||
      oldVersion?.body.slice(p.evidence_offset,p.evidence_offset+p.evidence.length)!==p.evidence||source.body.includes(p.evidence))throw stale();
    if(checkUnapplied){
      if(p.target_type==='relation'){if(!await validRemovedRelationIn(tx,p,old))throw stale();}
      else{
        const live=await liveFactIn(tx,p);
        if(!live||live.value!==p.before_value||live.source_kind!=='review'||live.source_ref!==old.id||!(JSON.parse(old.applied_fact_ids??'[]') as string[]).includes(live.id))throw stale();
      }
    }
  } else if(p.evidence_version_id!==source.source_version_id||source.body.slice(p.evidence_offset,p.evidence_offset+p.evidence.length)!==p.evidence)throw stale();
  const current=await inputFingerprintIn(tx,p.work_id,p.chapter_id,source.source_version_id);
  const audit=await tx.get<{base_input_fingerprint:string;current_input_fingerprint:string}>('SELECT * FROM proposal_review_audits WHERE source_job_id=?',[p.source_job_id]);
  if(source.input_fingerprint!==current && (!audit||audit.base_input_fingerprint!==source.input_fingerprint||audit.current_input_fingerprint!==current))throw stale();
  return {sourceVersionId:source.source_version_id,baseFingerprint:source.input_fingerprint};
}
/** A removed quote is a review signal, never sufficient authority to delete a setting. */
export async function proposeRemovedEvidenceIn(tx:Db,input:{workId:ID;chapterId:ID;versionId:ID;jobId:ID;body:string}):Promise<void> {
  const accepted=await tx.all<Row>(`SELECT * FROM memory_proposals WHERE work_id=? AND chapter_id=? AND status='accepted' AND origin='extraction'
    AND kind!='retire' AND evidence_version_id IS NOT NULL AND evidence_version_id!=? ORDER BY created_at`,[input.workId,input.chapterId,input.versionId]);
  for(const old of accepted) {
    if(!old.target_entry_id||!old.field||old.evidence_offset===null||!old.evidence||input.body.includes(old.evidence))continue;
    const version=await tx.get<{body:string}>('SELECT body FROM chapter_versions WHERE id=? AND chapter_id=?',[old.evidence_version_id!,input.chapterId]);
    if(version?.body.slice(old.evidence_offset,old.evidence_offset+old.evidence.length)!==old.evidence)continue;
    if(old.target_type==='relation'){
      const relation=await removedRelationEvidenceIn(tx,old);if(!relation)continue;
      await insertRelationChangesIn(tx,[relation],input);
      await tx.run(`UPDATE memory_proposals SET origin='deletion',evidence_version_id=?,evidence_proposal_id=? WHERE source_job_id=? AND target_type='relation' AND target_entry_id=? AND field=? AND kind='retire' AND evidence=? AND origin='extraction' AND status='pending'`,[old.evidence_version_id,old.id,input.jobId,old.target_entry_id,old.field,old.evidence]);
      continue;
    }
    const live=await liveFactIn(tx,old);
    const entry=await tx.get<{deleted_at:string|null}>('SELECT deleted_at FROM entries WHERE id=? AND work_id=?',[old.target_entry_id,input.workId]);
    if(!entry||entry.deleted_at||
      !live||live.source_kind!=='review'||live.source_ref!==old.id||!(JSON.parse(old.applied_fact_ids??'[]') as string[]).includes(live.id))continue;
    await tx.run(`INSERT OR IGNORE INTO memory_proposals
      (id,work_id,chapter_id,kind,target_type,target_entry_id,target_name,field,before_value,after_value,evidence,evidence_offset,confidence,status,created_at,source_job_id,evidence_version_id,origin,evidence_proposal_id)
      VALUES (?,?,?,'retire',?,?,?,?,?,'',?,?,'medium','pending',?,?,?,'deletion',?)`,
      [uuid(),input.workId,input.chapterId,old.target_type,old.target_entry_id,old.target_name,old.field,live.value,old.evidence,old.evidence_offset,nowIso(),input.jobId,old.evidence_version_id,old.id]);
  }
}
async function recordAuditIn(tx:Db,p:Row,source:{sourceVersionId:string;baseFingerprint:string}) {
  await tx.run(`INSERT OR REPLACE INTO proposal_review_audits(source_job_id,base_input_fingerprint,current_input_fingerprint) VALUES (?,?,?)`,
    [p.source_job_id!,source.baseFingerprint,await inputFingerprintIn(tx,p.work_id,p.chapter_id,source.sourceVersionId)]);
}
export async function accept(id:ID, options:{value?:string}={}):Promise<{entryId:string}> {
  let workId=''; let changed:string[]=[];
  const result=await db().transaction(async tx=>{
    const p=await rowIn(tx,id);workId=p.work_id;
    if(p.status!=='pending') throw new AppError('CONFLICT_STATE','这条提议已处理，请刷新。');
    const source=await assertSourceIn(tx,p);
    if(p.target_type==='relation'){
      const applied=await acceptRelationIn(tx,p,options);changed=applied.entryIds;await tx.run('UPDATE memory_proposals SET accepted_value=? WHERE id=?',[options.value??p.after_value,id]);await recordAuditIn(tx,p,source);return {entryId:applied.entryId};
    }
    if(!p.field || !entries.ENTRY_FIELDS[p.target_type].includes(p.field)) throw new AppError('VALIDATION','提议字段无效，请核实。');
    const value=options.value??p.after_value;
    if([...value].length>300 || (!value.trim()&&p.kind!=='retire')) throw new AppError('VALIDATION','请输入 1–300 字的设定。');
    let entryId=p.target_entry_id;
    if(!entryId)entryId=(await tx.get<{target_entry_id:string}>(`SELECT target_entry_id FROM memory_proposals WHERE source_job_id=? AND target_type=? AND target_name=? AND status='accepted' AND target_entry_id IS NOT NULL LIMIT 1`,[p.source_job_id!,p.target_type,p.target_name]))?.target_entry_id??null;
    const created = entryId === null;
    const beforeFacts = entryId ? await tx.all<FactRow>('SELECT * FROM entry_facts WHERE entry_id=? ORDER BY id',[entryId]) : [];
    const beforeEntry = entryId ? await tx.get<{state:string}>('SELECT state FROM entries WHERE id=?',[entryId]) : null;
    if(!entryId) entryId=await entries.createIn(tx,{workId,type:p.target_type,name:p.target_name,facts:[]},{kind:'review',ref:id});
    else {
      const e=await tx.get<{work_id:string;deleted_at:string|null}>('SELECT work_id,deleted_at FROM entries WHERE id=?',[entryId]);
      if(!e||e.work_id!==workId||e.deleted_at) throw notFound('条目');
      // Never overwrite a field changed after extraction without explicit edited author value.
      const current=await liveFactIn(tx,{...p,target_entry_id:entryId});
      if(p.before_value!==null && (current?.value??'')!==p.before_value && options.value===undefined) throw new AppError('AI_RESULT_STALE','字段已变化，请编辑核对后采纳。');
    }
    const ids=await entries.updateFactsIn(tx,entryId,[{field:p.field,value:p.kind==='retire'?'':value,fromChapterId:p.chapter_id}],{kind:'review',ref:id}, 'ESTABLISHED');
    await entries.refreshStateIn(tx,entryId);
    await tx.run("UPDATE memory_proposals SET status='accepted',target_entry_id=?,applied_fact_ids=?,decided_at=?,accepted_value=? WHERE id=?",[entryId,JSON.stringify(ids),nowIso(),value,id]);
    await tx.run(`INSERT OR REPLACE INTO adoption_receipts (id,work_id,message_id,option_index,created_entries,entry_ids,fact_ids,before_facts,after_fingerprint,created_at)
      VALUES (?,?,NULL,NULL,?,?,?,?,?,?)`, [`proposal:${id}`,workId,JSON.stringify(created?[entryId]:[]),JSON.stringify([entryId]),JSON.stringify(ids),
      JSON.stringify({facts:beforeFacts,state:beforeEntry?.state??null}),await reviewFingerprint(tx,entryId),nowIso()]);
    await recordAuditIn(tx,p,source);
    changed=[entryId];return {entryId};
  });
  emit('entries.changed',{workId,entryIds:changed});emit('proposals.changed',{workId});return result;
}
export async function reject(id:ID, reason?:string):Promise<void> {
  let workId='';await db().transaction(async tx=>{const p=await rowIn(tx,id);workId=p.work_id;
    if(p.status!=='pending') throw new AppError('CONFLICT_STATE','这条提议已处理。');
    await tx.run("UPDATE memory_proposals SET status='rejected',reject_reason=?,decided_at=? WHERE id=?",[reason?.slice(0,200)??null,nowIso(),id]);});
  emit('proposals.changed',{workId});
}
async function reviewFingerprint(tx:Db,entryId:ID):Promise<string> {
  return fingerprint({entry:await tx.get('SELECT * FROM entries WHERE id=?',[entryId]),
    facts:await tx.all('SELECT * FROM entry_facts WHERE entry_id=? ORDER BY id',[entryId]),
    relations:await tx.all('SELECT * FROM relations WHERE from_entry=? OR to_entry=? ORDER BY id',[entryId,entryId])});
}
export async function undo(id:ID):Promise<void> {
  let workId='';let changed:ID[]=[];
  await db().transaction(async tx=>{
    const p=await rowIn(tx,id);workId=p.work_id;
    if(p.status==='rejected') {
      await tx.run("UPDATE memory_proposals SET status='pending',reject_reason=NULL,decided_at=NULL WHERE id=?",[id]); return;
    }
    if(p.status!=='accepted') throw new AppError('CONFLICT_STATE','只有已处理的提议可以撤销。');
    if(p.target_type==='relation'){
      const source=await assertSourceIn(tx,p,false);changed=await undoRelationIn(tx,p);await tx.run('UPDATE memory_proposals SET accepted_value=NULL WHERE id=?',[id]);await recordAuditIn(tx,p,source);return;
    }
    const receipt=await tx.get<{entry_ids:string;fact_ids:string;before_facts:string;after_fingerprint:string;created_entries:string}>('SELECT * FROM adoption_receipts WHERE id=?',[`proposal:${id}`]);
    if(!receipt) throw new AppError('CONFLICT_STATE','缺少安全撤销快照，请在档案历史中处理。');
    const ids:ID[]=JSON.parse(receipt.entry_ids);const entryId=ids[0];
    if(!entryId || receipt.after_fingerprint!==await reviewFingerprint(tx,entryId)) throw new AppError('CONFLICT_STATE','条目或关系之后改过，请在历史中处理。');
    const source=await assertSourceIn(tx,p,false);
    const before:{facts:FactRow[];state:string|null}=JSON.parse(receipt.before_facts);
    for(const factId of JSON.parse(receipt.fact_ids) as ID[]) await tx.run('DELETE FROM entry_facts WHERE id=?',[factId]);
    for(const fact of before.facts) await tx.run('UPDATE entry_facts SET is_current=?,to_chapter_id=? WHERE id=?',[fact.is_current,fact.to_chapter_id,fact.id]);
    if(before.state) await tx.run('UPDATE entries SET state=? WHERE id=?',[before.state,entryId]);
    const createdEntries=JSON.parse(receipt.created_entries) as ID[];
    for(const created of createdEntries) await tx.run('DELETE FROM entries WHERE id=?',[created]);
    await tx.run('DELETE FROM adoption_receipts WHERE id=?',[`proposal:${id}`]);
    await tx.run("UPDATE memory_proposals SET status='pending',target_entry_id=?,applied_fact_ids=NULL,decided_at=NULL,accepted_value=NULL WHERE id=?",[createdEntries.length?null:p.target_entry_id,id]);changed=ids;
    await recordAuditIn(tx,p,source);
  });
  if(changed.length) emit('entries.changed',{workId,entryIds:changed});emit('proposals.changed',{workId});
}
