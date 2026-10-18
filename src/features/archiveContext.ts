/** Local archive blocks shared by writing and partner tasks. Formal constraints never become optional proposals. */
import { db } from '../data/db';
import { fingerprint, type ContextBlock } from '../ai/context';
import { chapterOrderIn, inInterval, requireEntryIn } from './archiveSupport';
import { AppError } from './errors';
import * as entries from './entries';
import type { ID } from './types';

export async function archiveContextBlocks(workId: ID, ids: readonly ID[], options: {
  atChapterId?: ID; requiredIds?: ReadonlySet<ID>; includeProposed?: boolean;
} = {}): Promise<ContextBlock[]> {
  const requiredIds = options.requiredIds ?? new Set(ids);
  const { rank } = await chapterOrderIn(db(), workId);
  const at = options.atChapterId ? rank.get(options.atChapterId)! : Infinity;
  const formal = new Set(['CONFIRMED', 'ESTABLISHED', 'CONFLICTED']);
  const blocks: ContextBlock[] = [], seenRelations = new Set<ID>(), seenConflicts = new Set<ID>();
  // Required entries go first, so a shared relation/conflict cannot be deduplicated as an optional block.
  const ordered = [...new Set(ids)].sort((a, b) => Number(requiredIds.has(b)) - Number(requiredIds.has(a)));
  for (const id of ordered) {
    const entry = await entries.get(id, { atChapterId: options.atChapterId });
    if (entry.workId !== workId) { throw new AppError('VALIDATION', '参考条目必须属于当前作品。'); }
    if (entry.state === 'RETIRED') { continue; }
    const required = requiredIds.has(id), atChapterId = options.atChapterId ?? null;
    const facts = entry.facts.filter(f => formal.has(f.state));
    if (formal.has(entry.state)) {
      blocks.push({ sourceId: id, sourceVersion: fingerprint([entry.name, entry.aliases, facts]), state: entry.state, atChapterId,
        text: `${entries.ENTRY_TYPE_LABELS[entry.type]}：${entry.name}（${entry.aliases.join('、')}）\n${facts.map(f => `${entries.FIELD_LABELS[f.field] ?? f.field}：${f.value} [${f.state}]`).join('\n')}`, required, priority: 4 });
      for (const conflict of entry.conflicts) {
        if (seenConflicts.has(conflict.id) || conflict.chapterId !== null && (!rank.has(conflict.chapterId) || rank.get(conflict.chapterId)! > at)) { continue; }
        seenConflicts.add(conflict.id);
        blocks.push({ sourceId: `conflict:${conflict.id}`, sourceVersion: fingerprint(conflict), state: 'CONFLICTED', atChapterId,
          text: `尚待作者处理的冲突（不能擅自判定哪方正确）：${conflict.explanation}\n${conflict.a.label} [${conflict.a.ref}]：${conflict.a.quote}\n${conflict.b.label} [${conflict.b.ref}]：${conflict.b.quote}`, required, priority: 3 });
      }
      for (const relation of entry.relations) {
        if (seenRelations.has(relation.id) || !formal.has(relation.state) || !inInterval(relation.fromChapterId, relation.toChapterId, at, rank)) { continue; }
        const from = await requireEntryIn(db(), relation.fromEntryId), to = await requireEntryIn(db(), relation.toEntryId);
        if (!formal.has(from.state) || !formal.has(to.state)) { continue; }
        seenRelations.add(relation.id);
        blocks.push({ sourceId: `relation:${relation.id}`, sourceVersion: fingerprint(relation), state: relation.state, atChapterId,
          text: `有向关系：${relation.fromName} —${relation.kind}→ ${relation.toName}${relation.note ? `：${relation.note}` : ''}`, required, priority: 3 });
      }
    }
    const proposed = options.includeProposed ? entry.proposedFacts.filter(f => inInterval(f.fromChapterId, f.toChapterId, at, rank)) : [];
    if (proposed.length) blocks.push({ sourceId: `proposed:${id}`, sourceVersion: fingerprint(proposed), state: 'PROPOSED', atChapterId,
      text: `${entry.name} 的未确认提议（不是正式事实）：\n${proposed.map(f => `${entries.FIELD_LABELS[f.field] ?? f.field}：${f.value} [PROPOSED]`).join('\n')}`, required: false, priority: 7 });
  }
  return blocks;
}
