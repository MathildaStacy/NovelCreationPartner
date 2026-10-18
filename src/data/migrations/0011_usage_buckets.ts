/** Anthropic cache writes/reads are disjoint from ordinary input; OpenAI details remain subsets. */
export const m0011:string[]=[
  'ALTER TABLE ai_attempts ADD COLUMN cache_write_input INTEGER',
  'ALTER TABLE ai_attempts ADD COLUMN uncached_input INTEGER',
];
