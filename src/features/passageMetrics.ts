/**
 * Content-free timings of history retrieval (index updates, searches, context
 * preparation) for on-device measurement. Nothing here is persisted or sent.
 * In development builds each sample is also logged as `[passages] …` (logcat / Metro).
 */
export interface PassageTiming {
  kind: 'index' | 'search' | 'read' | 'prepare_writing' | 'prepare_finalization' | 'tool_round';
  ms: number;
  chapters?: number;
  results?: number;
  scanned?: number;
}
const samples: (PassageTiming & { at: number })[] = [];
const LIMIT = 100;

export function record(sample: PassageTiming): void {
  samples.push({ ...sample, at: Date.now() });
  if (samples.length > LIMIT) samples.splice(0, samples.length - LIMIT);
  const scope = globalThis as { __DEV__?: boolean; process?: { env?: Record<string, string | undefined> } };
  if (scope.__DEV__ && !scope.process?.env?.JEST_WORKER_ID) {
    console.log(`[passages] ${sample.kind} ${sample.ms}ms${sample.chapters !== undefined ? ` chapters=${sample.chapters}` : ''}${sample.results !== undefined ? ` results=${sample.results}` : ''}${sample.scanned ? ` scanned=${sample.scanned}` : ''}`);
  }
}
export function recent(): readonly (PassageTiming & { at: number })[] { return samples.slice(); }
export function clear(): void { samples.length = 0; }
