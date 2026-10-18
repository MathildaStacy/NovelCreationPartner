/** Conflicts (G02 §5.9). Phase 1 only reads them for the editor bar and chapter badges. */
import { AppError } from './errors';
import { emit } from './events';
import { nowIso } from '../utils/id';
import { db } from '../data/db';
import { previewFinalization,type FinalizationPreview } from './finalizationPlans';
import * as chapters from './chapters';
import type { Conflict, ConflictStatus, ID } from './types';

interface ConflictRow {
  id: string;
  work_id: string;
  chapter_id: string | null;
  entry_id: string | null;
  type: string;
  severity: string;
  a_label: string;
  a_ref: string;
  a_quote: string;
  b_label: string;
  b_ref: string;
  b_quote: string;
  explanation: string;
  suggestions: string;
  status: string;
  note: string | null;
  created_at: string;
}

const parseList = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

const toConflict = (r: ConflictRow): Conflict => ({
  id: r.id,
  workId: r.work_id,
  chapterId: r.chapter_id,
  entryId: r.entry_id,
  type: r.type as Conflict['type'],
  severity: r.severity as Conflict['severity'],
  a: { label: r.a_label, ref: r.a_ref, quote: r.a_quote },
  b: { label: r.b_label, ref: r.b_ref, quote: r.b_quote },
  explanation: r.explanation,
  suggestions: parseList(r.suggestions),
  status: r.status as ConflictStatus,
  note: r.note,
  createdAt: r.created_at,
});

const SEVERITY = "CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END";

/** Open and "later" conflicts of one chapter (editor bar, S07). */
export async function forChapter(chapterId: ID): Promise<Conflict[]> {
  const rows = await db().all<ConflictRow>(
    `SELECT * FROM conflicts WHERE chapter_id = ? AND status IN ('open','later') ORDER BY ${SEVERITY}, created_at DESC`,
    [chapterId],
  );
  return rows.map(toConflict);
}

export async function list(workId: ID, options: { status?: ConflictStatus } = {}): Promise<Conflict[]> {
  const rows = await db().all<ConflictRow>(`SELECT x.* FROM conflicts x JOIN works w ON w.id=x.work_id WHERE x.work_id=? AND w.deleted_at IS NULL${options.status ? ' AND x.status=?' : ''} ORDER BY ${SEVERITY},x.created_at DESC`, options.status ? [workId, options.status] : [workId]);
  return rows.map(toConflict);
}
export async function get(id: ID): Promise<Conflict> {
  const row=await db().get<ConflictRow>('SELECT x.* FROM conflicts x JOIN works w ON w.id=x.work_id WHERE x.id=? AND w.deleted_at IS NULL',[id]);
  if(!row) throw new AppError('NOT_FOUND','这个冲突已不存在'); return toConflict(row);
}
export async function resolve(id:ID, options:{status:Exclude<ConflictStatus,'open'>;note?:string}):Promise<void> {
  if(!['fixed_text','updated_entry','intentional','later'].includes(options.status)) throw new AppError('VALIDATION','请选择处理方式');
  const conflict=await db().transaction(async tx=>{
    const row=await tx.get<ConflictRow>('SELECT x.* FROM conflicts x JOIN works w ON w.id=x.work_id WHERE x.id=? AND w.deleted_at IS NULL',[id]);
    if(!row)throw new AppError('NOT_FOUND','这个冲突已不存在');
    if(row.status==='superseded')throw new AppError('AI_RESULT_STALE','这个冲突已被后续定稿取代，请查看新的检查结果。');
    await tx.run('UPDATE conflicts SET status=?,note=?,resolved_at=? WHERE id=?',[options.status,options.note?.slice(0,500)??null,options.status==='later'?null:nowIso(),id]);
    return toConflict(row);
  });
  emit('conflicts.changed',{workId:conflict.workId});
  emit('chapters.changed',{workId:conflict.workId});
}

export async function reopen(id:ID):Promise<void> {
  const conflict=await db().transaction(async tx=>{
    const row=await tx.get<ConflictRow>('SELECT x.* FROM conflicts x JOIN works w ON w.id=x.work_id WHERE x.id=? AND w.deleted_at IS NULL',[id]);
    if(!row)throw new AppError('NOT_FOUND','这个冲突已不存在');
    if(row.status==='superseded')throw new AppError('AI_RESULT_STALE','这个冲突已被后续定稿取代，请查看新的检查结果。');
    await tx.run("UPDATE conflicts SET status='open',resolved_at=NULL WHERE id=?",[id]);
    return toConflict(row);
  });
  emit('conflicts.changed',{workId:conflict.workId});emit('chapters.changed',{workId:conflict.workId});
}
/** Author explicitly previews and confirms a review-only rerun; no hidden summary/extraction calls. */
export async function prepareRecheck(chapterId:ID):Promise<Readonly<FinalizationPreview>> {
  const chapter=await chapters.get(chapterId);
  if(chapter.state!=='finalized')throw new AppError('CONFLICT_STATE','请先定稿本章，再重新检查。');
  return previewFinalization(chapterId,{kinds:['detect_conflicts'],boundFinalized:true});
}
export async function recheck(chapterId:ID,plan:Readonly<FinalizationPreview>):Promise<{jobIds:ID[]}> {
  return chapters.finalize(chapterId,{plan,recheckOnly:true});
}
