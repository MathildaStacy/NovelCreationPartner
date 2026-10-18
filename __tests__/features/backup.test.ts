import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import { db, setDb } from '../../src/data/db';
import { freshDb, tickingClock } from '../helpers/db';
import * as backup from '../../src/features/backup';
import * as works from '../../src/features/works';
import * as chapters from '../../src/features/chapters';
import * as entries from '../../src/features/entries';
import * as conversations from '../../src/features/conversations';
import * as partner from '../../src/features/partner';
import * as relations from '../../src/features/relations';
import * as models from '../../src/features/modelServices';
import * as covers from '../../src/features/covers';
import { fromBase64 } from '../../src/files/base64';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { on } from '../../src/features/events';
import type { Row } from '../../src/data/db';
jest.mock('../../src/secure', () => ({ getKey: jest.fn(async () => 'secret-real-key'), setKey: jest.fn(async () => {}), removeKey: jest.fn(async () => {}) }));
beforeEach(async () => { tickingClock(); await freshDb(); });
afterEach(async () => { covers.setCoverStoreDriver(undefined); await db().close(); setDb(null); });
async function fixture() {
  const work = await works.create({ title: '归潮', premise: '海上灵感' });
  const volume = (await chapters.list(work.id))[0].volume;
  const chapter = await chapters.create({ workId: work.id, volumeId: volume.id, title: '开端' });
  await chapters.saveBody(chapter.id, '林宇从海边归来。', 0); await chapters.finalize(chapter.id);
  const entry = await entries.create({ workId: work.id, type: 'character', name: '林宇', facts: [{ field: 'identity', value: '少年', fromChapterId: chapter.id }] });
  await entries.update(entry.id, { facts: [{ field: 'identity', value: '船医' }] });
  const conversation = await conversations.create(work.id);
  const messageId = 'fixture-message';
  const options = [0, 1].map(i => ({ title: `方向${i}`, summary: '回家', direction: '归来', risks: '风暴', impact: '成长', state: 'open', entryIds: [], factIds: [] }));
  await db().run("INSERT INTO messages (id,conversation_id,role,content,status,structured,error,created_at) VALUES (?,?,'assistant','建议','done',?,NULL,'2026-10-18')", [messageId, conversation.id, JSON.stringify({ known: [], questions: [], options })]);
  await partner.adopt(messageId, 0, [{ action: 'create', type: 'world', name: '灵镜', targetEntryId: null, summary: '海上传说', facts: [{ field: 'content', value: '灵镜能指引归路', before: null }] }]);
  await db().run('UPDATE messages SET error = ? WHERE id = ?', [JSON.stringify({ message: 'sensitive-error-data' }), messageId]);
  await models.save({ name: 'Service', protocol: 'openai_responses', baseUrl: 'https://example.test/v1', model: 'fixture', options: DEFAULT_OPTIONS }, 'secret-real-key');
  return { work, chapter, entry, messageId };
}
const pack = (value: backup.BackupInspection) => zipSync({ 'manifest.json': strToU8(JSON.stringify(value.manifest)), 'data.json': strToU8(JSON.stringify(value.data)), ...value.attachments });
// A generated one-pixel JPEG exercises attachment parsing; native file behavior is tested separately.
const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwBKKKKAP//Z';
const coverToken = '11111111-1111-4111-8111-111111111111';
const coverAsset = (token: string) => ({ token, uri: `file:///private/novel/covers/${token}.jpg` });
function coverDriver() {
  let counter = 2;
  const driver: covers.CoverStoreDriver = { pick: jest.fn(async () => JSON.stringify(coverAsset(coverToken))),
    importImage: jest.fn(async () => JSON.stringify(coverAsset(`${counter++}2222222-2222-4222-8222-222222222222`))),
    read: jest.fn(async () => JSON.stringify({ base64: jpeg, mimeType: 'image/jpeg' })), remove: jest.fn(async () => {}), prune: jest.fn(async () => {}) };
  covers.setCoverStoreDriver(driver); return driver;
}

