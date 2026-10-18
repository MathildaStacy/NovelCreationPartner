/** Exact author-reviewed requests and independently checkpointed verified chunks. */
export const m0009:string[]=[
  'ALTER TABLE jobs ADD COLUMN plan_id TEXT',
  'ALTER TABLE jobs ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE jobs ADD COLUMN completed_chunks INTEGER NOT NULL DEFAULT 0',
  `CREATE TABLE finalization_plans (id TEXT PRIMARY KEY,chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    source_version_id TEXT NOT NULL,input_fingerprint TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,last_used_at TEXT NOT NULL)`,
  `CREATE TABLE job_chunks (id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,candidate_offset INTEGER NOT NULL,context_plan TEXT NOT NULL,analysis_context TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',result TEXT,last_used_at TEXT NOT NULL,UNIQUE(job_id,chunk_index))`,
  'CREATE INDEX idx_job_chunks_status ON job_chunks(job_id,status,chunk_index)',
];
