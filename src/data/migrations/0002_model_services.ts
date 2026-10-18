/** G02 §5.11: secure-store references and durable cleanup compensation. */
export const m0002: string[] = [
  'ALTER TABLE model_services ADD COLUMN key_ref TEXT',
  'ALTER TABLE model_services ADD COLUMN revision INTEGER NOT NULL DEFAULT 1',
  'CREATE TABLE credential_cleanup (key_ref TEXT PRIMARY KEY)',
  // Existing databases never had a secure-store slot. Do not trust the old
  // has_key bit after upgrading, and clear stale test output at the same time.
  'UPDATE model_services SET has_key = 0, last_test_at = NULL, last_test_ok = NULL, last_test_message = NULL WHERE key_ref IS NULL',
  // Keep exactly one default when services exist; created_at/id makes the
  // choice deterministic for databases that somehow had several defaults.
  'UPDATE model_services SET is_default = CASE WHEN id = (SELECT id FROM model_services ORDER BY (is_default = 1) DESC, created_at, id LIMIT 1) THEN 1 ELSE 0 END',
  'CREATE UNIQUE INDEX idx_model_services_one_default ON model_services(is_default) WHERE is_default = 1',
];
