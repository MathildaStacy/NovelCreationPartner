/** Volumes service (G02 §5.2). */
import { db } from '../data/db';
import { uuid } from '../utils/id';
import { AppError, notFound, validation } from './errors';
import { emit } from './events';
import { requireLength } from './validate';
import type { ID, Volume } from './types';

export type VolumeListItem = Volume & { chapterCount: number; trashedChapterCount: number };

export async function list(workId: ID): Promise<VolumeListItem[]> {
  const rows = await db().all<{ id: string; work_id: string; title: string; order_index: number; live: number; trashed: number }>(
    `SELECT v.*,
       (SELECT count(*) FROM chapters c WHERE c.volume_id = v.id AND c.deleted_at IS NULL) AS live,
       (SELECT count(*) FROM chapters c WHERE c.volume_id = v.id AND c.deleted_at IS NOT NULL) AS trashed
     FROM volumes v WHERE v.work_id = ? ORDER BY v.order_index`,
    [workId],
  );
  return rows.map(r => ({
    id: r.id,
    workId: r.work_id,
    title: r.title,
    order: Number(r.order_index),
    chapterCount: Number(r.live),
    trashedChapterCount: Number(r.trashed),
  }));
}

export async function create(workId: ID, title: string): Promise<Volume> {
  const t = requireLength('title', title, 1, 30, '卷名');
  const id = uuid();
  let order = 0;
  await db().transaction(async tx => {
    const work = await tx.get('SELECT id FROM works WHERE id = ? AND deleted_at IS NULL', [workId]);
    if (!work) {
      throw notFound('作品');
    }
    const max = await tx.get<{ m: number | null }>('SELECT max(order_index) m FROM volumes WHERE work_id = ?', [workId]);
    order = (max?.m ?? -1) + 1;
    await tx.run('INSERT INTO volumes (id, work_id, title, order_index) VALUES (?, ?, ?, ?)', [id, workId, t, order]);
  });
  emit('chapters.changed', { workId });
  return { id, workId, title: t, order };
}

async function workOf(id: ID): Promise<ID> {
  const r = await db().get<{ work_id: string }>('SELECT work_id FROM volumes WHERE id = ?', [id]);
  if (!r) {
    throw notFound('卷');
  }
  return r.work_id;
}

export async function rename(id: ID, title: string): Promise<void> {
  const t = requireLength('title', title, 1, 30, '卷名');
  const workId = await workOf(id);
  await db().run('UPDATE volumes SET title = ? WHERE id = ?', [t, id]);
  emit('chapters.changed', { workId });
}

/** Submits the complete volume order; chapter numbers follow (they are computed on read). */
export async function reorder(workId: ID, volumeIds: ID[]): Promise<void> {
  await db().transaction(async tx => {
    const vols = await tx.all<{ id: string }>('SELECT id FROM volumes WHERE work_id = ?', [workId]);
    const ids = new Set(vols.map(v => v.id));
    if (volumeIds.length !== ids.size || new Set(volumeIds).size !== ids.size || volumeIds.some(v => !ids.has(v))) {
      throw new AppError('CONFLICT_STATE', '卷列表已变化，请刷新后重试');
    }
    for (let i = 0; i < volumeIds.length; i++) {
      await tx.run('UPDATE volumes SET order_index = ? WHERE id = ?', [i, volumeIds[i]]);
    }
  });
  emit('chapters.changed', { workId });
}

/** Only an empty volume (trash included) can be removed, and a work keeps at least one. */
export async function remove(id: ID): Promise<void> {
  const workId = await workOf(id);
  await db().transaction(async tx => {
    const n = await tx.get<{ n: number }>('SELECT count(*) n FROM chapters WHERE volume_id = ?', [id]);
    if (Number(n?.n) > 0) {
      throw validation('volume', '卷里还有章节（包括回收站中的章节），不能删除');
    }
    const total = await tx.get<{ n: number }>('SELECT count(*) n FROM volumes WHERE work_id = ?', [workId]);
    if (Number(total?.n) <= 1) {
      throw validation('volume', '作品至少保留一卷');
    }
    await tx.run('DELETE FROM volumes WHERE id = ?', [id]);
  });
  emit('chapters.changed', { workId });
}
