import { Utf8Decoder } from '../../src/ai/transport/native';
import { SseDecoder, SseFailure, utf8Bytes } from '../../src/ai/providers/sse';

it('frames BOM, split CRLF, comments and multiple data fields at every UTF-8 byte boundary', () => {
  const wire = '\ufeff: 心跳\r\n\r\nevent: response.output_text.delta\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":"海🌊"}\r\nignored: value\r\n\r\n';
  const expected = [{ event: null, data: null }, { event: 'response.output_text.delta', data: '{"type":"response.output_text.delta",\n"delta":"海🌊"}' }];
  const bytes = Buffer.from(wire);
  for (let boundary = 0; boundary <= bytes.length; boundary++) {
    const utf8 = new Utf8Decoder();
    const sse = new SseDecoder();
    const first = utf8.decode(bytes.subarray(0, boundary).toString('base64'));
    const second = utf8.decode(bytes.subarray(boundary).toString('base64'));
    expect([...sse.push(first.text, first.bytes), ...sse.push(second.text, second.bytes), ...sse.finish()]).toEqual(expected);
  }
  const utf8 = new Utf8Decoder();
  const sse = new SseDecoder();
  const frames = [...bytes].flatMap(byte => {
    const decoded = utf8.decode(Buffer.from([byte]).toString('base64'));
    return sse.push(decoded.text, decoded.bytes);
  });
  expect([...frames, ...sse.finish()]).toEqual(expected);
});

it('uses LF and CR line endings without inventing a complete event at EOF', () => {
  const sse = new SseDecoder();
  expect(sse.push('data: first\n\ndata: second\r\rdata: dropped')).toEqual([
    { event: null, data: 'first' }, { event: null, data: 'second' },
  ]);
  expect(sse.finish()).toEqual([]);
  expect(sse.push('\n\n')).toEqual([]);
  const finalCr = new SseDecoder();
  expect(finalCr.push('data: complete\r\r')).toEqual([]);
  expect(finalCr.finish()).toEqual([{ event: null, data: 'complete' }]);
  const unterminated = new SseDecoder();
  expect(unterminated.push('data: {"type":"response.completed"}\n')).toEqual([]);
  expect(unterminated.finish()).toEqual([]);
});

it('enforces UTF-8 frame limits incrementally and total limits across consumed frames', () => {
  expect(utf8Bytes('甲🌊')).toBe(7);
  const frame = new SseDecoder({ frame: 12, response: 100 });
  expect(frame.push('data: 甲')).toEqual([]);
  expect(() => frame.push('🌊')).toThrow(SseFailure);
  const response = new SseDecoder({ frame: 20, response: 19 });
  expect(response.push('data: a\n\n')).toEqual([{ event: null, data: 'a' }]);
  expect(response.push('data: b\n\n')).toEqual([{ event: null, data: 'b' }]);
  expect(() => response.push('xx')).toThrow(SseFailure);
});
