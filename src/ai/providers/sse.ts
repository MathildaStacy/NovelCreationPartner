export const MAX_FRAME_BYTES = 1024 * 1024;
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export interface SseFrame {
  event: string | null;
  /** null is a completed comment/heartbeat, while an empty data field is ''. */
  data: string | null;
}

export class SseFailure extends Error {
  readonly code = 'AI_RESPONSE_TOO_LARGE';
  constructor() { super('AI_RESPONSE_TOO_LARGE'); }
}

export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const point = char.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Consumes decoded UTF-8 chunks. Native byte decoding must retain split characters. */
export class SseDecoder {
  private line = '';
  private data: string[] = [];
  private event: string | null = null;
  private activity = false;
  private first = true;
  private pendingCr = false;
  private frameBytes = 0;
  private responseBytes = 0;
  private ended = false;

  constructor(private readonly limits = { frame: MAX_FRAME_BYTES, response: MAX_RESPONSE_BYTES }) {}

  push(text: string, byteLength = utf8Bytes(text)): SseFrame[] {
    if (this.ended) { return []; }
    this.responseBytes += byteLength;
    if (this.responseBytes > this.limits.response) { this.ended = true; throw new SseFailure(); }
    const frames: SseFrame[] = [];
    for (const char of text) {
      if (this.pendingCr) {
        this.pendingCr = false;
        if (char === '\n') {
          this.count(1);
          this.endLine(frames);
          continue;
        }
        this.endLine(frames);
      }
      this.count(utf8Bytes(char));
      if (this.first) {
        this.first = false;
        if (char === '\ufeff') { continue; }
      }
      if (char === '\r') { this.pendingCr = true; }
      else if (char === '\n') { this.endLine(frames); }
      else { this.line += char; }
    }
    return frames;
  }

  /** SSE discards an incomplete EOF frame, even when its JSON happens to be valid. */
  finish(): SseFrame[] {
    if (this.ended) { return []; }
    const frames: SseFrame[] = [];
    // A final CR is a complete line ending; it may close an otherwise complete frame.
    if (this.pendingCr) { this.endLine(frames); }
    this.ended = true;
    this.line = '';
    this.data = [];
    this.event = null;
    this.activity = false;
    this.pendingCr = false;
    return frames;
  }

  private count(bytes: number): void {
    this.frameBytes += bytes;
    if (this.frameBytes > this.limits.frame) { this.ended = true; throw new SseFailure(); }
  }

  private endLine(frames: SseFrame[]): void {
    const line = this.line;
    this.line = '';
    if (line === '') {
      if (this.activity) { frames.push({ event: this.event, data: this.data.length ? this.data.join('\n') : null }); }
      this.data = [];
      this.event = null;
      this.activity = false;
      this.frameBytes = 0;
      return;
    }
    this.activity = true;
    if (line.startsWith(':')) { return; }
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) { value = value.slice(1); }
    if (field === 'data') { this.data.push(value); }
    else if (field === 'event') { this.event = value || null; }
  }
}
