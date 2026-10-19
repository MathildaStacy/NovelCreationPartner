/** Conflicts (G02 §5.9): lists, badges and author resolution. Visibility rules live in conflictVisibility. */
import { AppError } from './errors';
import { emit } from './events';
import { activeConflictSql, conflictVisibleSql } from './conflictVisibility';
import { nowIso } from '../utils/id';
import { db, type Db } from '../data/db';
import { previewFinalization,type FinalizationPreview } from './finalizationPlans';
import * as chapters from './chapters';
import { FIELD_LABELS } from './entries';
import type { ChapterListItem, Conflict, ConflictStatus, ConflictView, ID } from './types';

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
  resolved_at: string | null;
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

interface FactRow { id: string; entry_id: string; field: string; value: string; state: string; from_chapter_id: string | null; to_chapter_id: string | null; is_current: number }
const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');
const VALID_FACT = "('CONFIRMED','ESTABLISHED','CONFLICTED')";

/** Chapter numbers, entry names and the archive-side field are read live: reordering or edits never leave stale labels. */
async function enrich(q: Db, rows: ConflictRow[]): Promise<ConflictView[]> {
  const numbered = new Map<string, ChapterListItem[]>();
  for (const workId of new Set(rows.map(r => r.work_id))) numbered.set(workId, await chapters.listNumbered(q, workId));
  const entryIds = [...new Set(rows.flatMap(r => r.entry_id ? [r.entry_id] : []))];
  const names = new Map((entryIds.length ? await q.all<{ id: string; name: string }>(`SELECT id,name FROM entries WHERE id IN (${placeholders(entryIds.length)})`, entryIds) : []).map(r => [r.id, r.name]));
  const factIds = [...new Set(rows.flatMap(r => r.b_ref.startsWith('fact:') ? [r.b_ref.slice(5)] : []))];
  const facts = new Map((factIds.length ? await q.all<FactRow>(`SELECT id,entry_id,field,value,state,from_chapter_id,to_chapter_id,is_current FROM entry_facts WHERE id IN (${placeholders(factIds.length)})`, factIds) : []).map(r => [r.id, r]));
  const current = new Map<string, string | null>();
  for (const fact of facts.values()) {
    if (fact.is_current === 1) continue;
    const row = await q.get<{ value: string }>(`SELECT value FROM entry_facts WHERE entry_id=? AND field=? AND is_current=1 AND state IN ${VALID_FACT} ORDER BY created_at DESC LIMIT 1`, [fact.entry_id, fact.field]);
    current.set(fact.id, row && row.value !== fact.value ? row.value : null);
  }
  return rows.map(r => {
    const ordered = numbered.get(r.work_id) ?? [];
    const numberOf = (id: string | null) => (id ? ordered.find(ch => ch.id === id)?.number ?? null : null);
    const chapter = r.chapter_id ? ordered.find(ch => ch.id === r.chapter_id) : undefined;
    const fact = r.b_ref.startsWith('fact:') ? facts.get(r.b_ref.slice(5)) : undefined;
    return { ...toConflict(r), resolvedAt: r.resolved_at,
      chapter: chapter ? { id: chapter.id, number: chapter.number, title: chapter.title } : null,
      entryName: r.entry_id ? names.get(r.entry_id) ?? null : null,
      fact: fact ? { id: fact.id, field: fact.field, fieldLabel: FIELD_LABELS[fact.field] ?? fact.field, value: fact.value, state: fact.state,
        fromNumber: numberOf(fact.from_chapter_id), toNumber: numberOf(fact.to_chapter_id), currentValue: current.get(fact.id) ?? null } : null };
  });
}

const SEVERITY = "CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END";

/** Open and "later" conflicts of one chapter (editor bar, S07). */
export async function forChapter(chapterId: ID): Promise<Conflict[]> {
  const rows = await db().all<ConflictRow>(
    `SELECT x.* FROM conflicts x WHERE x.chapter_id = ? AND ${activeConflictSql('x')} ORDER BY ${SEVERITY}, x.created_at DESC`,
    [chapterId],
  );
  return rows.map(toConflict);
}

export async function list(workId: ID, options: { status?: ConflictStatus } = {}): Promise<ConflictView[]> {
  const q = db();
  const rows = await q.all<ConflictRow>(`SELECT x.* FROM conflicts x JOIN works w ON w.id=x.work_id WHERE x.work_id=? AND w.deleted_at IS NULL AND ${conflictVisibleSql('x')}${options.status ? ' AND x.status=?' : ''} ORDER BY ${SEVERITY},x.created_at DESC`, options.status ? [workId, options.status] : [workId]);
  return enrich(q, rows);
}
/** Hidden conflicts (chapter or entry in the trash) read as NOT_FOUND, like S14a "这处冲突已不存在". */
export async function get(id: ID): Promise<ConflictView> {
  const q = db();
  const row=await q.get<ConflictRow>(`SELECT x.* FROM conflicts x JOIN works w ON w.id=x.work_id WHERE x.id=? AND w.deleted_at IS NULL AND ${conflictVisibleSql('x')}`,[id]);
  if(!row) throw new AppError('NOT_FOUND','这处冲突已不存在'); return (await enrich(q, [row]))[0];
}
export async function resolve(id:ID, options:{status:Exclude<ConflictStatus,'open'>;note?:string}):Promise<void> {
  if(!['fixed_text','updated_entry','intentional','later'].includes(options.status)) throw new AppError('VALIDATION','请选择处理方式');
  const conflict=await db().transaction(async tx=>{
    const row=await tx.get<ConflictRow>('SELECT x.* FROM conflicts x JOIN works w ON w.id=x.work_id WHERE x.id=? AND w.deleted_at IS NULL',[id]);
    if(!row)throw new AppError('NOT_FOUND','这处冲突已不存在');
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
    if(!row)throw new AppError('NOT_FOUND','这处冲突已不存在');
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
