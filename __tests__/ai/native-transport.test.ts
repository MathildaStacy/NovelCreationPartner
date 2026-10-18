import { createNativeTransport, Utf8Decoder, type HttpEvent } from '../../src/ai/transport/native';
import type { Spec, TransportEvent } from '../../src/native/NativeModelTransport';

function fixture() {
  let listener: (e: TransportEvent) => void = () => {};
  let id = '';
  const remove = jest.fn();
  const native = {
    onEvent: jest.fn(fn => { listener = fn; return { remove }; }),
    start: jest.fn(requestId => { id = requestId; }),
    abort: jest.fn(),
  } as unknown as Spec;
  const send = (kind: string, fields: Partial<TransportEvent> = {}) => listener({ requestId: id, kind, status: 200, headers: '{}', data: '', code: '', ...fields });
  const controller = new AbortController();
  const events = createNativeTransport(native)({ url: 'https://example.com', method: 'GET', headers: {}, signal: controller.signal })[Symbol.asyncIterator]();
  return { native, send, remove, controller, events };
}

it('decodes every byte boundary of Chinese and emoji without corrupting text', () => {
  const text = '\ufeffdata: 海风🌊\r\n\r\n';
  const bytes = Buffer.from(text);
  for (let split = 0; split <= bytes.length; split++) {
    const decoder = new Utf8Decoder();
    expect(decoder.decode(bytes.subarray(0, split).toString('base64')).text + decoder.decode(bytes.subarray(split).toString('base64')).text + decoder.decode('', true).text).toBe(text);
  }
  const decoder = new Utf8Decoder();
  expect([...bytes].map(b => decoder.decode(Buffer.from([b]).toString('base64')).text).join('')).toBe(text);
  decoder.decode('', true);
});

it.each([[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe4]])('rejects invalid or incomplete UTF-8 %j', (...bytes: number[]) => {
  const decoder = new Utf8Decoder();
  expect(() => { decoder.decode(Buffer.from(bytes).toString('base64')); decoder.decode('', true); }).toThrow('encoding');
});

it('delivers chunks before completion and disposes native resources on early iterator return', async () => {
  const f = fixture();
  const first = f.events.next();
  f.send('headers', { headers: '{"content-type":"text/event-stream"}' });
  expect((await first).value).toMatchObject({ type: 'headers', status: 200 });
  const next = f.events.next();
  f.send('data', { data: Buffer.from('第一段').toString('base64') });
  expect((await next).value).toEqual({ type: 'data', text: '第一段', bytes: 9 });
  await f.events.return?.();
  expect(f.remove).toHaveBeenCalledTimes(1);
  expect(f.native.abort).toHaveBeenCalledTimes(1);
});

it('aborts a pending read, ignores late native success and settles only once', async () => {
  const f = fixture();
  const reading = f.events.next();
  f.controller.abort();
  f.send('complete');
  await expect(reading).rejects.toMatchObject({ code: 'cancelled' });
  expect(await f.events.next()).toEqual({ done: true, value: undefined });
  expect(f.remove).toHaveBeenCalledTimes(1);
});

it('does not start an already cancelled request', async () => {
  const f = fixture();
  f.controller.abort();
  await expect(f.events.next()).rejects.toMatchObject({ code: 'cancelled' });
  expect(f.native.start).not.toHaveBeenCalled();
});

it.each(['redirect', 'too_large', 'network'])('exposes only a safe native failure category: %s', async code => {
  const f = fixture();
  const reading = f.events.next();
  f.send('error', { code });
  await expect(reading).rejects.toMatchObject({ code, message: code });
  expect(f.remove).toHaveBeenCalledTimes(1);
});

it('releases the subscription after EOF and ignores duplicate terminals', async () => {
  const f = fixture();
  const captured: HttpEvent[] = [];
  const reading = (async () => { for await (const event of { [Symbol.asyncIterator]: () => f.events }) captured.push(event); })();
  f.send('headers');
  f.send('complete');
  f.send('error', { code: 'network' });
  await reading;
  expect(captured).toHaveLength(1);
  expect(f.remove).toHaveBeenCalledTimes(1);
});
