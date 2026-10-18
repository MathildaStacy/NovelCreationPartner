/** Local archive, history and scoped retrieval (G02 §5.5, G03 §6.0). */
import { db, type Db } from '../data/db';
import { nowIso, uuid } from '../utils/id';
import { findText } from './chapters';
import {
  chapterOrderIn, effectiveFacts, inInterval, relationsIn, requireChapterIn, requireEntryIn, requireWorkIn,
  toEntry, toFact, type EntryRow, type FactRow,
} from './archiveSupport';
import { AppError, notFound, validation } from './errors';
import { emit } from './events';
import { requireLength } from './validate';
import type {
  Conflict, EntryDetail, EntryFact, EntryListItem, EntrySource, EntryType, HistoryItem, ID, MemoryState,
} from './types';

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  character: '人物', world: '世界观', place: '地点', faction: '势力', rule: '规则', foreshadow: '伏笔',
};
export const ENTRY_FIELDS: Record<EntryType, string[]> = {
  character: ['identity', 'appearance', 'personality', 'goal', 'motivation', 'ability', 'background', 'secret', 'arc'],
  world: ['content', 'limits', 'exceptions'], rule: ['content', 'limits', 'exceptions'],
  place: ['description', 'belongsTo', 'location'], faction: ['purpose', 'members', 'base', 'strength'],
  foreshadow: ['content', 'payoffPlan', 'resolved'],
};
export const FIELD_LABELS: Record<string, string> = {
  identity: '身份', appearance: '外貌', personality: '性格', goal: '目标', motivation: '动机', ability: '能力',
  background: '背景', secret: '秘密', arc: '成长弧', content: '内容', limits: '限制', exceptions: '例外',
  description: '描述', belongsTo: '所属', location: '位置关系', purpose: '宗旨', members: '成员', base: '据点',
  strength: '实力', payoffPlan: '计划回收', resolved: '是否已回收',
};
const SOURCE_LABELS = { manual: '手动', partner: 'AI 伙伴', review: '记忆审核', ai_complete: 'AI 补全' };
const FORMAL = new Set<MemoryState>(['CONFIRMED', 'ESTABLISHED', 'CONFLICTED']);
export interface FactInput { field: string; value: string; fromChapterId?: ID | null; }
export interface EntryPatch { name?: string; aliases?: string[]; summary?: string; facts?: FactInput[]; }

