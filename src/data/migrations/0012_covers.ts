/** Immutable private image ownership and durable post-commit deletion compensation. */
export const m0012: string[] = [
  'ALTER TABLE works ADD COLUMN cover_token TEXT',
  'CREATE TABLE cover_assets (token TEXT PRIMARY KEY, uri TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)',
  'CREATE TABLE cover_cleanup (token TEXT PRIMARY KEY)',
];
