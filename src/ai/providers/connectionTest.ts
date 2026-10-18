/** G03 §6.1: one bounded logical test; providers perform single physical requests. */
import { AppError, isAppError } from '../../features/errors';
import type { ModelService } from '../../features/types';
import type { HttpTransport } from '../transport/native';
import { aiFailure, ProviderFailure, type ErrorContext } from './errors';
import { createProvider, type AttemptEvidence } from './httpProvider';
import { RequestLifetime } from './lifecycle';
import type { TestResult, Usage } from './types';

type Snapshot = Pick<ModelService, 'name' | 'protocol' | 'baseUrl' | 'model' | 'options'>;
export interface ConnectionTestOptions {
  signal: AbortSignal;
  transport?: HttpTransport;
  /** Absolute wall-clock deadline; an earlier enclosing deadline may shorten 20 seconds. */
  deadline?: number;
  attempts?: { begin(ordinal: number): Promise<string>; end(id: string, result: { status: 'succeeded' | 'failed' | 'cancelled'; usage: Usage | null; errorCode: string | null }): Promise<void> };
  onRetry?: (attempt: 1 | 2, delayMs: number) => void;
}

/** The lifetime's abort covers both author cancellation and expiry, including AppState resume. */
function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      if (timer !== undefined) { clearTimeout(timer); }
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => { release(); reject(); };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    timer = setTimeout(() => { release(); resolve(); }, delayMs);
  });
}

export async function testConnection(service: Snapshot, secret: string, options: ConnectionTestOptions): Promise<TestResult> {
  // Copy before the first await: later form edits must not change the captured request.
  const snapshot = { ...service, options: { ...service.options, store: false, caps: { ...service.options.caps } } };
  const context: ErrorContext = {
    protocol: snapshot.protocol, serviceName: snapshot.name, model: snapshot.model,
    baseUrl: snapshot.baseUrl, sensitiveValues: [secret, 'ping'],
  };
  const deadline = Math.min(Date.now() + 20000, options.deadline ?? Infinity);
  const lifetime = new RequestLifetime(options.signal, context, deadline, null);
  let models: string[] | null = null;
  let latencyMs = 0;
  let responseModel: string | null = null;
  let streaming: boolean | null = null;
  const capsPatch: TestResult['capsPatch'] = {};
  const check = () => {
    lifetime.check();
    if (lifetime.failure) { throw lifetime.failure; }
  };
  const failureFrom = (error: unknown) => lifetime.failure ?? (error instanceof ProviderFailure ? error : aiFailure('AI_NETWORK', context));
  const finish = (failure: ProviderFailure | null, acceptedTerminal = false): TestResult => {
    // A yielded done has already won the provider's frame/abort/deadline race.
    // Closing its physical iterator may await a microtask; a later outer abort
    // cannot turn that accepted protocol terminal into a cancelled test.
    if (!acceptedTerminal) { lifetime.check(); }
    const final = acceptedTerminal ? failure : lifetime.failure ?? failure;
    if (final?.info.code === 'AI_CANCELLED') { throw new AppError('AI_CANCELLED', final.info.message); }
    lifetime.settle();
    return {
      ok: final === null, at: new Date().toISOString(), latencyMs, models,
      modelCount: models === null ? null : models.length,
      modelListed: models === null ? null : models.includes(snapshot.model),
      responseModel, streaming, capsPatch, error: final?.info ?? null,
    };
  };
  const provider = (evidence?: AttemptEvidence) => createProvider(snapshot, secret, {
    transport: options.transport, deadline, evidence,
  });
  try {
    check();
    try {
      models = await provider().listModels({ signal: lifetime.controller.signal });
    } catch (error) {
      const failure = failureFrom(error);
      if (![404, 405].includes(failure.info.status ?? 0)) { return finish(failure); }
    }
    let retries = 0;
    let downgraded = false;
    for (let attempts = 0; attempts < 4; attempts++) {
      check();
      const evidence: AttemptEvidence = { streaming: null, failure: null };
      const effort = snapshot.options.caps.effort === false ? undefined : 'low';
      const attemptId = await options.attempts?.begin(attempts + 1);
      const started = Date.now();
      let attemptUsage: Usage | null = null;
      let attemptStatus: 'succeeded' | 'failed' | 'cancelled' = 'failed';
      let hasText = false;
      let failure: ProviderFailure | null = null;
      try {
      for await (const event of provider(evidence).generate({
        system: '', messages: [{ role: 'user', content: 'ping' }], maxOutputTokens: 64,
        effort, stream: true, signal: lifetime.controller.signal,
      })) {
        if (event.type === 'text') { hasText ||= event.delta.length > 0; }
        else if (event.type === 'done') {
          attemptUsage = event.usage;
          attemptStatus = 'succeeded';
          latencyMs = Math.max(0, Date.now() - started);
          responseModel = event.model;
          streaming = evidence.streaming;
          if (streaming !== null) { capsPatch.streaming = streaming; }
          return finish(null, true);
        } else {
          failure = lifetime.failure ?? evidence.failure ?? (event.type === 'error'
            ? new ProviderFailure(event.error) : aiFailure('AI_CANCELLED', context));
        }
      }
      } finally {
        attemptUsage ??= evidence.usage ?? null;
        if (attemptId) await options.attempts!.end(attemptId, { status: lifetime.controller.signal.aborted || failure?.info.code === 'AI_CANCELLED' ? 'cancelled' : attemptStatus, usage: attemptUsage, errorCode: failure?.info.code ?? (attemptStatus === 'succeeded' ? null : 'AI_NETWORK') });
      }
      latencyMs = Math.max(0, Date.now() - started);
      failure ??= aiFailure('AI_NETWORK', context);
      check();
      if (attempts >= 3 || hasText) { return finish(failure); }
      if (failure.unsupported === 'effort' && effort !== undefined && !downgraded) {
        downgraded = true;
        snapshot.options.caps.effort = false;
        capsPatch.effort = false;
        continue;
      }
      if (!failure.shouldRetry || !['AI_RATE_LIMIT', 'AI_SERVER'].includes(failure.info.code) || retries >= 2) {
        return finish(failure);
      }
      const delayMs = failure.retryAfterMs ?? (retries === 0 ? 1000 : 3000);
      // Waiting through the deadline cannot leave time for another physical request.
      if (delayMs > 20000 || delayMs >= deadline - Date.now()) { return finish(failure); }
      retries++;
      options.onRetry?.(retries as 1 | 2, delayMs);
      await waitForRetry(delayMs, lifetime.controller.signal);
    }
    return finish(aiFailure('AI_NETWORK', context));
  } catch (error) {
    if (isAppError(error, 'AI_CANCELLED')) { throw error; }
    return finish(failureFrom(error));
  } finally {
    lifetime.dispose();
    lifetime.controller.abort();
  }
}
