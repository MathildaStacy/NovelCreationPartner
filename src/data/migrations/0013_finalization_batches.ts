/** Persist continuous author approvals without creating a new request budget. */
export const m0013: string[] = [
  'ALTER TABLE ai_requests ADD COLUMN authorized_calls INTEGER NOT NULL DEFAULT 0',
  // Earlier small operations were explicitly approved in full. The old >6 gate never sent them.
  "UPDATE ai_requests SET authorized_calls=planned_calls WHERE task='finalize' AND planned_calls<=6",
  `CREATE TABLE finalization_batches (id TEXT PRIMARY KEY,operation_id TEXT NOT NULL REFERENCES ai_requests(id) ON DELETE CASCADE,
    start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,request_fingerprint TEXT NOT NULL,created_at TEXT NOT NULL,
    UNIQUE(operation_id,start_offset),CHECK(start_offset>=0 AND end_offset>start_offset AND end_offset-start_offset<=6))`,
];
