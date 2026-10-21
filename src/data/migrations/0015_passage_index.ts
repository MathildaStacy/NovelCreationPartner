/**
 * 0015 — history passage retrieval (derived, rebuildable) and durable passage evidence.
 *
 * `chapters.body` stays authoritative. `chapter_chunks` / `chunk_mentions` are a local
 * search index that can always be rebuilt from it; a body change deletes the chapter's
 * chunks in the same statement, so a stale index can never be read as current.
 */
export const m0015: string[] = [
  `CREATE TABLE chapter_chunks (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    text TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    names_hash TEXT NOT NULL,
    policy TEXT NOT NULL,
    UNIQUE(chapter_id, chunk_index),
    CHECK(start_offset >= 0 AND end_offset > start_offset)
  )`,
  'CREATE INDEX idx_chunks_work ON chapter_chunks(work_id, chapter_id, chunk_index)',
  `CREATE TABLE chunk_mentions (
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    chunk_id TEXT NOT NULL REFERENCES chapter_chunks(id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, chunk_id)
  )`,
  'CREATE INDEX idx_mentions_chunk ON chunk_mentions(chunk_id)',
  `CREATE TRIGGER passage_body_changed AFTER UPDATE OF body ON chapters WHEN old.body IS NOT new.body BEGIN
    DELETE FROM chunk_mentions WHERE chunk_id IN (SELECT id FROM chapter_chunks WHERE chapter_id = new.id);
    DELETE FROM chapter_chunks WHERE chapter_id = new.id; END`,
  // Durable conflict evidence: the bound source version or body hash, and UTF-16 offsets.
  'ALTER TABLE conflicts ADD COLUMN a_version_id TEXT',
  'ALTER TABLE conflicts ADD COLUMN a_offset INTEGER',
  'ALTER TABLE conflicts ADD COLUMN b_version_id TEXT',
  'ALTER TABLE conflicts ADD COLUMN b_source_hash TEXT',
  'ALTER TABLE conflicts ADD COLUMN b_offset INTEGER',
  'ALTER TABLE conflicts ADD COLUMN b_anchor TEXT',
  // Shared, persisted tool budgets of one finalization operation; resume never resets them.
  'ALTER TABLE ai_requests ADD COLUMN tool_rounds INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE ai_requests ADD COLUMN max_tool_rounds INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE ai_requests ADD COLUMN tool_result_chars INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE ai_requests ADD COLUMN max_tool_result_chars INTEGER NOT NULL DEFAULT 0',
  // Every completed tool round (actual request messages and tool results) of a chunk.
  'ALTER TABLE job_chunks ADD COLUMN rounds TEXT',
];
