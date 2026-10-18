/** Archive indexes are derived data; existing writing and model services stay intact. */
const indexEntry = (id: string) => `INSERT INTO entries_fts (entry_id, work_id, name, aliases, summary, facts)
  SELECT e.id, e.work_id, e.name, e.aliases, e.summary,
    coalesce((SELECT group_concat(f.value, ' ') FROM entry_facts f
      WHERE f.entry_id = e.id AND f.is_current = 1 AND f.state IN ('CONFIRMED','ESTABLISHED','CONFLICTED')), '')
  FROM entries e WHERE e.id = ${id} AND e.deleted_at IS NULL AND e.state != 'RETIRED'`;
const indexNames = (id: string) => `INSERT OR IGNORE INTO entry_names (entry_id, work_id, type, name)
  SELECT e.id, e.work_id, e.type, lower(trim(e.name)) FROM entries e
    WHERE e.id = ${id} AND e.deleted_at IS NULL
  UNION SELECT e.id, e.work_id, e.type, lower(trim(j.value)) FROM entries e, json_each(e.aliases) j
    WHERE e.id = ${id} AND e.deleted_at IS NULL AND trim(j.value) != ''`;

export const m0003: string[] = [
  'ALTER TABLE entry_facts ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE entries ADD COLUMN retired_state TEXT',
  // Distinguish relationship trash caused by each deleted endpoint from manual removal.
  'ALTER TABLE relations ADD COLUMN deleted_with_entry INTEGER NOT NULL DEFAULT 0',
  `CREATE TABLE entry_names (
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    type TEXT NOT NULL, name TEXT NOT NULL,
    PRIMARY KEY (entry_id, name)
  )`,
  'CREATE INDEX idx_entry_names_lookup ON entry_names(work_id, type, name)',
  "CREATE VIRTUAL TABLE entries_fts USING fts5(entry_id UNINDEXED, work_id UNINDEXED, name, aliases, summary, facts, tokenize='trigram')",
  indexNames('e.id'),
  indexEntry('e.id'),
  `CREATE TRIGGER archive_entry_insert AFTER INSERT ON entries BEGIN
    ${indexNames('new.id')}; ${indexEntry('new.id')}; END`,
  `CREATE TRIGGER archive_entry_update AFTER UPDATE ON entries BEGIN
    DELETE FROM entry_names WHERE entry_id = old.id;
    DELETE FROM entries_fts WHERE entry_id = old.id;
    ${indexNames('new.id')}; ${indexEntry('new.id')}; END`,
  `CREATE TRIGGER archive_entry_delete AFTER DELETE ON entries BEGIN
    DELETE FROM entries_fts WHERE entry_id = old.id; END`,
  ...(['INSERT', 'UPDATE', 'DELETE'] as const).map(action => {
    const ref = action === 'DELETE' ? 'old.entry_id' : 'new.entry_id';
    return `CREATE TRIGGER archive_fact_${action.toLowerCase()} AFTER ${action} ON entry_facts BEGIN
      DELETE FROM entries_fts WHERE entry_id = ${ref}; ${indexEntry(ref)}; END`;
  }),
];
