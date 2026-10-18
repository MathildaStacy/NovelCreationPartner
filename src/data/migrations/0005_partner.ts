/** Durable author adoption receipts: safe undo is conditional on every written dependency. */
export const m0005: string[] = [
  `CREATE TABLE adoption_receipts (
    id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES messages(id) ON DELETE SET NULL, option_index INTEGER,
    created_entries TEXT NOT NULL, entry_ids TEXT NOT NULL, fact_ids TEXT NOT NULL,
    before_facts TEXT NOT NULL, after_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  'CREATE INDEX idx_adoption_message ON adoption_receipts(message_id, option_index)',
];
