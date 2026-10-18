import * as secure from '../../secure';
import { uuid } from '../../utils/id';
import { nativeTransport, TransportFailure } from '../transport/native';
import { normalizeUrl } from '../../features/modelServiceConfig';

export interface ProbeResult {
  secureRoundTrip: boolean;
  secureRemoved: boolean;
  incremental: boolean;
  utf8: boolean;
  abort: boolean;
  redirectsBlocked: number[];
  sinkRequests: number;
  sinkWithAuth: number;
  abortedHolds: number;
  noImplicitRetry: boolean;
  retryAfterPreserved: boolean;
}
/** A separate entry point uses this controlled fixture; never accepts a real Key. */
export async function runNativeProbe(origin: string, signal: AbortSignal): Promise<ProbeResult> {
  let endpoint: URL;
  try {
    endpoint = new URL(normalizeUrl('openai_responses', origin));
    // Even HTTPS probes are restricted to controlled local/private hosts.
    normalizeUrl('openai_responses', `http://${endpoint.host}`);
  } catch {
    throw new TransportFailure('network');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new TransportFailure('network');
  }
  const ref = `probe-${uuid()}`;
  const key = `invalid-probe-${uuid()}-${uuid()}`;
  const headers = { Authorization: `Bearer ${key}` };
  const result: ProbeResult = { secureRoundTrip: false, secureRemoved: false, incremental: false, utf8: false, abort: false, redirectsBlocked: [], sinkRequests: -1, sinkWithAuth: -1, abortedHolds: -1, noImplicitRetry: false, retryAfterPreserved: false };
  try {
    await secure.setKey(ref, key);
    result.secureRoundTrip = (await secure.getKey(ref)) === key;
    if (signal.aborted) { throw new TransportFailure('cancelled'); }
    let text = '';
    let count = 0;
    const began = Date.now();
    let first = 0;
    for await (const event of nativeTransport({ url: new URL('/stream', endpoint).href, method: 'GET', headers, signal })) {
      if (event.type === 'data') {
        text += event.text;
        count++;
        if (!first) { first = Date.now(); }
      }
    }
    result.incremental = count >= 2 && first - began < 600 && Date.now() - first >= 200;
    result.utf8 = text === '甲🌊乙';
    const hold = new AbortController();
    const abort = () => hold.abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (signal.aborted) { hold.abort(); }
      for await (const event of nativeTransport({ url: new URL('/hold', endpoint).href, method: 'GET', headers, signal: hold.signal })) {
        if (event.type === 'data') { hold.abort(); }
      }
    } catch (error) {
      result.abort = error instanceof TransportFailure && error.code === 'cancelled';
    } finally {
      signal.removeEventListener('abort', abort);
    }
    for (const status of [301, 302, 307, 308]) {
      if (signal.aborted) { throw new TransportFailure('cancelled'); }
      try {
        for await (const event of nativeTransport({ url: new URL(`/redirect/${status}`, endpoint).href, method: 'GET', headers, signal })) {
          if (event.type === 'data') { throw new TransportFailure('network'); }
        }
      } catch (error) {
        if (error instanceof TransportFailure && error.code === 'redirect') {
          result.redirectsBlocked.push(status);
        } else { throw error; }
      }
    }
    let retryHeaders = 0;
    for (const method of ['GET', 'POST'] as const) {
      for await (const event of nativeTransport({ url: new URL('/unavailable', endpoint).href, method, headers, body: method === 'POST' ? '{}' : undefined, signal })) {
        if (event.type === 'headers' && event.status === 503 && event.headers['retry-after'] === '0') retryHeaders++;
      }
    }
    result.retryAfterPreserved = retryHeaders === 2;
    let stats = '';
    for await (const event of nativeTransport({ url: new URL('/stats', endpoint).href, method: 'GET', headers: {}, signal })) {
      if (event.type === 'data') { stats += event.text; }
    }
    const parsed = JSON.parse(stats) as Pick<ProbeResult, 'sinkRequests' | 'sinkWithAuth' | 'abortedHolds'> & { unavailableGets: number; unavailablePosts: number };
    result.sinkRequests = parsed.sinkRequests;
    result.sinkWithAuth = parsed.sinkWithAuth;
    result.abortedHolds = parsed.abortedHolds;
    result.noImplicitRetry = parsed.unavailableGets === 1 && parsed.unavailablePosts === 1;
  } finally {
    await secure.removeKey(ref);
    result.secureRemoved = (await secure.getKey(ref)) === null;
  }
  return result;
}
