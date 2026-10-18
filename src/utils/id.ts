/** IDs and timestamps (G02 §1): UUID v4 strings, ISO 8601 in the local time zone. */

type CryptoLike = { getRandomValues?: (a: Uint8Array) => Uint8Array };

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

export function uuid(): string {
  const b = randomBytes(16);
  /* eslint-disable no-bitwise -- RFC 4122 version and variant bits */
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  /* eslint-enable no-bitwise */
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');

/** e.g. 2026-10-16T14:32:00.123+08:00 */
export function toLocalIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

let clock: () => Date = () => new Date();

export const nowIso = (): string => toLocalIso(clock());

/** Test helper: freeze or advance time. */
export function setClock(fn: (() => Date) | null): void {
  clock = fn ?? (() => new Date());
}

/** Milliseconds since epoch for an ISO string (for comparisons across time zones). */
export const isoMs = (iso: string): number => Date.parse(iso);
