/**
 * Which conflicts count as "未处理" (G02 §5.9, S06 §6, S14a §5).
 *
 * A conflict stays in the table while its chapter or entry sits in the trash so
 * a restore brings it back, but meanwhile it is hidden from lists and badges.
 * `later` still counts as unresolved; fixed_text / updated_entry / intentional
 * and superseded do not.
 *
 * Field "有冲突" state is derived from these rows instead of being written onto
 * entry_facts: resolving a conflict therefore restores the field's original
 * state without having to remember it. A detected conflict names the archive
 * side as `b_ref = 'fact:{id}'` (finalization validateDetectedConflicts).
 */

/** Chapter and entry of the conflict (when set) are not in the trash. */
export const conflictVisibleSql = (x: string) =>
  `(${x}.chapter_id IS NULL OR EXISTS (SELECT 1 FROM chapters vc WHERE vc.id = ${x}.chapter_id AND vc.deleted_at IS NULL))` +
  ` AND (${x}.entry_id IS NULL OR EXISTS (SELECT 1 FROM entries ve WHERE ve.id = ${x}.entry_id AND ve.deleted_at IS NULL))`;

/** Unresolved (open or later) and visible. */
export const activeConflictSql = (x: string) => `${x}.status IN ('open','later') AND ${conflictVisibleSql(x)}`;
