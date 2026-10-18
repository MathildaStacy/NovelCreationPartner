/** G04 durable finalization bindings; legacy work must never start billing on upgrade. */
export const m0006: string[] = [
  'ALTER TABLE works ADD COLUMN context_revision INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE jobs ADD COLUMN source_version_id TEXT',
  'ALTER TABLE jobs ADD COLUMN input_fingerprint TEXT',
  'ALTER TABLE jobs ADD COLUMN dependency_revision INTEGER',
  'ALTER TABLE jobs ADD COLUMN service_revision INTEGER',
  'ALTER TABLE jobs ADD COLUMN policy_version TEXT',
  'ALTER TABLE jobs ADD COLUMN execution_token TEXT',
  'ALTER TABLE jobs ADD COLUMN operation_id TEXT',
  'ALTER TABLE jobs ADD COLUMN candidate_offset INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE jobs ADD COLUMN summary_before TEXT',
  'ALTER TABLE memory_proposals ADD COLUMN source_job_id TEXT',
  'ALTER TABLE conflicts ADD COLUMN source_job_id TEXT',
  'ALTER TABLE chapters ADD COLUMN summary_source_version_id TEXT',
  `UPDATE jobs SET status = 'paused', pause_reason = 'legacy_input', execution_token = NULL
   WHERE status IN ('queued','running','paused','failed')`,
  'CREATE UNIQUE INDEX idx_jobs_active_input ON jobs(kind,source_version_id,input_fingerprint,service_id,service_revision) WHERE source_version_id IS NOT NULL AND status IN (\'queued\',\'running\',\'paused\',\'failed\',\'done\')',
  'CREATE UNIQUE INDEX idx_proposals_job_result ON memory_proposals(source_job_id,target_type,target_name,field,after_value) WHERE source_job_id IS NOT NULL',
  'CREATE UNIQUE INDEX idx_conflicts_job_result ON conflicts(source_job_id,fingerprint) WHERE source_job_id IS NOT NULL',
  ...['entries', 'relations'].flatMap(table => [
    `CREATE TRIGGER context_${table}_insert AFTER INSERT ON ${table} BEGIN UPDATE works SET context_revision=context_revision+1 WHERE id=new.work_id; END`,
    `CREATE TRIGGER context_${table}_update AFTER UPDATE ON ${table} BEGIN UPDATE works SET context_revision=context_revision+1 WHERE id=new.work_id; END`,
    `CREATE TRIGGER context_${table}_delete AFTER DELETE ON ${table} BEGIN UPDATE works SET context_revision=context_revision+1 WHERE id=old.work_id; END`,
  ]),
  ...['INSERT', 'UPDATE', 'DELETE'].map(event => {
    const ref = event === 'DELETE' ? 'old' : 'new';
    return `CREATE TRIGGER context_facts_${event.toLowerCase()} AFTER ${event} ON entry_facts BEGIN UPDATE works SET context_revision=context_revision+1 WHERE id=(SELECT work_id FROM entries WHERE id=${ref}.entry_id); END`;
  }),
  `CREATE TRIGGER context_chapters_update AFTER UPDATE OF body,title,volume_id,order_index,deleted_at ON chapters
    WHEN old.body IS NOT new.body OR old.title IS NOT new.title OR old.volume_id IS NOT new.volume_id OR old.order_index IS NOT new.order_index OR old.deleted_at IS NOT new.deleted_at
    BEGIN UPDATE works SET context_revision=context_revision+1 WHERE id=new.work_id; END`,
  'CREATE TRIGGER context_chapters_insert AFTER INSERT ON chapters BEGIN UPDATE works SET context_revision=context_revision+1 WHERE id=new.work_id; END',
  'CREATE TRIGGER context_chapters_delete AFTER DELETE ON chapters BEGIN UPDATE works SET context_revision=context_revision+1 WHERE id=old.work_id; END',
  'CREATE TRIGGER context_volume_order AFTER UPDATE OF order_index ON volumes BEGIN UPDATE works SET context_revision=context_revision+1 WHERE id=new.work_id; END',
  `CREATE TRIGGER context_work_info AFTER UPDATE OF title,premise,style_note,genre,deleted_at ON works
    WHEN old.title IS NOT new.title OR old.premise IS NOT new.premise OR old.style_note IS NOT new.style_note OR old.genre IS NOT new.genre OR old.deleted_at IS NOT new.deleted_at
    BEGIN UPDATE works SET context_revision=context_revision+1 WHERE id=new.id; END`,
  `CREATE TRIGGER context_intentional_insert AFTER INSERT ON conflicts WHEN new.status='intentional' BEGIN UPDATE works SET context_revision=context_revision+1 WHERE id=new.work_id; END`,
  `CREATE TRIGGER context_intentional_delete AFTER DELETE ON conflicts WHEN old.status='intentional' BEGIN UPDATE works SET context_revision=context_revision+1 WHERE id=old.work_id; END`,
  `CREATE TRIGGER context_intentional_conflict AFTER UPDATE OF status,note ON conflicts
    WHEN new.status='intentional' OR old.status='intentional'
    BEGIN UPDATE works SET context_revision=context_revision+1 WHERE id=new.work_id; END`,
];