test('portable backup excludes keys, queues, ledger/test details, trash and keeps adoption safe undo after additive ID remap', async () => {
  const { work, chapter, entry, messageId } = await fixture();
  await partner.adopt(messageId, 1, [{ action: 'update', type: 'character', name: '林宇', targetEntryId: entry.id, summary: '', facts: [{ field: 'identity', value: '舰长', before: '船医' }] }]);
  const removed = await entries.create({ workId: work.id, type: 'place', name: '垃圾内容' }); await entries.remove(removed.id);
  await db().run("UPDATE model_services SET options = ?", [JSON.stringify({ ...DEFAULT_OPTIONS, hiddenKey: 'never-export-secret' })]);
  const bytes = await backup.build(); const files = unzipSync(bytes); const raw = strFromU8(files['data.json']);
  expect(raw).not.toContain('secret-real-key'); expect(raw).not.toContain('never-export-secret'); expect(raw).not.toContain('sensitive-error-data');
  expect(raw).not.toContain('ai_attempts'); expect(raw).not.toContain('垃圾内容');
  const inspection = backup.inspect(bytes); expect(inspection.data.tables.jobs).toEqual([]);
  const oldIds = new Set(Object.values(inspection.data.tables).flatMap(rows => rows?.map(row => row.id) ?? []));
  expect(await backup.restore(inspection, { workIds: [work.id], includeServices: true })).toEqual({ works: 1, services: 1 });
  expect((await chapters.get(chapter.id)).body).toBe('林宇从海边归来。');
  const copied = (await works.list()).find(w => w.id !== work.id)!;
  expect(copied.title).toBe('归潮（恢复）');
  const restoredChapters = (await chapters.list(copied.id)).flatMap(group => group.chapters); expect(oldIds.has(restoredChapters[0].id)).toBe(false);
  const full = await chapters.get(restoredChapters[0].id); expect(oldIds.has(full.finalizedVersionId!)).toBe(false);
  const restoredConversation = (await conversations.list(copied.id))[0];
  const restoredMessage = (await conversations.messages(restoredConversation.id))[0];
  expect(restoredMessage.id).not.toBe(messageId); expect(restoredMessage.error).toBeNull();
  const state = restoredMessage.structured!.options[0]; expect(state.state).toBe('adopted'); expect(oldIds.has(state.entryIds[0])).toBe(false);
  await partner.undo(restoredMessage.id, 1);
  const restoredCharacter = (await entries.list(copied.id)).find(e => e.name === '林宇')!;
  expect((await entries.get(restoredCharacter.id)).facts.find(f => f.field === 'identity')?.value).toBe('船医');
  await partner.undo(restoredMessage.id, 0); expect((await entries.list(copied.id)).map(e => e.name)).not.toContain('灵镜');
  const services = await models.list(); const restored = services.find(s => s.name === 'Service（恢复）')!; expect(restored.hasKey).toBe(false);
  expect((await db().all<Row>('SELECT * FROM jobs WHERE work_id = ?', [copied.id]))).toEqual([]);
  await backup.restore(inspection, { workIds: [work.id], includeServices: false });
  expect((await works.list()).map(w => w.title)).toContain('归潮（恢复 2）');
});

test('cross-work links, unknown columns, secret service options and future schema reject without changing existing data', async () => {
  const { work } = await fixture(); const other = await works.create({ title: '另一部', premise: '独立作品' });
  const otherVolume = (await chapters.list(other.id))[0].volume;
  const inspection = backup.inspect(await backup.build());
  const tampered = () => JSON.parse(JSON.stringify(inspection)) as backup.BackupInspection;
  const cross = tampered(); cross.data.tables.chapters![0].volume_id = otherVolume.id;
  expect(() => backup.inspect(pack(cross))).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  const secret = tampered(); secret.data.services[0].options = JSON.stringify({ ...DEFAULT_OPTIONS, key: 'do-not-import' });
  expect(() => backup.inspect(pack(secret))).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  const future = tampered(); future.manifest.schema += 100;
  expect(() => backup.inspect(pack(future))).toThrow(expect.objectContaining({ code: 'BACKUP_TOO_NEW' }));
  const unknown = tampered(); unknown.data.tables.works![0].injected_column = 'x';
  await expect(backup.restore(unknown, { workIds: [work.id], includeServices: false })).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
  expect(await works.list()).toHaveLength(2);
});

