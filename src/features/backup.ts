/** Local portable backups: strict schema whitelist, full ID remap and transactional additive restore. */
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import { db, type Db, type Row, type SqlValue } from '../data/db';
import { nowIso, uuid } from '../utils/id';
import { AppError } from './errors';
import { emit } from './events';
import { SCHEMA_VERSION } from '../data/migrations';
import { fingerprint } from '../ai/context';
import { validateDraft } from './modelServiceConfig';
import { requireWorkIn } from './archiveSupport';
import * as chapters from './chapters';
import { chapterHeading } from '../utils/format';
import * as covers from './covers';
import * as appInfo from './appInfo';
import { fromBase64, toBase64 } from '../files/base64';
const FORMAT = 1;
const MAX_BYTES = 50 * 1024 * 1024;
const TABLES = ['works','volumes','chapters','chapter_versions','entries','entry_facts','relations','conversations','messages','jobs','memory_proposals','conflicts','adoption_receipts'] as const;
type Table = typeof TABLES[number];
interface CoverAttachment { workId: string; path: string; mimeType: 'image/jpeg'; }
interface Data { tables: Partial<Record<Table, Row[]>>; services: Row[]; relationTargets?: Row[]; coverAssets?: CoverAttachment[]; }
interface Manifest { format: number; schema: number; app: string; exportedAt: string; works: { id:string; title:string|null; chapters:number; chars:number }[]; }
export interface BackupInspection { manifest: Manifest; data: Data; services: number; attachments?: Record<string, Uint8Array>; }
const invalid = () => new AppError('BACKUP_INVALID','备份文件已损坏，或不是本 App 导出的 .ncpbak 文件。');
function object(v:unknown):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v);}
const scalar=(v:unknown):v is SqlValue=>v===null||typeof v==='string'||typeof v==='number'&&Number.isFinite(v);
const coverPath = /^covers\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.jpg$/;
/** Validate the JPEG envelope before native decode; imported bytes are sanitized again by CoverStore. */
function validCover(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes.length > covers.MAX_COVER_BYTES || bytes[0] !== 255 || bytes[1] !== 216) return false;
  let offset = 2; let dimensions = false; let scan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) return false;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) return dimensions && scan && offset === bytes.length;
    if (marker === 216 || marker === 0 || marker >= 208 && marker <= 215 || offset + 2 > bytes.length) return false;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return false;
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
      if (length < 8) return false;
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (!width || !height || Math.max(width, height) > 1200) return false;
      dimensions = true;
    }
    offset += length;
    if (marker === 218) {
      scan = true;
      // Entropy data escapes FF as FF00; restart markers also stay within the scan.
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) { offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0 || next >= 208 && next <= 215) { offset += 2; continue; }
        break;
      }
    }
  }
  return false;
}
function inspectionFiles(inspection: Pick<BackupInspection, 'manifest'|'data'|'attachments'>): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = { 'manifest.json': strToU8(JSON.stringify(inspection.manifest)), 'data.json': strToU8(JSON.stringify(inspection.data)) };
  for (const [name, bytes] of Object.entries(inspection.attachments ?? {})) {
    if (!coverPath.test(name) || !(bytes instanceof Uint8Array)) throw invalid();
    files[name] = bytes;
  }
  return files;
}
async function tableColumns(tx:Db,table:string):Promise<string[]>{return (await tx.all<{name:string}>(`PRAGMA table_info(${table})`)).map(c=>c.name);}
const SERVICE_COLUMNS = ['id','name','protocol','base_url','model','options','is_default','created_at','updated_at'];
function safeService(row: Row, strict = false): Row {
  if (strict && Object.keys(row).some(key => !SERVICE_COLUMNS.includes(key))) throw invalid();
  const raw: unknown = JSON.parse(String(row.options));
  if (!object(raw)) throw invalid();
  const optionKeys = ['maxOutputTokens','effort','authHeader','store','contextBudget','caps'];
  const capsRaw = object(raw.caps) ? raw.caps : {};
  const capKeys = ['jsonSchema','effort','streaming'];
  if (strict && (Object.keys(raw).some(key => !optionKeys.includes(key)) || 'caps' in raw && !object(raw.caps)
    || Object.keys(capsRaw).some(key => !capKeys.includes(key)))) throw invalid();
  const options = { ...Object.fromEntries(optionKeys.filter(key => key !== 'caps' && key in raw).map(key => [key, raw[key]])),
    caps: Object.fromEntries(capKeys.filter(key => key in capsRaw).map(key => [key, capsRaw[key]])) };
  const draft = validateDraft({ name: String(row.name), protocol: row.protocol as 'openai_responses', baseUrl: String(row.base_url), model: String(row.model), options: options as unknown as Parameters<typeof validateDraft>[0]['options'] });
  return { ...Object.fromEntries(SERVICE_COLUMNS.map(key => [key, row[key] ?? null])), options: JSON.stringify(draft.options) };
}
function validateGraph(data: Data): void {
  const byId = new Map<string, { table: Table; row: Row }>();
  for (const table of TABLES) for (const row of data.tables[table] ?? []) byId.set(String(row.id), { table, row });
  const owner = (id: string, trail = new Set<string>()): string => {
    if (trail.has(id)) throw invalid(); trail.add(id);
    const target = byId.get(id); if (!target) throw invalid();
    if (target.table === 'works') return id;
    const row = target.row;
    if (row.work_id !== undefined) {
      if (typeof row.work_id !== 'string' || byId.get(row.work_id)?.table !== 'works') throw invalid(); return row.work_id;
    }
    const parent = row.chapter_id ?? row.entry_id ?? row.conversation_id;
    if (typeof parent !== 'string') throw invalid(); return owner(parent, trail);
  };
  const references: Record<string, Table[]> = { work_id:['works'], volume_id:['volumes'], chapter_id:['chapters'], entry_id:['entries'],
    from_entry:['entries'],to_entry:['entries'],from_chapter_id:['chapters'],to_chapter_id:['chapters'],supersedes_id:['entry_facts'],
    target_entry_id:['entries'],finalized_version_id:['chapter_versions'],summary_source_version_id:['chapter_versions'],source_job_id:['jobs'],conversation_id:['conversations'],message_id:['messages'],
    evidence_version_id:['chapter_versions'],evidence_proposal_id:['memory_proposals'],a_version_id:['chapter_versions'],b_version_id:['chapter_versions'] };
  const required: Partial<Record<Table,string[]>> = { volumes:['work_id'],chapters:['work_id','volume_id'],chapter_versions:['chapter_id'],entries:['work_id'],entry_facts:['entry_id'],relations:['work_id','from_entry','to_entry'],conversations:['work_id'],messages:['conversation_id'],jobs:['work_id'],memory_proposals:['work_id','chapter_id'],conflicts:['work_id'],adoption_receipts:['work_id'] };
  const array = (value: SqlValue): unknown[] => { const parsed: unknown = JSON.parse(String(value)); if (!Array.isArray(parsed)) throw invalid(); return parsed; };
  const scopedIds = (values: unknown[], table: Table, work: string, requireExisting = false): string[] => values.map(value => {
    if (typeof value !== 'string') throw invalid();
    const target = byId.get(value);
    if (requireExisting && !target || target && (target.table !== table || owner(value) !== work)) throw invalid();
    return value;
  });
  const scopedSource = (value: SqlValue, work: string) => {
    if (value === null || value === undefined) return;
    if (typeof value !== 'string') throw invalid();
    const ref = /^(?:chapter|entry|fact|version|conflict|revert|proposal):(.+)$/.exec(value)?.[1] ?? /^(.+):\d+$/.exec(value)?.[1] ?? value;
    if (byId.has(ref) && owner(ref) !== work) throw invalid();
  };
  for (const [id, {table,row}] of byId) {
    const work = owner(id);
    if (table === 'works' && (row.cover_path != null || row.cover_token != null)) throw invalid();
    for (const key of required[table] ?? []) if (typeof row[key] !== 'string' || !byId.has(String(row[key]))) throw invalid();
    for (const [key, allowed] of Object.entries(references)) {
      const value = row[key]; if (value === null || value === undefined) continue;
      if (typeof value !== 'string') throw invalid();
      const target = byId.get(value);
      // A missing interval endpoint must never become null (which means unbounded validity).
      if(['from_chapter_id','to_chapter_id'].includes(key)&&!target)throw invalid();
      // Deleted historical anchors may be absent from a portable live-only backup; cross-work links may never survive.
      if (target && (!allowed.includes(target.table) || owner(value) !== work)) throw invalid();
    }
    if (table === 'entry_facts' && row.supersedes_id) {
      const previous = byId.get(String(row.supersedes_id));
      if (previous && previous.row.entry_id !== row.entry_id) throw invalid();
    }
    if (table === 'chapters') for (const key of ['finalized_version_id','summary_source_version_id']) if (row[key]) {
      const version = byId.get(String(row[key])); if (version && version.row.chapter_id !== row.id) throw invalid();
    }
    for (const key of ['source_ref', 'a_ref', 'b_ref']) if (key in row) scopedSource(row[key], work);
    if (table === 'conversations') {
      const scope: unknown = JSON.parse(String(row.scope));
      if (!object(scope) || !['confirmed','chapter'].includes(String(scope.kind)) || typeof scope.includeProposed !== 'boolean'
        || scope.chapterId !== null && typeof scope.chapterId !== 'string') throw invalid();
      if (scope.chapterId !== null) scopedIds([scope.chapterId], 'chapters', work);
    }
    if (table === 'memory_proposals') {
      if (row.accepted_value !== undefined && row.accepted_value !== null && (typeof row.accepted_value !== 'string' || [...row.accepted_value].length > 300)) throw invalid();
      if (row.applied_fact_ids) scopedIds(array(row.applied_fact_ids), 'entry_facts', work);
      if (row.evidence_version_id) {
        const version=byId.get(String(row.evidence_version_id));
        if (!version || version.row.chapter_id!==row.chapter_id) throw invalid();
      }
      if (row.evidence_proposal_id) {
        const proposal=byId.get(String(row.evidence_proposal_id));
        if (!proposal || proposal.row.chapter_id!==row.chapter_id || proposal.row.status!=='accepted' || proposal.row.origin==='deletion') throw invalid();
      }
    }
    if (table === 'messages' && row.structured) {
      const structured: unknown = JSON.parse(String(row.structured));
      if (!object(structured) || !Array.isArray(structured.options)) throw invalid();
      for (const option of structured.options) {
        if (!object(option)) throw invalid();
        for (const [key,targetTable] of [['entryIds','entries'],['factIds','entry_facts']] as const) {
          if (!Array.isArray(option[key])) throw invalid();
          for (const ref of option[key]) if (typeof ref !== 'string' || byId.has(ref) && (byId.get(ref)!.table !== targetTable || owner(ref) !== work)) throw invalid();
        }
      }
    }
    if (table === 'adoption_receipts') {
      const entryIds = scopedIds(array(row.entry_ids), 'entries', work, true);
      const facts = scopedIds(array(row.fact_ids), 'entry_facts', work, true);
      const created = scopedIds(array(row.created_entries), 'entries', work, true);
      if (!entryIds.length || new Set(entryIds).size !== entryIds.length || created.some(ref => !entryIds.includes(ref))
        || facts.some(ref => !entryIds.includes(String(byId.get(ref)!.row.entry_id)))) throw invalid();
      const before: unknown = JSON.parse(String(row.before_facts));
      if (!object(before) || !Array.isArray(before.facts) || !Array.isArray(before.states)) throw invalid();
      for (const fact of before.facts) {
        if (!object(fact) || typeof fact.id !== 'string' || !entryIds.includes(String(fact.entry_id))
          || ![0,1].includes(Number(fact.is_current))) throw invalid();
        scopedIds([fact.id], 'entry_facts', work, true);
        if (byId.get(fact.id)!.row.entry_id !== fact.entry_id) throw invalid();
        for (const key of ['from_chapter_id','to_chapter_id']) if (fact[key] !== null && fact[key] !== undefined) scopedIds([fact[key]], 'chapters', work, true);
      }
      for (const state of before.states) if (!object(state) || !entryIds.includes(String(state.id))
        || typeof state.state !== 'string' || created.includes(String(state.id))) throw invalid();
      if (row.message_id) {
        const message = byId.get(String(row.message_id)); if (message?.table !== 'messages' || !Number.isSafeInteger(row.option_index)) throw invalid();
        const structured = JSON.parse(String(message.row.structured)); const option = structured?.options?.[Number(row.option_index)];
        if (!option || !['adopted','stashed'].includes(option.state) || JSON.stringify(option.entryIds) !== JSON.stringify(entryIds)
          || JSON.stringify(option.factIds) !== JSON.stringify(facts)) throw invalid();
      }
    }
  }
  const targetIds=new Set<string>();
  for(const target of data.relationTargets??[]){
    if(typeof target.proposal_id!=='string'||targetIds.has(target.proposal_id))throw invalid();targetIds.add(target.proposal_id);
    const proposal=byId.get(target.proposal_id);
    if(proposal?.table!=='memory_proposals'||proposal.row.target_type!=='relation')throw invalid();
    const work=owner(target.proposal_id);
    scopedIds([target.from_entry_id,target.to_entry_id],'entries',work,true);
    if(target.from_entry_id===target.to_entry_id)throw invalid();
    if(target.relation_id!==null)scopedIds([target.relation_id],'relations',work);
    // Imported analysis is history; no partial snapshot may grant an undo or pending adoption.
    if(target.before_rows!==null||target.created_ids!==null||target.after_fingerprint!==null||typeof target.expected_fingerprint!=='string')throw invalid();
  }
}
async function receiptFingerprintIn(tx: Db, entryIds: string[]): Promise<string> {
  const data = [];
  for (const id of entryIds) data.push({ entry: await tx.get('SELECT * FROM entries WHERE id=?',[id]),
    facts: await tx.all('SELECT * FROM entry_facts WHERE entry_id=? ORDER BY id',[id]),
    relations: await tx.all('SELECT * FROM relations WHERE from_entry=? OR to_entry=? ORDER BY id',[id,id]) });
  return fingerprint(data);
}
export async function build(workId?:string):Promise<Uint8Array>{
  const {manifest,data,coverReferences}=await db().transaction(async tx=>{
    const works=await tx.all<Row>(`SELECT * FROM works WHERE deleted_at IS NULL${workId?' AND id=?':''}`,workId?[workId]:[]);
    if(workId&&!works.length)throw new AppError('NOT_FOUND','作品不存在。');
    if (works.some(w => Boolean(w.cover_path) !== Boolean(w.cover_token))) throw new AppError('VALIDATION', '图片封面缺少安全文件引用，请重新选择封面后备份；仍可导出正文。');
    const references = works.filter(w => w.cover_token).map(w => ({ workId: String(w.id), token: String(w.cover_token), path: `covers/${uuid()}.jpg` }));
    const ids=works.map(w=>String(w.id));const tables:Data['tables']={works: works.map(w => ({ ...w, cover_path: null, cover_token: null }))};
    for(const table of TABLES.filter(t=>t!=='works')){
      let rows:Row[]=[];
      if(ids.length){
        const holes=ids.map(()=>'?').join(',');
        if(table==='chapter_versions')rows=await tx.all<Row>(`SELECT v.* FROM chapter_versions v JOIN chapters c ON c.id=v.chapter_id WHERE c.work_id IN (${holes}) AND c.deleted_at IS NULL`,ids);
        else if(table==='entry_facts')rows=await tx.all<Row>(`SELECT f.* FROM entry_facts f JOIN entries e ON e.id=f.entry_id WHERE e.work_id IN (${holes}) AND e.deleted_at IS NULL`,ids);
        else if(table==='messages')rows=await tx.all<Row>(`SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.work_id IN (${holes})`,ids);
        else rows=await tx.all<Row>(`SELECT * FROM ${table} WHERE work_id IN (${holes})${['chapters','entries','relations'].includes(table)?' AND deleted_at IS NULL':''}`,ids);
      }
      tables[table]=rows;
    }
    const liveChapters=new Set((tables.chapters??[]).map(r=>r.id));
    const liveEntries=new Set((tables.entries??[]).map(r=>r.id));
    for(const row of [...tables.entry_facts??[],...tables.relations??[]])for(const key of ['from_chapter_id','to_chapter_id'])
      if(row[key]&&!liveChapters.has(row[key]))throw new AppError('VALIDATION','档案历史或关系引用了回收站中的章节。请先恢复相关章节并核对生效范围，再生成完整备份；仍可导出正文。');
    tables.relations=(tables.relations??[]).filter(r=>liveEntries.has(r.from_entry)&&liveEntries.has(r.to_entry));
    tables.jobs=[]; // Portable backups never include the executable queue.
    tables.memory_proposals=(tables.memory_proposals??[]).filter(r=>liveChapters.has(r.chapter_id));
    tables.messages=(tables.messages??[]).map(row=>({...row,error:null}));
    const liveFacts=new Set((tables.entry_facts??[]).map(row=>row.id));
    const liveMessages=new Set((tables.messages??[]).map(row=>row.id));
    tables.adoption_receipts=(tables.adoption_receipts??[]).filter(row=>row.message_id && liveMessages.has(row.message_id) && JSON.parse(String(row.entry_ids)).every((id:string)=>liveEntries.has(id)) && JSON.parse(String(row.fact_ids)).every((id:string)=>liveFacts.has(id)));
    // An edit after adoption already invalidated its undo. Restoring cannot grant it fresh authority.
    const safeReceipts: Row[]=[];
    for(const receipt of tables.adoption_receipts) if(receipt.after_fingerprint===await receiptFingerprintIn(tx,JSON.parse(String(receipt.entry_ids))))safeReceipts.push(receipt);
    tables.adoption_receipts=safeReceipts;
    for(const receipt of safeReceipts)for(const row of JSON.parse(String(receipt.before_facts)).facts as Row[])for(const key of ['from_chapter_id','to_chapter_id'])
      if(row[key]&&!liveChapters.has(row[key]))throw new AppError('VALIDATION','采纳撤销历史引用了回收站中的章节。请先恢复相关章节并核对，再生成完整备份。');
    const servicesRaw=workId?[]:await tx.all<Row>('SELECT id,name,protocol,base_url,model,options,is_default,created_at,updated_at FROM model_services');
    const services=servicesRaw.map(row=>safeService(row));
    const liveProposals=new Set((tables.memory_proposals??[]).map(row=>row.id));
    const relationTargets=(await tx.all<Row>('SELECT * FROM proposal_relation_targets')).filter(row=>liveProposals.has(row.proposal_id)&&liveEntries.has(row.from_entry_id)&&liveEntries.has(row.to_entry_id))
      .map(row=>({...row,expected_fingerprint:'unavailable',before_rows:null,created_ids:null,after_fingerprint:null}));
    const metadata:Manifest={format:FORMAT,schema:SCHEMA_VERSION,app:appInfo.cached()?.version??'未知',exportedAt:nowIso(),works:works.map(w=>({id:String(w.id),title:w.title as string|null,
      chapters:(tables.chapters??[]).filter(c=>c.work_id===w.id).length,chars:(tables.chapters??[]).filter(c=>c.work_id===w.id).reduce((n,c)=>n+Number(c.char_count),0)}))};
    return {manifest:metadata,data:{tables,services,relationTargets,coverAssets:references.map(({workId:owner,path})=>({workId:owner,path,mimeType:'image/jpeg' as const}))},coverReferences:references};
  });
  const attachments: Record<string, Uint8Array> = {};
  // Immutable tokens keep the DB snapshot meaningful. A concurrent removal fails the backup instead of omitting bytes.
  for (const reference of coverReferences) {
    const content = await covers.readCover(reference.token); const bytes = fromBase64(content.base64);
    if (!validCover(bytes)) throw new AppError('VALIDATION', '封面文件已损坏，请重新选择封面后备份；仍可导出正文。');
    attachments[reference.path] = bytes;
  }
  const files = inspectionFiles({ manifest, data, attachments });
  if(Object.values(files).reduce((total,bytes)=>total+bytes.length,0)>MAX_BYTES)throw new AppError('VALIDATION','备份解压后超过 50 MiB，请按作品分别导出。');
  const archive=zipSync(files);
  if(archive.length>MAX_BYTES)throw new AppError('VALIDATION','备份超过 50 MiB，请按作品分别导出。');return archive;
}
export function inspect(bytes:Uint8Array):BackupInspection{
  if(bytes.length>MAX_BYTES)throw invalid();
  try{
    let total=0; const names=new Set<string>();
    const files=unzipSync(bytes,{filter:entry=>{if(!['manifest.json','data.json'].includes(entry.name)&&!coverPath.test(entry.name)||names.has(entry.name)||!Number.isSafeInteger(entry.originalSize)||entry.originalSize<0||coverPath.test(entry.name)&&entry.originalSize>covers.MAX_COVER_BYTES)throw invalid();names.add(entry.name);total+=entry.originalSize;if(total>MAX_BYTES)throw invalid();return true;}});
    if(!files['manifest.json']||!files['data.json']||Object.values(files).reduce((size,content)=>size+content.length,0)>MAX_BYTES)throw invalid();
    const manifest:unknown=JSON.parse(strFromU8(files['manifest.json']));const data:unknown=JSON.parse(strFromU8(files['data.json']));
    if(!object(manifest)||!Number.isSafeInteger(manifest.format)||!Number.isSafeInteger(manifest.schema))throw invalid();
    if(Number(manifest.format)>FORMAT||Number(manifest.schema)>SCHEMA_VERSION)throw new AppError('BACKUP_TOO_NEW','这个备份由更新版本的 App 导出，请先升级 App 再恢复。');
    if(manifest.format!==FORMAT||Number(manifest.schema)<1||typeof manifest.exportedAt!=='string'||!Array.isArray(manifest.works)||!object(data)||!object(data.tables)||!Array.isArray(data.services)
      ||Object.keys(data).some(key=>!['tables','services','relationTargets','coverAssets'].includes(key))||data.relationTargets!==undefined&&!Array.isArray(data.relationTargets)||data.coverAssets!==undefined&&!Array.isArray(data.coverAssets))throw invalid();
    const ids=new Set<string>();
    for(const [table,rows]of Object.entries(data.tables)){
      if(!TABLES.includes(table as Table)||!Array.isArray(rows)||rows.length>100000)throw invalid();
      for(const row of rows){if(!object(row)||typeof row.id!=='string'||!row.id||row.id.length>200||ids.has(row.id)||!Object.values(row).every(scalar))throw invalid();ids.add(row.id);}
    }
    if(!Array.isArray(data.tables.works))throw invalid();
    if(Array.isArray(data.tables.jobs)&&data.tables.jobs.length)throw invalid();
    for(const service of data.services){if(!object(service)||typeof service.id!=='string'||!service.id||ids.has(service.id)||!Object.values(service).every(scalar))throw invalid();ids.add(service.id);safeService(service as Row,true);}
    for(const target of data.relationTargets??[]){if(!object(target)||!Object.values(target).every(scalar)||Object.keys(target).some(key=>!['proposal_id','from_entry_id','to_entry_id','relation_id','expected_fingerprint','before_rows','created_ids','after_fingerprint'].includes(key)))throw invalid();}
    const workIds=new Set((data.tables.works as Row[]).map(row=>row.id));
    const attachmentWorks = new Set<string>(); const attachments: Record<string, Uint8Array> = {};
    for (const asset of data.coverAssets ?? []) {
      if (!object(asset) || Object.keys(asset).some(key => !['workId','path','mimeType'].includes(key))
        || typeof asset.workId !== 'string' || !workIds.has(asset.workId) || attachmentWorks.has(asset.workId)
        || typeof asset.path !== 'string' || !coverPath.test(asset.path) || asset.mimeType !== 'image/jpeg'
        || attachments[asset.path] || !files[asset.path] || !validCover(files[asset.path])) throw invalid();
      attachmentWorks.add(asset.workId); attachments[asset.path] = files[asset.path];
    }
    if (Object.keys(files).some(name => !['manifest.json','data.json'].includes(name) && !attachments[name])) throw invalid();
    const manifestIds=new Set<string>();
    if(manifest.works.length!==workIds.size||manifest.works.some(value=>{if(!object(value)||!workIds.has(String(value.id))||manifestIds.has(String(value.id))||!Number.isSafeInteger(value.chapters)||Number(value.chapters)<0||!Number.isSafeInteger(value.chars)||Number(value.chars)<0)return true;manifestIds.add(String(value.id));return false;}))throw invalid();
    validateGraph(data as unknown as Data);
    return {manifest:manifest as unknown as Manifest,data:data as unknown as Data,services:data.services.length,...(Object.keys(attachments).length?{attachments}:{})};
  }catch(error){if(error instanceof AppError&&['BACKUP_INVALID','BACKUP_TOO_NEW'].includes(error.code))throw error;throw invalid();}
}
const REFERENCES=new Set(['work_id','volume_id','chapter_id','entry_id','from_entry','to_entry','from_chapter_id','to_chapter_id','supersedes_id','target_entry_id','finalized_version_id','summary_source_version_id','source_job_id','conversation_id','service_id','message_id','evidence_version_id','evidence_proposal_id','a_version_id','b_version_id']);
export async function restore(inspection:BackupInspection,options:{workIds:string[];includeServices:boolean}):Promise<{works:number;services:number}>{
  // Validate again so callers cannot mutate the inspected object into an unchecked import.
  const checked=inspect(zipSync(inspectionFiles(inspection)));
  const selected=new Set(options.workIds);const rows=checked.data.tables;const allWork=new Set((rows.works??[]).map(w=>String(w.id)));
  if([...selected].some(id=>!allWork.has(id)))throw invalid();
  const included=new Set<string>();const filtered:Data['tables']={};
  for(const table of TABLES){
    filtered[table]=(rows[table]??[]).filter(r=>table==='works'?selected.has(String(r.id)):
      r.work_id?selected.has(String(r.work_id)):r.chapter_id?included.has(String(r.chapter_id)):r.entry_id?included.has(String(r.entry_id)):r.conversation_id?included.has(String(r.conversation_id)):false);
    filtered[table]!.forEach(r=>included.add(String(r.id)));
  }
  const ids=new Map<string,string>([...included].map(id=>[id,uuid()]));
  const services=options.includeServices?checked.data.services:[];
  services.forEach(s=>ids.set(String(s.id),uuid()));
  const remapRef=(v:SqlValue):SqlValue=>typeof v!=='string'?v:ids.get(v)??null;
  const sourceRef=(v:SqlValue):SqlValue=>{if(typeof v!=='string')return v;if(ids.has(v))return ids.get(v)!;const prefixed=/^(chapter|entry|fact|version|conflict|revert|proposal):(.+)$/.exec(v);if(prefixed)return `${prefixed[1]}:${ids.get(prefixed[2])??'unavailable'}`;const partner=/^(.+):(\d+)$/.exec(v);if(partner&&ids.has(partner[1]))return `${ids.get(partner[1])}:${partner[2]}`;return null;};
  const title=(base:string,used:Set<string>)=>{let next=base;let n=1;while(used.has(next)){next=`${base}（恢复${n===1?'':` ${n}`}）`;n++;}used.add(next);return next;};
  const prepared = new Map<string, covers.CoverAsset>();
  try {
  for (const asset of checked.data.coverAssets ?? []) if (selected.has(asset.workId)) {
    prepared.set(asset.workId, await covers.importCover({ base64: toBase64(checked.attachments![asset.path]), mimeType: 'image/jpeg' }));
  }
  await db().transaction(async tx=>{
    const workTitles=new Set((await tx.all<{title:string}>('SELECT title FROM works')).map(w=>w.title));
    for(const table of TABLES){
      const allowed=new Set(await tableColumns(tx,table));
      for(const original of filtered[table]??[]){
        if(Object.keys(original).some(k=>!allowed.has(k)))throw invalid();
        const row:Row={...original,id:ids.get(String(original.id))!};
        for(const key of REFERENCES)if(key in row&&row[key]!==null)row[key]=remapRef(row[key]);
        if('source_ref'in row&&row.source_ref!==null)row.source_ref=sourceRef(row.source_ref);
        if(table==='works'){
          row.title=title(String(row.title??'未命名作品'),workTitles);row.deleted_at=null;row.context_revision=0;
          const asset = prepared.get(String(original.id)); row.cover_token = asset?.token ?? null; row.cover_path = asset?.uri ?? null;
        }
        if(table==='chapters'){row.deleted_at=null;}
        if(table==='jobs'){row.status='paused';row.pause_reason='legacy_input';row.execution_token=null;row.operation_id=null;row.service_id=null;row.service_revision=null;row.input_fingerprint=null;row.plan_id=null;}
        if(table==='messages'){
          if(row.status==='streaming')row.status='stopped';
          if(row.structured){try{const st=JSON.parse(String(row.structured));for(const o of st.options??[]){o.entryIds=(o.entryIds??[]).map((v:string)=>ids.get(v)).filter(Boolean);o.factIds=(o.factIds??[]).map((v:string)=>ids.get(v)).filter(Boolean);}row.structured=JSON.stringify(st);}catch{throw invalid();}}
        }
        if(table==='conversations'){try{const scope=JSON.parse(String(row.scope));scope.chapterId=scope.chapterId?ids.get(scope.chapterId)??null:null;if(!scope.chapterId)scope.kind='confirmed';row.scope=JSON.stringify(scope);}catch{throw invalid();}}
        if(table==='memory_proposals'&&row.applied_fact_ids){try{row.applied_fact_ids=JSON.stringify(JSON.parse(String(row.applied_fact_ids)).map((id:string)=>ids.get(id)).filter(Boolean));}catch{throw invalid();}}
        if(table==='conflicts'){row.a_ref=sourceRef(row.a_ref)??'unavailable';row.b_ref=sourceRef(row.b_ref)??'unavailable';}
        if(table==='adoption_receipts'){
          for(const key of ['created_entries','entry_ids','fact_ids'])row[key]=JSON.stringify(JSON.parse(String(row[key])).map((id:string)=>ids.get(id)).filter(Boolean));
          const before=JSON.parse(String(row.before_facts));const facts=Array.isArray(before)?before:before.facts;
          row.before_facts=JSON.stringify({facts:facts.map((fact:Row)=>{const next={...fact};for(const key of ['id','entry_id','from_chapter_id','to_chapter_id','supersedes_id'])if(next[key])next[key]=remapRef(next[key]);next.source_ref=sourceRef(next.source_ref);return next;}),states:(before.states??[]).map((state:{id:string;state:string})=>({...state,id:ids.get(state.id)}))});
        }
        // Supersedes chains can point at later rows: insert null first, restore after all facts exist.
        if(table==='entry_facts')row.supersedes_id=null;
        const keys=Object.keys(row);await tx.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>row[k]));
      }
    }
    for(const target of checked.data.relationTargets??[])if(included.has(String(target.proposal_id)))await tx.run(`INSERT INTO proposal_relation_targets
      (proposal_id,from_entry_id,to_entry_id,relation_id,expected_fingerprint,before_rows,created_ids,after_fingerprint) VALUES (?,?,?,?,?,NULL,NULL,NULL)`,
      [remapRef(target.proposal_id),remapRef(target.from_entry_id),remapRef(target.to_entry_id),remapRef(target.relation_id),'unavailable']);
    for(const fact of filtered.entry_facts??[])if(fact.supersedes_id)await tx.run('UPDATE entry_facts SET supersedes_id=? WHERE id=?',[ids.get(String(fact.supersedes_id))??null,ids.get(String(fact.id))!]);
    const serviceNames=new Set((await tx.all<{name:string}>('SELECT name FROM model_services')).map(s=>s.name));
    let hasDefault=Boolean(await tx.get('SELECT id FROM model_services LIMIT 1'));
    for(const svc of services){
      const allowed=SERVICE_COLUMNS;
      if(Object.keys(svc).some(k=>!allowed.includes(k)))throw invalid();
      // Validate a restored service exactly like the settings form, without any credential.
      safeService(svc,true);
      const draft=validateDraft({name:String(svc.name),protocol:svc.protocol as 'openai_responses',baseUrl:String(svc.base_url),model:String(svc.model),options:JSON.parse(String(svc.options))});
      await tx.run('INSERT INTO model_services (id,name,protocol,base_url,model,options,is_default,has_key,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,1,?,?)',
        [ids.get(String(svc.id))!,title(draft.name,serviceNames),draft.protocol,draft.baseUrl,draft.model,JSON.stringify(draft.options),hasDefault?0:1,nowIso(),nowIso()]);hasDefault=true;
    }
    for(const receipt of filtered.adoption_receipts??[]){
      const entryIds: string[]=JSON.parse(String(receipt.entry_ids));
      await tx.run('UPDATE adoption_receipts SET after_fingerprint=? WHERE id=?',[await receiptFingerprintIn(tx,entryIds.map(id=>ids.get(id)!)),ids.get(String(receipt.id))!]);
    }
    if(await tx.get('PRAGMA foreign_key_check'))throw invalid();
  });
  } catch (error) {
    // New immutable bytes have no owner after rollback; failed cleanup remains durable in CoverStore.
    for (const asset of prepared.values()) await covers.removeCover(asset.token).catch(() => {});
    throw error;
  }
  for(const id of selected)emit('work.created',{workId:ids.get(id)!});
  if(services.length)emit('services.changed',{});
  return {works:selected.size,services:services.length};
}
export async function exportText(workId:string,options:{format:'txt'|'md';chapterIds?:string[]}):Promise<string>{
  await requireWorkIn(db(),workId);const work=await db().get<{title:string|null}>('SELECT title FROM works WHERE id=?',[workId]);const list=(await chapters.list(workId)).flatMap(g=>g.chapters).filter(ch=>options.chapterIds?ch.kind!=='draft'&&options.chapterIds.includes(ch.id):ch.kind==='main');
  if(!list.length)throw new AppError('VALIDATION','没有可导出的正文章节，请重新选择。');
  const pieces=[`${options.format==='md'?'# ':''}${work?.title??'未命名作品'}`];
  for(const ch of list){const full=await chapters.get(ch.id);pieces.push(`${options.format==='md'?'## ':''}${chapterHeading(ch)}\n\n${full.body.split('\n').map(p=>p?`　　${p}`:'').join('\n')}`);}
  return '\uFEFF'+pieces.join('\n\n');
}
