/* eslint-disable no-bitwise -- UTF-8 and base64 decoding operate on bytes. */
import type { Spec, TransportEvent } from '../../native/NativeModelTransport';

export class TransportFailure extends Error {
  constructor(readonly code: 'network' | 'redirect' | 'too_large' | 'encoding' | 'cancelled') {
    super(code);
  }
}
export type HttpEvent =
  | { type: 'headers'; status: number; headers: Record<string, string> }
  | { type: 'data'; text: string; bytes: number };
export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}
export type HttpTransport = (request: HttpRequest) => AsyncIterable<HttpEvent>;

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Native sends bytes, so a split UTF-8 character never becomes two replacement characters. */
export class Utf8Decoder {
  private tail: number[] = [];
  decode(base64: string, final = false): { text: string; bytes: number } {
    const incoming: number[] = [];
    let bits = 0;
    let value = 0;
    for (const char of base64.replace(new RegExp('=+$'), '')) {
      const digit = alphabet.indexOf(char);
      if (digit < 0) {
        throw new TransportFailure('encoding');
      }
      value = (value << 6) | digit;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        incoming.push((value >> bits) & 255);
      }
    }
    const bytes = [...this.tail, ...incoming];
    let text = '';
    let i = 0;
    while (i < bytes.length) {
      const first = bytes[i];
      const length = first < 128 ? 1 : first >= 194 && first <= 223 ? 2 : first >= 224 && first <= 239 ? 3 : first >= 240 && first <= 244 ? 4 : 0;
      if (!length) {
        throw new TransportFailure('encoding');
      }
      if (i + length > bytes.length) {
        break;
      }
      let code = first & (length === 1 ? 127 : (1 << (7 - length)) - 1);
      for (let n = 1; n < length; n++) {
        const next = bytes[i + n];
        if (next < 128 || next > 191) {
          throw new TransportFailure('encoding');
        }
        code = (code << 6) | (next & 63);
      }
      if ((length > 1 && code < [0, 0, 128, 2048, 65536][length]) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        throw new TransportFailure('encoding');
      }
      text += String.fromCodePoint(code);
      i += length;
    }
    this.tail = bytes.slice(i);
    if (final && this.tail.length) {
      throw new TransportFailure('encoding');
    }
    return { text, bytes: incoming.length };
  }
}

let serial = 0;
export function createNativeTransport(native: Spec): HttpTransport {
  return async function* (request) {
    if (request.signal.aborted) {
      throw new TransportFailure('cancelled');
    }
    const requestId = `model-${Date.now()}-${++serial}`;
    const queue: TransportEvent[] = [];
    let wake: (() => void) | undefined;
    let ended = false;
    let cancelled = false;
    const notify = () => { wake?.(); wake = undefined; };
    const subscription = native.onEvent(event => {
      if (event.requestId !== requestId || ended || cancelled) {
        return;
      }
      queue.push(event);
      if (['complete', 'error', 'cancelled'].includes(event.kind)) {
        ended = true;
      }
      notify();
    });
    const abort = () => {
      cancelled = true;
      queue.length = 0;
      native.abort(requestId);
      notify();
    };
    request.signal.addEventListener('abort', abort, { once: true });
    const decoder = new Utf8Decoder();
    let total = 0;
    try {
      if (request.signal.aborted) {
        throw new TransportFailure('cancelled');
      }
      native.start(requestId, request.url, request.method, JSON.stringify(request.headers), request.body ?? '');
      for (;;) {
        if (cancelled) {
          throw new TransportFailure('cancelled');
        }
        const event = queue.shift();
        if (!event) {
          await new Promise<void>(resolve => { wake = resolve; });
          continue;
        }
        if (event.kind === 'headers') {
          yield { type: 'headers', status: event.status, headers: JSON.parse(event.headers) as Record<string, string> };
        } else if (event.kind === 'data') {
          const chunk = decoder.decode(event.data);
          total += chunk.bytes;
          if (total > 16 * 1024 * 1024) {
            throw new TransportFailure('too_large');
          }
          yield { type: 'data', ...chunk };
        } else if (event.kind === 'complete') {
          decoder.decode('', true);
          return;
        } else if (event.kind === 'cancelled') {
          throw new TransportFailure('cancelled');
        } else if (event.kind === 'error') {
          throw new TransportFailure(event.code === 'redirect' || event.code === 'too_large' ? event.code : 'network');
        }
      }
    } catch (error) {
      throw error instanceof TransportFailure ? error : new TransportFailure('network');
    } finally {
      ended = true;
      request.signal.removeEventListener('abort', abort);
      subscription.remove();
      native.abort(requestId);
      queue.length = 0;
    }
  };
}

export const nativeTransport: HttpTransport = request => {
  const native = require('../../native/NativeModelTransport').default as Spec;
  return createNativeTransport(native)(request);
};