test('nested receipt/scope/source references cannot cross works and rollback after partial insertion emits nothing', async () => {
  const { work } = await fixture(); const other = await works.create({ title: '另一部', premise: '独立作品' });
  const volume = (await chapters.list(other.id))[0].volume;
  const otherChapter = await chapters.create({workId:other.id,volumeId:volume.id,title:'异地'});
  const otherEntry = await entries.create({workId:other.id,type:'world',name:'禁地'});
  const inspection = backup.inspect(await backup.build());
  const tampered = () => JSON.parse(JSON.stringify(inspection)) as backup.BackupInspection;
  const scope = tampered(); scope.data.tables.conversations![0].scope = JSON.stringify({kind:'chapter',chapterId:otherChapter.id,includeProposed:false});
  expect(() => backup.inspect(pack(scope))).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  const source = tampered(); source.data.tables.entries!.find(row=>row.work_id===work.id)!.source_ref = `entry:${otherEntry.id}`;
  expect(() => backup.inspect(pack(source))).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  const receipt = tampered(); receipt.data.tables.adoption_receipts![0].created_entries = JSON.stringify([otherEntry.id]);
  expect(() => backup.inspect(pack(receipt))).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  const unknown = tampered(); unknown.data.tables.entries!.find(row=>row.work_id===work.id)!.injected_column = 'x';
  const before = await db().all('SELECT * FROM works ORDER BY id'); const emitted = jest.fn(); const off = on('work.created',emitted);
  await expect(backup.restore(unknown, {workIds:[work.id],includeServices:true})).rejects.toMatchObject({code:'BACKUP_INVALID'});
  expect(await db().all('SELECT * FROM works ORDER BY id')).toEqual(before); expect(await db().all('SELECT * FROM model_services')).toHaveLength(1);
  expect(emitted).not.toHaveBeenCalled(); off();
});

test('backup cannot reactivate an undo invalidated by later edits and queues are never portable', async () => {
  const { work, messageId } = await fixture();
  const mirror = (await entries.list(work.id)).find(entry => entry.name === '灵镜')!;
  await entries.update(mirror.id,{facts:[{field:'content',value:'作者后来更改的内容'}]});
  const inspection = backup.inspect(await backup.build()); expect(inspection.data.tables.adoption_receipts).toEqual([]);
  await backup.restore(inspection,{workIds:[work.id],includeServices:false});
  const copy = (await works.list()).find(row=>row.id!==work.id)!;
  const conversation = (await conversations.list(copy.id))[0]; const message = (await conversations.messages(conversation.id))[0];
  expect(message.id).not.toBe(messageId); await expect(partner.undo(message.id,0)).rejects.toMatchObject({code:'NOT_FOUND'});
  expect((await entries.get((await entries.list(copy.id)).find(entry=>entry.name==='灵镜')!.id)).facts[0].value).toBe('作者后来更改的内容');
  inspection.data.tables.jobs=[{id:'hidden-job',work_id:work.id}];
  expect(()=>backup.inspect(pack(inspection))).toThrow(expect.objectContaining({code:'BACKUP_INVALID'}));
});

test('proposal evidence versions and accepted proposal links remap while runtime review audits remain local', async () => {
  const {work,chapter,entry}=await fixture(); const versionId=(await chapters.get(chapter.id)).finalizedVersionId!;
  await db().run(`INSERT INTO jobs(id,work_id,chapter_id,kind,status,created_at,updated_at) VALUES('local-job',?,?,'extract','done','2026-10-18','2026-10-18')`,[work.id,chapter.id]);
  await db().run(`INSERT INTO proposal_review_audits(source_job_id,base_input_fingerprint,current_input_fingerprint) VALUES('local-job','base','current')`);
  const insert=async(id:string,origin:string,status:string,prior:string|null)=>db().run(`INSERT INTO memory_proposals(id,work_id,chapter_id,kind,target_type,target_entry_id,target_name,field,after_value,evidence,evidence_offset,confidence,status,created_at,source_job_id,evidence_version_id,origin,evidence_proposal_id)
    VALUES(?,?,?,'retire','character',?,'林宇','identity',?,'林宇',0,'high',?,'2026-10-18','local-job',?,?,?)`,[id,work.id,chapter.id,entry.id,origin==='deletion'?'删除':'少年',status,versionId,origin,prior]);
  await insert('old-proposal','extraction','accepted',null); await insert('deletion-proposal','deletion','pending','old-proposal');
  const inspection=backup.inspect(await backup.build());expect(JSON.stringify(inspection)).not.toContain('proposal_review_audits');
  await backup.restore(inspection,{workIds:[work.id],includeServices:false});
  const copy=(await works.list()).find(row=>row.id!==work.id)!;const rows=await db().all<Row>('SELECT * FROM memory_proposals WHERE work_id=?',[copy.id]);
  const restoredOld=rows.find(row=>row.status==='accepted')!;const restoredDeletion=rows.find(row=>row.origin==='deletion')!;
  expect(restoredDeletion.evidence_proposal_id).toBe(restoredOld.id);expect(restoredDeletion.evidence_version_id).not.toBe(versionId);
  expect((await db().get<Row>('SELECT * FROM chapter_versions WHERE id=?',[restoredDeletion.evidence_version_id]))?.chapter_id).toBe(restoredDeletion.chapter_id);
  expect(restoredDeletion.source_job_id).toBeNull();expect(await db().all('SELECT * FROM proposal_review_audits')).toHaveLength(1);
});

