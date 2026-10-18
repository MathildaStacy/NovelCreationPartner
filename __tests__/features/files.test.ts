import { cleanupExports, pick, safeDocumentName, setFileStoreDriver, writeAndShare } from '../../src/files';
afterEach(() => setFileStoreDriver(undefined));

test('share exposes only sanitized content and an allowlisted MIME', async () => {
  const share = jest.fn(async () => 'opened');
  setFileStoreDriver({ cleanupExports: async () => {}, writeAndShare: share, pick: async () => null });
  await writeAndShare('../../目录/novel.json', 'e30=', 'application/json');
  expect(share).toHaveBeenCalledWith('_.._目录_novel.json', 'e30=', 'application/json');
  await expect(writeAndShare('bad', 'not base64', 'text/plain')).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(writeAndShare('bad', 'e30=', 'text/html')).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(share).toHaveBeenCalledTimes(1);
  expect(safeDocumentName('...')).toBe('document');
  expect(safeDocumentName('a'.repeat(200)).length).toBe(120);
});

test('picker cancellation stays null; returned content is validated and no native path leaks', async () => {
  setFileStoreDriver({ cleanupExports: async () => {}, writeAndShare: async () => 'opened', pick: async () => null });
  expect(await pick()).toBeNull();
  setFileStoreDriver({ cleanupExports: async () => {}, writeAndShare: async () => 'opened', pick: async () => JSON.stringify({ name: '../backup.zip', base64: 'e30=', path: '/private/file' }) });
  expect(await pick()).toEqual({ name: '_backup.zip', base64: 'e30=' });
  setFileStoreDriver({ cleanupExports: async () => {}, writeAndShare: async () => 'opened', pick: async () => JSON.stringify({ name: 'bad', base64: '%%%%' }) });
  await expect(pick()).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
});

test('share preserves native completion, cancellation and chooser-opened states without guessing', async () => {
  for (const result of ['completed', 'cancelled', 'opened']) {
    setFileStoreDriver({cleanupExports:async()=>{},pick:async()=>null,writeAndShare:async()=>result});
    await expect(writeAndShare('novel.txt','e30=','text/plain')).resolves.toBe(result);
  }
  setFileStoreDriver({cleanupExports:async()=>{},pick:async()=>null,writeAndShare:async()=>''});
  await expect(writeAndShare('novel.txt','e30=','text/plain')).rejects.toMatchObject({code:'DB_ERROR',message:'没有打开分享面板，请重试'});
});

test('storage-full is distinct and cleanup uses a path-free native operation', async () => {
  const cleanup=jest.fn(async()=>{});
  setFileStoreDriver({cleanupExports:cleanup,pick:async()=>null,writeAndShare:async()=>{throw Object.assign(new Error('native storage'),{code:'STORAGE_FULL'});}});
  await expect(writeAndShare('novel.txt','e30=','text/plain')).rejects.toMatchObject({code:'STORAGE_FULL',message:'手机存储空间不足，没有生成导出文件。请清理空间后重试。'});
  await cleanupExports(); expect(cleanup).toHaveBeenCalledWith();
});