const canonicalName = (name: string) => name.trim().toLocaleLowerCase();
function normalizeNames(name: string, aliases: string[] = []) {
  const cleanName = requireLength('name', name, 1, 30, '条目名称');
  if (aliases.length > 10) { throw validation('aliases', '别名最多 10 个'); }
  const unique = new Map<string, string>();
  for (const alias of aliases) {
    const clean = requireLength('aliases', alias, 1, 20, '别名');
    if (canonicalName(clean) !== canonicalName(cleanName)) { unique.set(canonicalName(clean), clean); }
  }
  return { name: cleanName, aliases: [...unique.values()] };
}
export async function validateNamesIn(q: Db, workId: ID, type: EntryType, name: string, aliases: string[], exceptId?: ID) {
  const names = [name, ...aliases].map(canonicalName);
  const found = await q.get(`SELECT entry_id FROM entry_names WHERE work_id = ? AND type = ?
    AND name IN (${names.map(() => '?').join(',')}) AND entry_id != ? LIMIT 1`, [workId, type, ...names, exceptId ?? '']);
  if (found) { throw new AppError('DUPLICATE', '同类型中已有同名条目或别名'); }
}
async function factsIn(q: Db, id: ID) {
  return q.all<FactRow>('SELECT * FROM entry_facts WHERE entry_id = ? ORDER BY created_at, rowid', [id]);
}
function validateFact(type: EntryType, input: FactInput, manual = false): FactInput {
  if (!ENTRY_FIELDS[type]?.includes(input.field)) {
    if (!manual || Object.values(ENTRY_FIELDS).some(keys => keys.includes(input.field))) { throw validation('facts', '字段不属于当前条目类型'); }
    requireLength('field', input.field, 1, 10, '自定义字段名');
  }
  const value = requireLength('facts', input.value, 0, manual ? 500 : 300, FIELD_LABELS[input.field] ?? input.field);
  if (type === 'foreshadow' && input.field === 'resolved' && value && !['yes', 'no'].includes(value)) {
    throw validation('facts', '回收状态应为 yes 或 no');
  }
  return { ...input, value };
}
async function insertFactIn(q: Db, input: {
  entryId: ID; field: string; value: string; state: MemoryState; fromChapterId: ID | null;
  toChapterId: ID | null; source: EntrySource; supersedesId: ID | null;
}): Promise<ID> {
  const id = uuid();
  await q.run(`INSERT INTO entry_facts (id, entry_id, field, value, state, from_chapter_id, to_chapter_id,
    source_kind, source_ref, supersedes_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, input.entryId, input.field, input.value, input.state, input.fromChapterId, input.toChapterId,
    input.source.kind, input.source.ref, input.supersedesId, nowIso()]);
  return id;
}

/** Shared by author-triggered adoption/review transactions. Does not emit. */
export async function updateFactsIn(
  q: Db, entryId: ID, inputs: FactInput[], source: EntrySource = { kind: 'manual', ref: null },
  state: MemoryState = 'CONFIRMED',
): Promise<ID[]> {
  const entry = await requireEntryIn(q, entryId);
  const { chapters, rank } = await chapterOrderIn(q, entry.work_id);
  const fields = new Set<string>();
  const ids: ID[] = [];
  for (const raw of inputs) {
    const input = validateFact(entry.type, raw, source.kind === 'manual');
    if (fields.has(input.field)) { throw validation('facts', '同一字段不能重复保存'); }
    fields.add(input.field);
    await requireChapterIn(q, entry.work_id, input.fromChapterId);
    const rows = await factsIn(q, entryId);
    const currentRows = rows.filter(f => f.field === input.field && f.is_current && f.state !== 'PROPOSED');
    // The latest phase, including a cleared phase, is the authoring default.
    const current = currentRows.sort((a, b) => {
      const diff = (a.from_chapter_id ? rank.get(a.from_chapter_id) ?? -1 : -1)
        - (b.from_chapter_id ? rank.get(b.from_chapter_id) ?? -1 : -1);
      return diff || a.created_at.localeCompare(b.created_at);
    }).at(-1);
    const from = input.fromChapterId === undefined ? current?.from_chapter_id ?? null : input.fromChapterId;
    if (current?.value === input.value && current.from_chapter_id === from && current.state === state) { continue; }
    let to = current?.to_chapter_id ?? null;
    const currentStart = current?.from_chapter_id ? rank.get(current.from_chapter_id) ?? -1 : -1;
    const nextStart = from ? rank.get(from)! : -1;
    if (current && nextStart > currentStart) {
      // Preserve the phase's value, closing it immediately before the new phase.
      await q.run('UPDATE entry_facts SET to_chapter_id = ? WHERE id = ?', [chapters[nextStart - 1]?.id ?? null, current.id]);
      to = null;
    } else if (current) {
      await q.run('UPDATE entry_facts SET is_current = 0 WHERE id = ?', [current.id]);
    }
    if (!current && input.value === '') { continue; }
    ids.push(await insertFactIn(q, { entryId, field: input.field, value: input.value,
      state: input.value === '' ? 'RETIRED' : state, fromChapterId: from, toChapterId: to,
      source, supersedesId: current?.id ?? null }));
  }
  return ids;
}

/** Recompute the entry badge from active facts; manual retirement remains authoritative. */
export async function refreshStateIn(q: Db, id: ID): Promise<void> {
  const entry = await requireEntryIn(q, id);
  if (entry.state === 'RETIRED') { return; }
  const { rank } = await chapterOrderIn(q, entry.work_id);
  const rows = await factsIn(q, id);
  const current = effectiveFacts(rows, rank);
  const states = new Set(current.map(f => f.state));
  const state: MemoryState = states.has('CONFLICTED') ? 'CONFLICTED' : states.has('ESTABLISHED') ? 'ESTABLISHED'
    : states.has('CONFIRMED') ? 'CONFIRMED' : rows.some(f => f.is_current && f.state === 'PROPOSED') ? 'PROPOSED'
      : entry.source_kind === 'manual' ? 'CONFIRMED' : entry.state;
  if (state !== entry.state) { await q.run('UPDATE entries SET state = ? WHERE id = ?', [state, id]); }
}

/** Shared transaction helper; callers emit only after commit. */
export async function createIn(q: Db, input: {
  workId: ID; type: EntryType; name: string; aliases?: string[]; summary?: string; facts?: FactInput[];
}, source: EntrySource = { kind: 'manual', ref: null }): Promise<ID> {
  await requireWorkIn(q, input.workId);
  if (!Object.hasOwn(ENTRY_FIELDS, input.type)) { throw validation('type', '未知条目类型'); }
  const names = normalizeNames(input.name, input.aliases);
  await validateNamesIn(q, input.workId, input.type, names.name, names.aliases);
  const summary = requireLength('summary', input.summary, 0, 100, '一句话简介')
    || [...(input.facts?.find(f => f.value.trim())?.value ?? '')].slice(0, 40).join('');
  const id = uuid(); const now = nowIso();
  await q.run(`INSERT INTO entries (id, work_id, type, name, aliases, summary, state, source_kind, source_ref, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, ?, ?)`,
  [id, input.workId, input.type, names.name, JSON.stringify(names.aliases), summary, source.kind, source.ref, now, now]);
  await updateFactsIn(q, id, input.facts ?? [], source);
  return id;
}
export async function create(input: Parameters<typeof createIn>[1]): Promise<EntryDetail> {
  const id = await db().transaction(tx => createIn(tx, input));
  emit('entries.changed', { workId: input.workId, entryIds: [id] });
  return get(id);
}
export async function update(id: ID, patch: EntryPatch, options: { conflictId?: ID } = {}): Promise<void> {
  let workId = '';
  await db().transaction(async tx => {
    const row = await requireEntryIn(tx, id); workId = row.work_id;
    const names = normalizeNames(patch.name ?? row.name, patch.aliases ?? JSON.parse(row.aliases));
    await validateNamesIn(tx, workId, row.type, names.name, names.aliases, id);
    const summary = requireLength('summary', patch.summary ?? row.summary, 0, 100, '一句话简介');
    if (options.conflictId && !(await tx.get('SELECT id FROM conflicts WHERE id = ? AND work_id = ? AND entry_id = ?', [options.conflictId, workId, id]))) {
      throw notFound('冲突');
    }
    await updateFactsIn(tx, id, patch.facts ?? [], { kind: 'manual', ref: options.conflictId ? `conflict:${options.conflictId}` : null });
    await tx.run('UPDATE entries SET name = ?, aliases = ?, summary = ?, updated_at = ? WHERE id = ?',
      [names.name, JSON.stringify(names.aliases), summary, nowIso(), id]);
  });
  emit('entries.changed', { workId, entryIds: [id] });
}

async function itemIn(q: Db, row: EntryRow): Promise<EntryListItem> {
  const count = await q.get<{ n: number }>(`SELECT
    (SELECT count(*) FROM memory_proposals WHERE target_entry_id = ? AND status = 'pending') +
    (SELECT count(*) FROM entry_facts WHERE entry_id = ? AND is_current = 1 AND state = 'PROPOSED') AS n`, [row.id, row.id]);
  const item: EntryListItem = { id: row.id, type: row.type, name: row.name, summary: row.summary, state: row.state,
    sourceLabel: SOURCE_LABELS[row.source_kind], sourceAt: row.updated_at, pendingCount: Number(count?.n ?? 0) };
  if (row.type === 'foreshadow') {
    const { rank } = await chapterOrderIn(q, row.work_id);
    const fact = effectiveFacts(await factsIn(q, row.id), rank).find(f => f.field === 'resolved');
    item.resolved = fact?.value === 'yes'; item.resolvedChapterId = fact?.from_chapter_id ?? null;
  }
  return item;
}
export async function list(workId: ID, options: { type?: EntryType; states?: MemoryState[]; includeRetired?: boolean } = {}): Promise<EntryListItem[]> {
  const q = db(); await requireWorkIn(q, workId);
  const rows = await q.all<EntryRow>('SELECT * FROM entries WHERE work_id = ? AND deleted_at IS NULL ORDER BY name, id', [workId]);
  const filtered = rows.filter(r => (!options.type || r.type === options.type)
    && (options.includeRetired || r.state !== 'RETIRED') && (!options.states || options.states.includes(r.state)));
  // localeCompare supports pinyin on the device; IDs break ties deterministically.
  filtered.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN') || a.id.localeCompare(b.id));
  return Promise.all(filtered.map(r => itemIn(q, r)));
}
export async function counts(workId: ID) {
  const q = db(); await requireWorkIn(q, workId);
  const byType = Object.fromEntries(Object.keys(ENTRY_FIELDS).map(t => [t, 0])) as Record<EntryType, number>;
  const byState = Object.fromEntries(Object.keys(ENTRY_FIELDS).map(t => [t,
    Object.fromEntries(['PROPOSED', 'CONFIRMED', 'ESTABLISHED', 'CONFLICTED', 'RETIRED'].map(s => [s, 0])),
  ])) as Record<EntryType, Record<MemoryState, number>>;
  const rows = await q.all<{ type: EntryType; state: MemoryState; n: number }>(
    'SELECT type, state, count(*) AS n FROM entries WHERE work_id = ? AND deleted_at IS NULL GROUP BY type, state', [workId]);
  for (const row of rows) {
    if (byState[row.type] && row.state in byState[row.type]) {
      byState[row.type][row.state] = Number(row.n);
      if (row.state !== 'RETIRED') { byType[row.type] += Number(row.n); }
    }
  }
  return { byType, byState };
}

async function factDetailIn(q: Db, fact: FactRow): Promise<EntryFact> {
  const ref = fact.source_ref;
  const proposal = fact.source_kind === 'review' && ref ? await q.get<{ chapter_id: ID; evidence: string }>(
    'SELECT chapter_id, evidence FROM memory_proposals WHERE id = ?', [ref.replace(/^proposal:/, '')]) : undefined;
  return { ...toFact(fact), sourceLabel: fact.source_kind === 'manual' && ref?.startsWith('conflict:') ? '冲突处理'
    : fact.source_kind === 'manual' && ref?.startsWith('revert:') ? '恢复历史' : SOURCE_LABELS[fact.source_kind],
    sourceChapterId: proposal?.chapter_id ?? null, evidence: proposal?.evidence ?? null };
}

export async function get(id: ID, options: { atChapterId?: ID } = {}): Promise<EntryDetail> {
  const q = db(); const row = await requireEntryIn(q, id); const entry = toEntry(row);
  await requireChapterIn(q, entry.workId, options.atChapterId);
  const { chapters, rank } = await chapterOrderIn(q, entry.workId);
  const at = options.atChapterId ? rank.get(options.atChapterId)! : Infinity;
  const allFacts = await factsIn(q, id);
  const facts = await Promise.all(effectiveFacts(allFacts, rank, at).map(f => factDetailIn(q, f)));
  const proposedFacts = await Promise.all(allFacts.filter(f => f.is_current && f.state === 'PROPOSED').map(f => factDetailIn(q, f)));
  const pendingProposals = await q.all<{ id: ID; field: string | null; after: string; evidence: string; chapterId: ID }>(
    `SELECT id, field, after_value AS after, evidence, chapter_id AS chapterId FROM memory_proposals
      WHERE target_entry_id = ? AND status = 'pending' ORDER BY created_at`, [id]);
  const timeline: EntryDetail['timeline'] = allFacts.filter(f => f.is_current && f.from_chapter_id !== null)
    .map(f => ({ chapterId: f.from_chapter_id, number: chapters.find(c => c.id === f.from_chapter_id)?.number ?? null,
      field: f.field, value: f.value, kind: f.state === 'PROPOSED' ? 'pending' : 'fact', factId: f.id }));
  for (const p of pendingProposals) {
    timeline.push({ chapterId: p.chapterId, number: chapters.find(c => c.id === p.chapterId)?.number ?? null,
      field: p.field ?? '', value: p.after, kind: 'pending', proposalId: p.id });
  }
  timeline.sort((a, b) => (rank.get(a.chapterId ?? '') ?? -1) - (rank.get(b.chapterId ?? '') ?? -1));
  const appearances = await findText(entry.workId, [entry.name, ...entry.aliases]);
  const conflictRows = await q.all<Record<string, string | null>>(`SELECT * FROM conflicts
    WHERE entry_id = ? AND work_id = ? AND status IN ('open','later') ORDER BY created_at DESC`, [id, entry.workId]);
  const conflicts: Conflict[] = conflictRows.map(c => ({ id: c.id!, workId: c.work_id!, chapterId: c.chapter_id, entryId: c.entry_id,
    type: c.type as Conflict['type'], severity: c.severity as Conflict['severity'],
    a: { label: c.a_label!, ref: c.a_ref!, quote: c.a_quote! }, b: { label: c.b_label!, ref: c.b_ref!, quote: c.b_quote! },
    explanation: c.explanation!, suggestions: JSON.parse(c.suggestions ?? '[]'), status: c.status as Conflict['status'],
    note: c.note, createdAt: c.created_at! }));
  const resolved = facts.find(f => f.field === 'resolved');
  return { ...entry, facts, proposedFacts, timeline, appearances, conflicts, pendingProposals,
    relations: await relationsIn(q, id, options.atChapterId),
    ...(entry.type === 'foreshadow' ? { resolved: resolved?.value === 'yes', resolvedChapterId: resolved?.fromChapterId ?? null } : {}) };
}

export async function history(id: ID): Promise<HistoryItem[]> {
  const q = db(); await requireEntryIn(q, id);
  const rows = await factsIn(q, id); const byId = new Map(rows.map(r => [r.id, r]));
  const output: HistoryItem[] = [];
  for (const f of rows.filter(r => r.state !== 'PROPOSED').reverse()) {
    const proposal = f.source_kind === 'review' && f.source_ref ? await q.get<{ chapter_id: ID; evidence: string }>(
      'SELECT chapter_id, evidence FROM memory_proposals WHERE id = ?', [f.source_ref.replace(/^proposal:/, '')]) : undefined;
    const sourceKind = f.source_kind === 'manual' && f.source_ref?.startsWith('conflict:') ? 'conflict'
      : f.source_kind === 'manual' && f.source_ref?.startsWith('revert:') ? 'revert' : f.source_kind;
    output.push({ factId: f.id, field: f.field, beforeFactId: f.supersedes_id,
      before: f.supersedes_id ? byId.get(f.supersedes_id)?.value || null : null, after: f.value || null,
      fromChapterId: f.from_chapter_id, toChapterId: f.to_chapter_id, sourceKind, sourceRef: f.source_ref,
      sourceChapterId: proposal?.chapter_id ?? null, evidence: proposal?.evidence ?? null, at: f.created_at });
  }
  return output;
}
export async function revertFact(factId: ID): Promise<void> {
  let workId = ''; let entryId = '';
  await db().transaction(async tx => {
    const target = await tx.get<FactRow>('SELECT * FROM entry_facts WHERE id = ?', [factId]);
    if (!target || !FORMAL.has(target.state)) { throw notFound('历史字段'); }
    const row = await requireEntryIn(tx, target.entry_id); workId = row.work_id; entryId = row.id;
    const { rank } = await chapterOrderIn(tx, workId);
    await requireChapterIn(tx, workId, target.from_chapter_id);
    const allFacts = await factsIn(tx, row.id);
    const active = target.from_chapter_id === null
      ? allFacts.filter(f => f.field === target.field && f.is_current && f.from_chapter_id === null && f.state !== 'PROPOSED').at(-1)
      : allFacts.filter(f => f.field === target.field && f.is_current && f.state !== 'PROPOSED'
        && inInterval(f.from_chapter_id, f.to_chapter_id, rank.get(target.from_chapter_id!)!, rank))
        .sort((a, b) => (a.from_chapter_id ? rank.get(a.from_chapter_id)! : -1)
          - (b.from_chapter_id ? rank.get(b.from_chapter_id)! : -1) || a.created_at.localeCompare(b.created_at)).at(-1);
    if (active?.value === target.value) { throw new AppError('CONFLICT_STATE', '当前字段已经是这个值'); }
    if (active) { await tx.run('UPDATE entry_facts SET is_current = 0 WHERE id = ?', [active.id]); }
    await insertFactIn(tx, { entryId, field: target.field, value: target.value, state: 'CONFIRMED',
      fromChapterId: active ? active.from_chapter_id : target.from_chapter_id,
      toChapterId: active ? active.to_chapter_id : target.to_chapter_id, source: { kind: 'manual', ref: `revert:${factId}` },
      supersedesId: active?.id ?? null });
    await tx.run('UPDATE entries SET updated_at = ? WHERE id = ?', [nowIso(), entryId]);
  });
  emit('entries.changed', { workId, entryIds: [entryId] });
}

async function changeState(id: ID, retireEntry: boolean): Promise<void> {
  let workId = '';
  await db().transaction(async tx => {
    const row = await requireEntryIn(tx, id); workId = row.work_id;
    if (retireEntry && row.state !== 'RETIRED') {
      await tx.run("UPDATE entries SET retired_state = state, state = 'RETIRED', updated_at = ? WHERE id = ?", [nowIso(), id]);
    } else if (!retireEntry && row.state === 'RETIRED') {
      await tx.run("UPDATE entries SET state = coalesce(retired_state, 'CONFIRMED'), retired_state = NULL, updated_at = ? WHERE id = ?", [nowIso(), id]);
    }
  });
  emit('entries.changed', { workId, entryIds: [id] });
}
export async function retire(id: ID): Promise<void> { return changeState(id, true); }
export async function unretire(id: ID): Promise<void> { return changeState(id, false); }
export async function remove(id: ID): Promise<void> {
  let workId = '';
  await db().transaction(async tx => {
    const row = await requireEntryIn(tx, id); workId = row.work_id;
    const now = nowIso();
    await tx.run('UPDATE entries SET deleted_at = ? WHERE id = ?', [now, id]);
    await tx.run(`UPDATE relations SET deleted_at = ?, deleted_with_entry = 1
      WHERE (from_entry = ? OR to_entry = ?) AND deleted_at IS NULL`, [now, id, id]);
  });
  emit('entries.changed', { workId, entryIds: [id] });
}

export async function search(workId: ID, query: string): Promise<EntryListItem[]> {
  const text = query.trim(); if (!text) { return list(workId); }
  const q = db(); await requireWorkIn(q, workId);
  let rows: EntryRow[];
  if ([...text].length >= 3) {
    // Treat the author's query as a literal phrase; never execute user FTS syntax.
    rows = await q.all<EntryRow>(`SELECT e.* FROM entries_fts JOIN entries e ON e.id = entries_fts.entry_id
      WHERE entries_fts MATCH ? AND e.work_id = ? AND e.deleted_at IS NULL AND e.state != 'RETIRED'
      ORDER BY bm25(entries_fts), e.id`, [`"${text.replace(/"/g, '""')}"`, workId]);
  } else {
    const like = `%${text.replace(/[\\%_]/g, c => `\\${c}`)}%`;
    rows = await q.all<EntryRow>(`SELECT e.* FROM entries e WHERE e.work_id = ? AND e.deleted_at IS NULL AND e.state != 'RETIRED'
      AND (e.name LIKE ? ESCAPE '\\' OR e.aliases LIKE ? ESCAPE '\\' OR e.summary LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM entry_facts f WHERE f.entry_id = e.id AND f.is_current = 1
          AND f.state IN ('CONFIRMED','ESTABLISHED','CONFLICTED') AND f.value LIKE ? ESCAPE '\\')) ORDER BY e.name, e.id`,
    [workId, like, like, like, like]);
  }
  rows.sort((a, b) => Number(canonicalName(b.name) === canonicalName(text)) - Number(canonicalName(a.name) === canonicalName(text)));
  return Promise.all(rows.map(r => itemIn(q, r)));
}
function matchMentions(rows: EntryRow[], text: string): { entryId: ID; name: string; count: number }[] {
  const names = rows.flatMap(r => [r.name, ...JSON.parse(r.aliases) as string[]].map(name => ({ entryId: r.id, display: r.name, name })))
    .sort((a, b) => b.name.length - a.name.length || a.entryId.localeCompare(b.entryId));
  const matches = new Map<ID, { entryId: ID; name: string; count: number }>();
  for (let i = 0; i < text.length;) {
    const found = names.find(n => text.startsWith(n.name, i));
    if (found) {
      // Same-name entities of different types stay separate candidates; never merge identity by text alone.
      for (const match of names.filter(n => n.name === found.name)) {
        const item = matches.get(match.entryId) ?? { entryId: match.entryId, name: match.display, count: 0 };
        item.count++; matches.set(match.entryId, item);
      }
      i += found.name.length;
    } else { i++; }
  }
  return [...matches.values()];
}
export async function findMentions(workId: ID, text: string, options: { atChapterId?: ID } = {}) {
  const q = db(); await requireWorkIn(q, workId);
  const rows = await q.all<EntryRow>(`SELECT * FROM entries WHERE work_id = ? AND deleted_at IS NULL
    AND state IN ('CONFIRMED','ESTABLISHED','CONFLICTED') ORDER BY id`, [workId]);
  await requireChapterIn(q, workId, options.atChapterId);
  if (options.atChapterId) {
    const { rank } = await chapterOrderIn(q, workId);
    const at = rank.get(options.atChapterId)!;
    const visible: EntryRow[] = [];
    for (const row of rows) {
      const facts = await factsIn(q, row.id);
      // A named empty entry remains useful; a wholly future entry is excluded.
      if (!facts.some(f => f.is_current && FORMAL.has(f.state)) || effectiveFacts(facts, rank, at).length) { visible.push(row); }
    }
    return matchMentions(visible, text);
  }
  return matchMentions(rows, text);
}