test('relation proposal endpoints remap as history and cannot import unsafe undo snapshots', async () => {
  const {work,chapter,entry}=await fixture();const peer=await entries.create({workId:work.id,type:'character',name:'小燕'});
  const relation=await relations.upsert({fromEntryId:entry.id,toEntryId:peer.id,kind:'伙伴',note:'互相信任'});
  const version=(await chapters.get(chapter.id)).finalizedVersionId!;
  await db().run(`INSERT INTO memory_proposals(id,work_id,chapter_id,kind,target_type,target_entry_id,target_name,field,after_value,evidence,evidence_offset,confidence,status,created_at,evidence_version_id)
    VALUES('relation-proposal',?,?,'update','relation',?,'林宇 → 小燕','伙伴','生死之交','林宇',0,'high','accepted','2026-10-18',?)`,[work.id,chapter.id,entry.id,version]);
  await db().run(`INSERT INTO proposal_relation_targets(proposal_id,from_entry_id,to_entry_id,relation_id,expected_fingerprint,before_rows,created_ids,after_fingerprint)
    VALUES('relation-proposal',?,?,?,'before','[]','[]','after')`,[entry.id,peer.id,relation.id]);
  const inspection=backup.inspect(await backup.build());expect(inspection.data.relationTargets).toHaveLength(1);
  expect(inspection.data.relationTargets![0].after_fingerprint).toBeNull();
  await backup.restore(inspection,{workIds:[work.id],includeServices:false});
  const copy=(await works.list()).find(row=>row.id!==work.id)!;
  const restored=await db().get<Row>(`SELECT t.* FROM proposal_relation_targets t JOIN memory_proposals p ON p.id=t.proposal_id WHERE p.work_id=?`,[copy.id]);
  expect(restored!.proposal_id).not.toBe('relation-proposal');expect(restored!.from_entry_id).not.toBe(entry.id);expect(restored!.to_entry_id).not.toBe(peer.id);expect(restored!.relation_id).not.toBe(relation.id);
  expect(restored!.before_rows).toBeNull();expect(restored!.created_ids).toBeNull();expect(restored!.after_fingerprint).toBeNull();
  const unsafe=JSON.parse(JSON.stringify(inspection)) as backup.BackupInspection;unsafe.data.relationTargets![0].before_rows='[]';
  expect(()=>backup.inspect(pack(unsafe))).toThrow(expect.objectContaining({code:'BACKUP_INVALID'}));
});

test('text export defaults to main chapters, adds proper Markdown heading and rejects an empty chapter selection', async () => {
  const {work} = await fixture(); const volume = (await chapters.list(work.id))[0].volume;
  const extra = await chapters.create({workId:work.id,volumeId:volume.id,title:'番外',kind:'extra'});
  await chapters.saveBody(extra.id,'番外的文字',0);
  const main = await backup.exportText(work.id,{format:'md'});
  expect(main.startsWith('\uFEFF# 归潮')).toBe(true); expect(main).toContain('　　林宇从海边归来。'); expect(main).not.toContain('番外的文字');
  expect(await backup.exportText(work.id,{format:'txt',chapterIds:[extra.id]})).toContain('番外的文字');
  await expect(backup.exportText(work.id,{format:'txt',chapterIds:[]})).rejects.toMatchObject({code:'VALIDATION'});
});

