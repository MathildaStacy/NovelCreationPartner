import { ensureModelService } from '../../src/app/dialogs';
import { useOverlay, closeDialog } from '../../src/components/overlay/store';
import * as services from '../../src/features/modelServices';
import * as taskServices from '../../src/features/taskServices';
import * as prefs from '../../src/features/prefs';
import { setSecureDriver } from '../../src/secure';
import { freshDb } from '../helpers/db';
import { draft, installSecure, temporaryKey } from '../helpers/modelServices';

beforeEach(() => { installSecure(); useOverlay.setState({ dialogs: [], toast: null, depth: 0 }); });
afterEach(() => { setSecureDriver(undefined); useOverlay.setState({ dialogs: [] }); });

test('writing entry guard accepts an explicit usable binding despite a default without a Key', async () => {
  const db = await freshDb();
  const fallback = (await services.save(draft({ name: '默认' }), temporaryKey())).service;
  const bound = (await services.save(draft({ name: '写作' }), temporaryKey())).service;
  await db.run('UPDATE model_services SET has_key=0,key_ref=NULL WHERE id=?', [fallback.id]);
  await taskServices.setTaskService('writing', bound.id);
  expect(await ensureModelService()).toBe('ok');
  expect(useOverlay.getState().dialogs).toHaveLength(0);
  await prefs.set('serviceBindings', { writing: 'missing', utility: null, review: null });
  await expect(ensureModelService()).rejects.toMatchObject({ code: 'NO_SERVICE' });
  expect(useOverlay.getState().dialogs).toHaveLength(0);
  await db.close();
});

test('missing Key dialog edits the bound service instead of the healthy default', async () => {
  const db = await freshDb();
  await services.save(draft({ name: '默认' }), temporaryKey());
  const bound = (await services.save(draft({ name: '写作专用' }), temporaryKey())).service;
  await db.run('UPDATE model_services SET has_key=0,key_ref=NULL WHERE id=?', [bound.id]);
  await taskServices.setTaskService('writing', bound.id);
  const navigate = jest.fn();
  const pending = ensureModelService(() => true, { navigate });
  for (let n = 0; n < 40 && !useOverlay.getState().dialogs.length; n++) await new Promise<void>(resolve => setTimeout(resolve, 0));
  const dialog = useOverlay.getState().dialogs[0];
  expect(dialog.message).toContain('写作专用');
  dialog.resolve('connect'); closeDialog(dialog.id);
  expect(await pending).toBe('connect');
  expect(navigate).toHaveBeenCalledWith('ModelService', { mode: 'edit', from: 'd03', serviceId: bound.id, focus: 'key' });
  await db.close();
});