/** AI may write proposals only. Existing confirmed fields remain untouched. */
export async function proposeFactsIn(q: Db, entryId: ID, facts: FactInput[], source: EntrySource): Promise<ID[]> {
  const row = await requireEntryIn(q, entryId);
  if (row.state === 'RETIRED') { throw new AppError('CONFLICT_STATE', '已废弃条目不能添加 AI 提议。'); }
  const output: ID[] = []; const fields = new Set<string>();
  for (const raw of facts) {
    const fact = validateFact(row.type, raw);
    if (!fact.value || fields.has(fact.field)) { throw validation('facts', '提议字段为空或重复'); }
    fields.add(fact.field); await requireChapterIn(q, row.work_id, fact.fromChapterId);
    await q.run("DELETE FROM entry_facts WHERE entry_id = ? AND field = ? AND state = 'PROPOSED'", [entryId, fact.field]);
    output.push(await insertFactIn(q, { entryId, field: fact.field, value: fact.value, state: 'PROPOSED',
      fromChapterId: fact.fromChapterId ?? null, toChapterId: null, source, supersedesId: null }));
  }
  await q.run('UPDATE entries SET updated_at = ? WHERE id = ?', [nowIso(), entryId]);
  return output;
}
export async function proposeFacts(entryId: ID, facts: FactInput[], source: EntrySource): Promise<ID[]> {
  let workId = '';
  const ids = await db().transaction(async tx => {
    workId = (await requireEntryIn(tx, entryId)).work_id;
    return proposeFactsIn(tx, entryId, facts, source);
  });
  emit('entries.changed', { workId, entryIds: [entryId] }); return ids;
}
export async function confirmFact(factId: ID, options: { value?: string } = {}): Promise<void> {
  let workId = ''; let entryId = '';
  await db().transaction(async tx => {
    const fact = await tx.get<FactRow>("SELECT * FROM entry_facts WHERE id = ? AND state = 'PROPOSED'", [factId]);
    if (!fact) { throw notFound('提议字段'); }
    const row = await requireEntryIn(tx, fact.entry_id); workId = row.work_id; entryId = row.id;
    const value = requireLength('value', options.value ?? fact.value, 1, 300, '字段值');
    // An author confirmation preserves current interval; a proposal cannot alter chronology silently.
    await updateFactsIn(tx, entryId, [{ field: fact.field, value }], { kind: fact.source_kind, ref: fact.source_ref });
    await tx.run('DELETE FROM entry_facts WHERE id = ?', [factId]);
    await refreshStateIn(tx, entryId);
    await tx.run('UPDATE entries SET updated_at = ? WHERE id = ?', [nowIso(), entryId]);
  });
  emit('entries.changed', { workId, entryIds: [entryId] });
}
export async function dismissFact(factId: ID): Promise<void> {
  let workId = ''; let entryId = '';
  await db().transaction(async tx => {
    const fact = await tx.get<FactRow>("SELECT * FROM entry_facts WHERE id = ? AND state = 'PROPOSED'", [factId]);
    if (!fact) { throw notFound('提议字段'); }
    const row = await requireEntryIn(tx, fact.entry_id); workId = row.work_id; entryId = row.id;
    await tx.run('DELETE FROM entry_facts WHERE id = ?', [factId]);
  });
  emit('entries.changed', { workId, entryIds: [entryId] });
}