test('invalid archive paths/oversized uncompressed entries fail and legacy unowned image paths reject explicitly', async () => {
  const { work } = await fixture();
  expect(() => backup.inspect(new Uint8Array([1, 2, 3]))).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  const extra = zipSync({ 'manifest.json': strToU8('{}'), 'data.json': strToU8('{}'), '../bad': strToU8('') });
  expect(() => backup.inspect(extra)).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  const bytes = await backup.build();
  const central = bytes.findIndex((_, i) => bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 1 && bytes[i + 3] === 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); view.setUint32(central + 24, 60 * 1024 * 1024, true);
  expect(() => backup.inspect(bytes)).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  await db().run('UPDATE works SET cover_path = ? WHERE id = ?', ['/local/cover.jpg', work.id]);
  await expect(backup.build(work.id)).rejects.toMatchObject({ code: 'VALIDATION' });
});

test('owned image covers use portable JPEG attachments and restore to new immutable private IDs', async () => {
  const { work } = await fixture(); const driver = coverDriver(); await works.setCover(work.id, { kind: 'image' });
  const bytes = await backup.build(work.id); const files = unzipSync(bytes); const raw = strFromU8(files['data.json']);
  expect(raw).not.toContain(coverToken); expect(raw).not.toContain('file:///private');
  const inspection = backup.inspect(bytes); expect(inspection.data.coverAssets).toHaveLength(1);
  const asset = inspection.data.coverAssets![0]; expect(files[asset.path]).toEqual(fromBase64(jpeg));
  expect(inspection.data.tables.works![0]).toMatchObject({ cover_path: null, cover_token: null });
  await backup.restore(inspection, { workIds: [work.id], includeServices: false });
  const restored = (await works.list()).find(w => w.id !== work.id)!;
  expect(restored.cover).toEqual({ kind: 'image', path: coverAsset('22222222-2222-4222-8222-222222222222').uri });
  expect((await works.get(work.id)).cover).toEqual({ kind: 'image', path: coverAsset(coverToken).uri });
  expect(driver.importImage).toHaveBeenCalledWith(jpeg); expect(driver.remove).not.toHaveBeenCalled();
  await backup.restore(inspection, { workIds: [work.id], includeServices: false });
  expect(await db().all('SELECT token FROM cover_assets')).toHaveLength(3);
  await backup.restore(inspection, { workIds: [], includeServices: false });
  expect(driver.importImage).toHaveBeenCalledTimes(2);
});

test('cover attachment validation rejects missing, extra, escaped, duplicate, malformed and oversized JPEG content', async () => {
  const { work } = await fixture(); coverDriver(); await works.setCover(work.id, { kind: 'image' });
  const bytes = await backup.build(work.id); const inspection = backup.inspect(bytes); const asset = inspection.data.coverAssets![0];
  const missing = unzipSync(bytes); delete missing[asset.path];
  expect(() => backup.inspect(zipSync(missing))).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  const extra = unzipSync(bytes); extra['covers/99999999-9999-4999-8999-999999999999.jpg'] = fromBase64(jpeg);
  expect(() => backup.inspect(zipSync(extra))).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  const escaped = unzipSync(bytes); escaped['covers/../bad.jpg'] = fromBase64(jpeg);
  expect(() => backup.inspect(zipSync(escaped))).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  const duplicate = { ...inspection, data: { ...inspection.data, coverAssets: [asset, asset] } };
  expect(() => backup.inspect(pack(duplicate))).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  const mime = { ...inspection, data: { ...inspection.data, coverAssets: [{ ...asset, mimeType: 'image/png' as 'image/jpeg' }] } };
  expect(() => backup.inspect(pack(mime))).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  for (const content of [new Uint8Array([255,216,255,217]), strToU8('not jpeg'), fromBase64(jpeg).slice(0,-2), new Uint8Array(covers.MAX_COVER_BYTES + 1)]) {
    const invalid = { ...inspection, attachments: { [asset.path]: content } };
    expect(() => backup.inspect(pack(invalid))).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  }
  const dimensions = fromBase64(jpeg); const frame = dimensions.findIndex((value, i) => value === 255 && dimensions[i + 1] === 192);
  dimensions[frame + 7] = 5; dimensions[frame + 8] = 0;
  expect(() => backup.inspect(pack({ ...inspection, attachments: { [asset.path]: dimensions } }))).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
});

