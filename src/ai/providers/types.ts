import type { AiErrorInfo, ISO, ModelService } from '../../features/types';

/** G03 §2.2.0. Credentials belong to the provider's private configuration snapshot. */
export interface GenerateRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxOutputTokens: number;
  effort?: 'low' | 'medium' | 'high';
  jsonSchema?: { name: string; schema: object };
  stream: boolean;
  signal: AbortSignal;
}

export type Usage = { input: number; output: number };
export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'done'; text: string; model: string | null; usage: Usage | null; stop: 'end' | 'length' | 'refusal' }
  | { type: 'error'; error: AiErrorInfo }
  | { type: 'cancelled' };

export interface Provider {
  generate(request: GenerateRequest): AsyncIterable<StreamEvent>;
  listModels(options: { signal: AbortSignal }): Promise<string[]>;
}

export interface TestResult {
  ok: boolean;
  at: ISO;
  latencyMs: number;
  modelCount: number | null;
  modelListed: boolean | null;
  models: string[] | null;
  responseModel: string | null;
  streaming: boolean | null;
  capsPatch: Partial<ModelService['options']['caps']>;
  error: AiErrorInfo | null;
}
