import { Autosave } from '../../src/screens/editor/autosave';
import { AppError } from '../../src/features/errors';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = async (ms: number) => {
  await jest.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it('saves two seconds after typing stops and stores the latest caret', async () => {
  const save = jest.fn().mockResolvedValue('ok');
  const state = jest.fn();
  const editor = new Autosave('', 0, save, state);
  editor.edit('风', 1);
  await tick(1500);
  editor.edit('风起', 2);
  await tick(1999);
  expect(save).not.toHaveBeenCalled();
  await tick(1);
  expect(save).toHaveBeenCalledWith('风起', 2);
  expect(editor.status).toBe('saved');
  editor.cursor = 1;
  await editor.flush();
  expect(save).toHaveBeenLastCalledWith('风起', 1);
  editor.dispose();
});
it('forces a save within ten seconds of continuous input', async () => {
  const save = jest.fn().mockResolvedValue('ok');
  const editor = new Autosave('', 0, save, jest.fn());
  for (let i = 0; i < 10; i++) {
    editor.edit('风'.repeat(i + 1), i + 1);
    await tick(1000);
  }
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith('风'.repeat(10), 10);
  editor.dispose();
});
it('serializes writes and flush drains edits made while an older body is saving', async () => {
  const first = deferred<string>();
  const save = jest
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValue('latest');
  const state = jest.fn();
  const editor = new Autosave('', 0, save, state);
  editor.edit('旧', 1);
  const flushing = editor.flush();
  editor.edit('新正文', 3);
  const secondFlush = editor.flush();
  expect(save).toHaveBeenCalledTimes(1);
  first.resolve('old');
  await flushing;
  await secondFlush;
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith('新正文', 3);
  expect(state.mock.calls.some(c => c[0] === 'saved' && c[1] === 'old')).toBe(
    false,
  );
  expect(editor.status).toBe('saved');
  editor.dispose();
});
it('keeps unsaved text after a database failure and retries only on an explicit flush', async () => {
  const save = jest
    .fn()
    .mockRejectedValueOnce(new AppError('DB_ERROR', 'database unavailable'))
    .mockResolvedValue('ok');
  const editor = new Autosave('原文', 0, save, jest.fn());
  editor.edit('修改', 2);
  await tick(2000);
  expect(editor.body).toBe('修改');
  expect(editor.status).toBe('failed');
  editor.edit('继续写', 3);
  await tick(30_000);
  expect(save).toHaveBeenCalledTimes(1);
  await editor.flush();
  expect(save).toHaveBeenLastCalledWith('继续写', 3);
  expect(editor.status).toBe('saved');
  editor.dispose();
});
it('retries full storage after ten seconds and disposes timers without losing the in-flight text', async () => {
  const save = jest
    .fn()
    .mockRejectedValueOnce(new AppError('STORAGE_FULL', 'full'))
    .mockResolvedValue('ok');
  const editor = new Autosave('原文', 0, save, jest.fn());
  editor.edit('修改', 2);
  await tick(2000);
  await tick(9999);
  expect(save).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(save).toHaveBeenCalledTimes(2);
  expect(editor.status).toBe('saved');
  editor.edit('未保存', 3);
  editor.dispose();
  await tick(20_000);
  expect(save).toHaveBeenCalledTimes(2);
});

it('flush persists a caret moved while the same body is already saving', async () => {
  const first = deferred<string>();
  const save = jest
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValue('ok');
  const editor = new Autosave('风起', 0, save, jest.fn());
  const current = editor.flush();
  editor.cursor = 2;
  const leaving = editor.flush();
  first.resolve('ok');
  await current;
  await leaving;
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith('风起', 2);
  editor.dispose();
});