test('failed cover preparation or restore transaction recycles only new images and emits no work mutation', async () => {
  const { work } = await fixture(); const driver = coverDriver(); await works.setCover(work.id, { kind: 'image' });
  const inspection = backup.inspect(await backup.build(work.id)); const event = jest.fn(); const off = on('work.created', event);
  const before = await db().all('SELECT * FROM works');
  (driver.importImage as jest.Mock).mockRejectedValueOnce({ code: 'COVER_FORMAT' });
  await expect(backup.restore(inspection, { workIds: [work.id], includeServices: false })).rejects.toMatchObject({ code: 'VALIDATION' });
  await db().run("CREATE TRIGGER restore_failure BEFORE INSERT ON entries BEGIN SELECT RAISE(ABORT,'restore failure'); END");
  await expect(backup.restore(inspection, { workIds: [work.id], includeServices: false })).rejects.toThrow('restore failure');
  expect(await db().all('SELECT * FROM works')).toEqual(before);
  expect(await db().all('SELECT token FROM cover_assets')).toEqual([{ token: coverToken }]);
  expect(driver.remove).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
  expect(driver.remove).not.toHaveBeenCalledWith(coverToken); expect(event).not.toHaveBeenCalled(); off();
});

test('partial cover preparation is compensated and failed cleanup remains durable after a restore rollback', async () => {
  const { work } = await fixture(); const other = await works.create({ title: '他乡', premise: '另一段故事' });
  const driver = coverDriver(); await works.setCover(work.id, { kind: 'image' });
  const otherToken = '99999999-9999-4999-8999-999999999999';
  (driver.pick as jest.Mock).mockResolvedValueOnce(JSON.stringify(coverAsset(otherToken)));
  await works.setCover(other.id, { kind: 'image' });
  const inspection = backup.inspect(await backup.build());
  (driver.importImage as jest.Mock).mockResolvedValueOnce(JSON.stringify(coverAsset('22222222-2222-4222-8222-222222222222'))).mockRejectedValueOnce({ code: 'STORAGE_FULL' });
  (driver.remove as jest.Mock).mockRejectedValueOnce(new Error('storage temporarily unavailable'));
  await expect(backup.restore(inspection, { workIds: [work.id, other.id], includeServices: false })).rejects.toMatchObject({ code: 'STORAGE_FULL' });
  expect(await works.list()).toHaveLength(2);
  expect(await db().all('SELECT token FROM cover_cleanup')).toEqual([{ token: '22222222-2222-4222-8222-222222222222' }]);
  await covers.retryCleanup();
  expect(await db().all('SELECT token FROM cover_cleanup')).toEqual([]);
  expect((await db().all<{token:string}>('SELECT token FROM cover_assets')).map(row => row.token).sort()).toEqual([coverToken, otherToken]);
  expect(driver.remove).not.toHaveBeenCalledWith(coverToken); expect(driver.remove).not.toHaveBeenCalledWith(otherToken);
});

test('missing interval anchors never silently widen formal facts or relations during backup or restore', async () => {
  const {work,chapter,entry}=await fixture();const peer=await entries.create({workId:work.id,type:'character',name:'同伴'});
  await relations.upsert({fromEntryId:entry.id,toEntryId:peer.id,kind:'伙伴',fromChapterId:chapter.id});
  const inspection=backup.inspect(await backup.build());
  const missing=JSON.parse(JSON.stringify(inspection)) as backup.BackupInspection;missing.data.tables.chapters=[];missing.data.tables.chapter_versions=[];missing.data.tables.adoption_receipts=[];
  expect(()=>backup.inspect(pack(missing))).toThrow(expect.objectContaining({code:'BACKUP_INVALID'}));
  await chapters.remove(chapter.id);
  await expect(backup.build(work.id)).rejects.toMatchObject({code:'VALIDATION'});
  expect((await db().get<Row>('SELECT * FROM entry_facts WHERE entry_id=? AND from_chapter_id IS NOT NULL',[entry.id]))?.from_chapter_id).toBe(chapter.id);
  expect((await db().get<Row>('SELECT * FROM relations WHERE from_entry=?',[entry.id]))?.from_chapter_id).toBe(chapter.id);
});
