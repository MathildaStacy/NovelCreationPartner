/** Evidence survives re-finalization; only explicit author review changes formal facts. */
export const m0008: string[] = [
  'ALTER TABLE memory_proposals ADD COLUMN evidence_version_id TEXT',
  "ALTER TABLE memory_proposals ADD COLUMN origin TEXT NOT NULL DEFAULT 'extraction'",
  'ALTER TABLE memory_proposals ADD COLUMN evidence_proposal_id TEXT',
  `UPDATE memory_proposals SET evidence_version_id=(SELECT source_version_id FROM jobs WHERE jobs.id=memory_proposals.source_job_id)
    WHERE source_job_id IS NOT NULL`,
  `CREATE TABLE proposal_review_audits (
    source_job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    base_input_fingerprint TEXT NOT NULL,
    current_input_fingerprint TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX idx_proposals_deleted_evidence ON memory_proposals(source_job_id,evidence_proposal_id) WHERE origin='deletion'",
];
