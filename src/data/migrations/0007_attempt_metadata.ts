/** Attempts carry their own service metadata when one finalization uses explicit routes. */
export const m0007: string[] = [
  'ALTER TABLE ai_attempts ADD COLUMN service_id TEXT',
  'ALTER TABLE ai_attempts ADD COLUMN service_revision INTEGER',
  'ALTER TABLE ai_attempts ADD COLUMN model TEXT',
  'ALTER TABLE ai_attempts ADD COLUMN task TEXT',
  'ALTER TABLE ai_attempts ADD COLUMN policy_version TEXT',
];
