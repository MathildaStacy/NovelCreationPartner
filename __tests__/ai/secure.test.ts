import { getKey, setKey, removeKey, setSecureDriver } from '../../src/secure';

afterEach(() => setSecureDriver(undefined));
it('distinguishes a missing slot from a temporarily unreadable one without retaining raw errors', async () => {
  const temporary = `invalid-${globalThis.crypto.randomUUID()}`;
  const driver = {
    getKey: jest.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error(temporary)),
    setKey: jest.fn().mockRejectedValue(new Error(temporary)),
    removeKey: jest.fn().mockRejectedValue(new Error(temporary)),
  };
  setSecureDriver(driver);
  expect(await getKey('slot')).toBeNull();
  for (const operation of [() => getKey('slot'), () => setKey('slot', temporary), () => removeKey('slot')]) {
    try { await operation(); throw new Error('expected failure'); }
    catch (error) {
      expect(error).toMatchObject({ code: 'KEY_UNAVAILABLE' });
      expect(String(error)).not.toContain(temporary);
      expect((error as Error).cause).toBeUndefined();
    }
  }
});
