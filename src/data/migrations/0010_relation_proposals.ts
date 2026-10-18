/** Reviewable directed relationship changes with their original history preserved. */
export const m0010: string[] = [
  `CREATE TABLE proposal_relation_targets (
    proposal_id TEXT PRIMARY KEY REFERENCES memory_proposals(id) ON DELETE CASCADE,
    from_entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    to_entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    relation_id TEXT,
    expected_fingerprint TEXT NOT NULL,
    before_rows TEXT,
    created_ids TEXT,
    after_fingerprint TEXT
  )`,
];
