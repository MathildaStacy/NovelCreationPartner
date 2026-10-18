import * as storage from '../../src/features/storage';
const mockUsage = jest.fn();
jest.mock('../../src/native/NativeAppInfo', () => ({ __esModule: true, default: { getStorageUsage: () => mockUsage() } }));
beforeEach(() => mockUsage.mockReset());

test('fixed native byte buckets preserve zero and are returned without paths', async () => {
  mockUsage.mockResolvedValueOnce('{"db":12000,"covers":0,"cache":3000}');
  expect(await storage.usage()).toEqual({ db: 12000, covers: 0, cache: 3000 });
  expect(mockUsage).toHaveBeenCalledWith();
});

test.each([
  'broken', 'null', '[]', '{"db":0,"covers":0}', '{"db":-1,"covers":0,"cache":0}',
  '{"db":0.5,"covers":0,"cache":0}', '{"db":"12","covers":0,"cache":0}',
  '{"db":9007199254740992,"covers":0,"cache":0}', '{"db":9007199254740991,"covers":1,"cache":0}',
  '{"db":0,"covers":0,"cache":0,"path":"/private/file"}',
])('invalid native storage counts remain unknown: %s', async raw => {
  mockUsage.mockResolvedValueOnce(raw);
  expect(await storage.usage()).toBeNull();
});

test('native read failure remains unknown rather than zero', async () => {
  mockUsage.mockRejectedValueOnce(new Error('unavailable'));
  expect(await storage.usage()).toBeNull();
});
