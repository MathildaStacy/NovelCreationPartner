/** Persisted partner conversations. Local edits never invoke a model. */
import { db, type Db } from '../data/db';
import { nowIso, uuid } from '../utils/id';
import { requireChapterIn, requireWorkIn } from './archiveSupport';
import { AppError, notFound, validation } from './errors';
import { emit } from './events';
import { requireLength } from './validate';
import type { Conversation, ID, IdeationOption, Message, PartnerScope } from './types';

interface MessageRow {
  id: ID; conversation_id: ID; role: Message['role']; content: string; status: Message['status'];
  mode: Message['mode']; structured: string | null; service_id: ID | null; model: string | null;
  input_tokens: number | null; output_tokens: number | null; error: string | null; created_at: string;
}
export const messageFromRow = (r: MessageRow): Message => ({
  id: r.id, conversationId: r.conversation_id, role: r.role, content: r.content, status: r.status, mode: r.mode,
  structured: r.structured ? JSON.parse(r.structured) : null, serviceId: r.service_id, model: r.model,
  usage: r.input_tokens !== null && r.output_tokens !== null ? { input: Number(r.input_tokens), output: Number(r.output_tokens) } : null,
  error: r.error ? JSON.parse(r.error) : null, createdAt: r.created_at,
});
export async function requireConversationIn(q: Db, id: ID) {
  const row = await q.get<{ id: ID; work_id: ID; title: string; scope: string; last_message_at: string }>(
    `SELECT c.* FROM conversations c JOIN works w ON w.id = c.work_id WHERE c.id = ? AND w.deleted_at IS NULL`, [id]);
  if (!row) { throw notFound('对话'); } return row;
}
export async function get(id: ID): Promise<Conversation> {
  const q = db(); const row = await requireConversationIn(q, id);
  const last = await q.get<MessageRow>('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [id]);
  const running = await q.get("SELECT id FROM messages WHERE conversation_id = ? AND status = 'streaming'", [id]);
  return { id, workId: row.work_id, title: row.title, scope: JSON.parse(row.scope), lastMessageAt: row.last_message_at,
    preview: last ? { role: last.role, text: [...last.content].slice(0, 60).join(''), status: last.status } : null, generating: Boolean(running) };
}
export async function list(workId: ID): Promise<Conversation[]> {
  await requireWorkIn(db(), workId);
  const rows = await db().all<{ id: ID }>('SELECT id FROM conversations WHERE work_id = ? ORDER BY last_message_at DESC, id', [workId]);
  return Promise.all(rows.map(r => get(r.id)));
}
export async function create(workId: ID, options: { seed?: string } = {}): Promise<Conversation> {
  const id = uuid(); const now = nowIso();
  await db().transaction(async tx => {
    await requireWorkIn(tx, workId);
    await tx.run(`INSERT INTO conversations (id, work_id, title, scope, created_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, workId, [...(options.seed?.trim() || '新的讨论')].slice(0, 16).join(''),
        JSON.stringify({ kind: 'confirmed', chapterId: null, includeProposed: false }), now, now]);
  });
  emit('conversations.changed', { workId, conversationId: id }); return get(id);
}
export async function isGenerating(): Promise<boolean> {
  return Boolean(await db().get("SELECT id FROM messages WHERE status = 'streaming' LIMIT 1"));
}
export async function messages(id: ID): Promise<Message[]> {
  await requireConversationIn(db(), id);
  return (await db().all<MessageRow>('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid', [id])).map(messageFromRow);
}
export async function message(id: ID): Promise<Message> {
  const row = await db().get<MessageRow>('SELECT * FROM messages WHERE id = ?', [id]);
  if (!row) { throw notFound('消息'); }
  await requireConversationIn(db(), row.conversation_id); return messageFromRow(row);
}
export async function rename(id: ID, title: string): Promise<void> {
  let workId = '';
  await db().transaction(async tx => {
    workId = (await requireConversationIn(tx, id)).work_id;
    await tx.run('UPDATE conversations SET title = ?, title_locked = 1 WHERE id = ?', [requireLength('title', title, 1, 30, '对话标题'), id]);
  }); emit('conversations.changed', { workId, conversationId: id });
}
export async function remove(id: ID): Promise<void> {
  let workId = '';
  await db().transaction(async tx => {
    workId = (await requireConversationIn(tx, id)).work_id;
    await tx.run('DELETE FROM conversations WHERE id = ?', [id]);
  }); emit('conversations.changed', { workId, conversationId: id });
}
export async function setScope(id: ID, scope: PartnerScope): Promise<void> {
  let workId = '';
  await db().transaction(async tx => {
    workId = (await requireConversationIn(tx, id)).work_id;
    if (!['confirmed', 'chapter'].includes(scope.kind) || typeof scope.includeProposed !== 'boolean'
      || (scope.kind === 'chapter' && !scope.chapterId)) { throw validation('scope', '请选择有效的参考范围'); }
    await requireChapterIn(tx, workId, scope.chapterId);
    await tx.run('UPDATE conversations SET scope = ? WHERE id = ?', [JSON.stringify({ ...scope, chapterId: scope.kind === 'chapter' ? scope.chapterId : null }), id]);
  }); emit('conversations.changed', { workId, conversationId: id });
}
/** Transaction-aware option state helper used by adoption and undo. */
export async function setOptionStateIn(q: Db, messageId: ID, index: number, state: IdeationOption['state'], ids?: { entryIds: ID[]; factIds: ID[] }): Promise<ID> {
  const row = await q.get<MessageRow>("SELECT * FROM messages WHERE id = ? AND role = 'assistant' AND status = 'done'", [messageId]);
  if (!row) { throw notFound('方案消息'); }
  await requireConversationIn(q, row.conversation_id);
  const structured: Message['structured'] = row.structured ? JSON.parse(row.structured) : null;
  const option = structured?.options[index];
  if (!option) { throw notFound('方案'); }
  option.state = state; option.entryIds = ids?.entryIds ?? []; option.factIds = ids?.factIds ?? [];
  await q.run('UPDATE messages SET structured = ? WHERE id = ?', [JSON.stringify(structured), messageId]);
  return row.conversation_id;
}
export async function setOptionState(messageId: ID, index: number, state: 'open' | 'dismissed'): Promise<void> {
  const conversationId = await db().transaction(async tx => {
    const row = await tx.get<{ structured: string | null }>('SELECT structured FROM messages WHERE id = ?', [messageId]);
    const current = JSON.parse(row?.structured ?? '{}').options?.[index]?.state;
    if (!['open', 'dismissed'].includes(current)) { throw new AppError('CONFLICT_STATE', '已采纳或暂存的方案需通过撤销操作处理。'); }
    return setOptionStateIn(tx, messageId, index, state);
  });
  emit('messages.changed', { conversationId });
}
