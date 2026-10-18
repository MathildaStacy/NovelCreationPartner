/** Relation evidence is proposed locally; only an author decision can change archive history. */
import type { Db, Row as DbRow } from '../data/db';
import { fingerprint } from '../ai/context';
import { parseAnalysisJson, type AnalysisEntry } from '../ai/tasks/finalization';
import { nowIso, uuid } from '../utils/id';
import { countChars } from '../utils/text';
import { chapterOrderIn, inInterval, requireEntryIn } from './archiveSupport';
import { AppError } from './errors';

interface RelationRow extends DbRow {
  id:string; work_id:string; from_entry:string; to_entry:string; kind:string; note:string|null;
  from_chapter_id:string|null; to_chapter_id:string|null; state:string; deleted_at:string|null;
}
interface ProposalRow { id:string; work_id:string; chapter_id:string; kind:'add'|'update'|'retire'; field:string|null; after_value:string; }
interface TargetRow { from_entry_id:string; to_entry_id:string; relation_id:string|null; expected_fingerprint:string;
  before_rows:string|null; created_ids:string|null; after_fingerprint:string|null; }
export interface RelationChange {
  fromEntryId:string; toEntryId:string; fromName:string; toName:string; kind:'add'|'update'|'retire'; relationKind:string;
  before:string|null; after:string; evidence:string; evidenceOffset:number; confidence:'high'|'medium'|'low';
}
const invalid=()=>new AppError('AI_FORMAT','关系提案的双方、类型或逐字证据无法核验，未写入待审核。');
const stale=()=>new AppError('AI_RESULT_STALE','关系或相关条目已变化，请重新核实后分析。');
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max:number,empty=false):v is string=>typeof v==='string'&&(empty||!!v.trim())&&countChars(v)<=max;
export function validateRelationChanges(raw:string,context:{body:string;entries:readonly AnalysisEntry[]}):RelationChange[] {
  const result=parseAnalysisJson(raw);
  if(!object(result))throw invalid();
  if(result.relations===undefined)return [];
  if(!Array.isArray(result.relations)||result.relations.length>30)throw invalid();
  const resolve=(value:unknown)=>{
    if(!text(value,30))throw invalid();
    const canonical=value.trim().toLocaleLowerCase();
    const matches=context.entries.filter(e=>[e.name,...e.aliases].some(name=>name.trim().toLocaleLowerCase()===canonical));
    if(matches.length!==1)throw invalid();return matches[0];
  };
  const seen=new Set<string>();const changes:RelationChange[]=[];
  for(const row of result.relations) {
    if(!object(row)||!['add','update','retire'].includes(String(row.kind))||!text(row.relationKind,10)||!text(row.after,100,row.kind==='retire')||
      (row.before!==null&&!text(row.before,100,true))||!text(row.evidence,80)||!['high','medium','low'].includes(String(row.confidence)))throw invalid();
    const from=resolve(row.fromName),to=resolve(row.toName);const offset=context.body.indexOf(row.evidence);
    if(from.id===to.id||offset<0)throw invalid();
    const key=JSON.stringify([from.id,to.id,row.kind,row.relationKind,row.after]);if(seen.has(key))continue;seen.add(key);
    changes.push({fromEntryId:from.id,toEntryId:to.id,fromName:from.name,toName:to.name,kind:row.kind as RelationChange['kind'],relationKind:row.relationKind.trim(),
      before:row.before as string|null,after:row.after,evidence:row.evidence,evidenceOffset:offset,confidence:row.confidence as RelationChange['confidence']});
  }return changes;
}
async function pairIn(tx:Db,workId:string,from:string,to:string) {
  const a=await requireEntryIn(tx,from),b=await requireEntryIn(tx,to);
  if(a.work_id!==workId||b.work_id!==workId||from===to)throw stale();
}
async function activeRows(tx:Db,p:ProposalRow,from:string,to:string):Promise<RelationRow[]> {
  const {rank}=await chapterOrderIn(tx,p.work_id);const at=rank.get(p.chapter_id);if(at===undefined)throw stale();
  return (await tx.all<RelationRow>(`SELECT * FROM relations WHERE work_id=? AND from_entry=? AND to_entry=? AND kind=? AND deleted_at IS NULL ORDER BY id`,[p.work_id,from,to,p.field]))
    .filter(row=>inInterval(row.from_chapter_id,row.to_chapter_id,at,rank));
}
export async function insertRelationChangesIn(tx:Db,changes:readonly RelationChange[],input:{workId:string;chapterId:string;jobId:string;versionId:string}):Promise<void> {
  for(const change of changes) {
    await pairIn(tx,input.workId,change.fromEntryId,change.toEntryId);
    const id=uuid();const shape:ProposalRow={id,work_id:input.workId,chapter_id:input.chapterId,kind:change.kind,field:change.relationKind,after_value:change.after};
    const current=await activeRows(tx,shape,change.fromEntryId,change.toEntryId);
    if(current.length>1||change.kind!=='add'&&current.length!==1)throw invalid();
    if(change.kind==='add'&&current.length)continue;
    if(change.before!==null&&current[0]&&(current[0].note??'')!==change.before)throw invalid();
    const inserted=await tx.run(`INSERT OR IGNORE INTO memory_proposals
      (id,work_id,chapter_id,kind,target_type,target_entry_id,target_name,field,before_value,after_value,evidence,evidence_offset,confidence,status,created_at,source_job_id,evidence_version_id,origin)
      VALUES (?,?,?,?,'relation',?,?,?,?,?,?,?,?,'pending',?,?,?,'extraction')`,
      [id,input.workId,input.chapterId,change.kind,change.fromEntryId,`${change.fromName} → ${change.toName}`,change.relationKind,change.before,change.after,change.evidence,change.evidenceOffset,change.confidence,nowIso(),input.jobId,input.versionId]);
    if(inserted.changes)await tx.run(`INSERT INTO proposal_relation_targets(proposal_id,from_entry_id,to_entry_id,relation_id,expected_fingerprint) VALUES (?,?,?,?,?)`,
      [id,change.fromEntryId,change.toEntryId,current[0]?.id??null,fingerprint(current)]);
  }
}
async function graphFingerprint(tx:Db,from:string,to:string):Promise<string> {
  return fingerprint({entries:await tx.all('SELECT * FROM entries WHERE id IN (?,?) ORDER BY id',[from,to]),
    facts:await tx.all('SELECT * FROM entry_facts WHERE entry_id IN (?,?) ORDER BY id',[from,to]),
    relations:await tx.all('SELECT * FROM relations WHERE from_entry IN (?,?) OR to_entry IN (?,?) ORDER BY id',[from,to,from,to])});
}
/** Removed prose only proposes retirement of the exact unchanged relation created by that acceptance. */
export async function removedRelationEvidenceIn(tx:Db,p:{id:string;work_id:string;chapter_id:string;field:string|null}):Promise<RelationChange|null> {
  const target=await tx.get<TargetRow>('SELECT * FROM proposal_relation_targets WHERE proposal_id=?',[p.id]);
  if(!target?.created_ids||!target.after_fingerprint||!p.field)return null;
  if(await graphFingerprint(tx,target.from_entry_id,target.to_entry_id)!==target.after_fingerprint)return null;
  const rows=await activeRows(tx,{...p,kind:'retire',after_value:''},target.from_entry_id,target.to_entry_id);
  if(rows.length!==1||!(JSON.parse(target.created_ids) as string[]).includes(rows[0].id))return null;
  const from=await requireEntryIn(tx,target.from_entry_id),to=await requireEntryIn(tx,target.to_entry_id);
  if(from.work_id!==p.work_id||to.work_id!==p.work_id)return null;
  const old=await tx.get<{evidence:string;evidence_offset:number|null}>('SELECT evidence,evidence_offset FROM memory_proposals WHERE id=?',[p.id]);
  if(!old||old.evidence_offset===null)return null;
  return {fromEntryId:from.id,toEntryId:to.id,fromName:from.name,toName:to.name,kind:'retire',relationKind:p.field,
    before:rows[0].note??'',after:'',evidence:old.evidence,evidenceOffset:old.evidence_offset,confidence:'medium'};
}
/** Acceptance repeats the old receipt and new pending-target checks in the author's transaction. */
export async function validRemovedRelationIn(tx:Db,p:{id:string;work_id:string;chapter_id:string;field:string|null;before_value:string|null},old:{id:string;work_id:string;chapter_id:string;field:string|null}):Promise<boolean> {
  const change=await removedRelationEvidenceIn(tx,old);
  const target=await tx.get<TargetRow>('SELECT * FROM proposal_relation_targets WHERE proposal_id=?',[p.id]);
  if(!change||!target||change.before!==p.before_value||change.relationKind!==p.field||p.work_id!==old.work_id||p.chapter_id!==old.chapter_id||
    target.from_entry_id!==change.fromEntryId||target.to_entry_id!==change.toEntryId)return false;
  const rows=await activeRows(tx,{...p,kind:'retire',after_value:''},change.fromEntryId,change.toEntryId);
  return rows.length===1&&rows[0].id===target.relation_id&&fingerprint(rows)===target.expected_fingerprint;
}
export async function acceptRelationIn(tx:Db,p:ProposalRow,options:{value?:string}={}):Promise<{entryId:string;entryIds:string[]}> {
  if(!text(p.field,10))throw stale();
  const target=await tx.get<TargetRow>('SELECT * FROM proposal_relation_targets WHERE proposal_id=?',[p.id]);if(!target)throw stale();
  const from=target.from_entry_id,to=target.to_entry_id;await pairIn(tx,p.work_id,from,to);
  const rows=await activeRows(tx,p,from,to);if(fingerprint(rows)!==target.expected_fingerprint)throw stale();
  const value=options.value??p.after_value;if(!text(value,100,p.kind==='retire'))throw new AppError('VALIDATION','关系说明最多 100 字。');
  const {chapters,rank}=await chapterOrderIn(tx,p.work_id);const at=rank.get(p.chapter_id)!;const old=rows[0];
  const history=await tx.all<RelationRow>('SELECT * FROM relations WHERE work_id=? AND from_entry=? AND to_entry=? AND kind=? AND deleted_at IS NULL',[p.work_id,from,to,p.field]);
  if(history.some(row=>(row.from_chapter_id!==null&&!rank.has(row.from_chapter_id))||(row.to_chapter_id!==null&&!rank.has(row.to_chapter_id))))throw stale();
  const future=history.filter(row=>row.from_chapter_id!==null&&rank.get(row.from_chapter_id)!>at)
    .sort((a,b)=>rank.get(a.from_chapter_id!)!-rank.get(b.from_chapter_id!)!)[0];
  let end=old?.to_chapter_id??null;
  if(future){const boundary=rank.get(future.from_chapter_id!)!-1;if(end===null||rank.get(end)!>boundary)end=chapters[boundary].id;}
  if(p.kind!=='add'&&(!old||old.id!==target.relation_id))throw stale();
  if(p.kind==='add'&&old)throw stale();
  const now=nowIso();
  if(old) {
    if(at===0||old.from_chapter_id===p.chapter_id) await tx.run("UPDATE relations SET deleted_at=?,state='RETIRED',updated_at=? WHERE id=?",[now,now,old.id]);
    else await tx.run('UPDATE relations SET to_chapter_id=?,updated_at=? WHERE id=?',[chapters[at-1].id,now,old.id]);
  }
  const created:string[]=[];
  if(p.kind!=='retire') {
    const id=uuid();created.push(id);
    await tx.run(`INSERT INTO relations(id,work_id,from_entry,to_entry,kind,note,from_chapter_id,to_chapter_id,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'ESTABLISHED',?,?)`,[id,p.work_id,from,to,p.field,value,p.chapter_id,end,now,now]);
  }
  await tx.run('UPDATE proposal_relation_targets SET before_rows=?,created_ids=?,after_fingerprint=? WHERE proposal_id=?',
    [JSON.stringify(rows),JSON.stringify(created),await graphFingerprint(tx,from,to),p.id]);
  await tx.run("UPDATE memory_proposals SET status='accepted',decided_at=? WHERE id=?",[now,p.id]);
  return {entryId:from,entryIds:[from,to]};
}
export async function undoRelationIn(tx:Db,p:ProposalRow):Promise<string[]> {
  const target=await tx.get<TargetRow>('SELECT * FROM proposal_relation_targets WHERE proposal_id=?',[p.id]);
  if(!target?.before_rows||!target.created_ids||!target.after_fingerprint)throw stale();
  if(target.after_fingerprint!==await graphFingerprint(tx,target.from_entry_id,target.to_entry_id))throw new AppError('CONFLICT_STATE','相关条目或关系之后改过，请在档案中处理。');
  for(const id of JSON.parse(target.created_ids) as string[])await tx.run('DELETE FROM relations WHERE id=?',[id]);
  for(const row of JSON.parse(target.before_rows) as RelationRow[])await tx.run('UPDATE relations SET to_chapter_id=?,state=?,deleted_at=?,updated_at=? WHERE id=?',[row.to_chapter_id,row.state,row.deleted_at,row.updated_at,row.id]);
  await tx.run('UPDATE proposal_relation_targets SET before_rows=NULL,created_ids=NULL,after_fingerprint=NULL WHERE proposal_id=?',[p.id]);
  await tx.run("UPDATE memory_proposals SET status='pending',decided_at=NULL WHERE id=?",[p.id]);
  return [target.from_entry_id,target.to_entry_id];
}
