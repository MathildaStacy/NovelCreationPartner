import { AppError } from '../features/errors';
import { modelServiceText as t } from '../locales/modelServices';

export interface SecureDriver {
  setKey(ref: string, key: string): Promise<void>;
  getKey(ref: string): Promise<string | null>;
  removeKey(ref: string): Promise<void>;
}
let injected: SecureDriver | undefined;
/** Tests inject failure boundaries; the application always uses the system store. */
export function setSecureDriver(next: SecureDriver | undefined) { injected = next; }
function driver(): SecureDriver {
  return injected ?? (require('./keychain').keychainDriver as SecureDriver);
}
const unavailable = () => new AppError('KEY_UNAVAILABLE', t.keyUnavailable);
export async function setKey(ref: string, key: string): Promise<void> {
  try { await driver().setKey(ref, key); } catch { throw unavailable(); }
}
export async function getKey(ref: string): Promise<string | null> {
  try { return await driver().getKey(ref); } catch { throw unavailable(); }
}
export async function removeKey(ref: string): Promise<void> {
  try { await driver().removeKey(ref); } catch { throw unavailable(); }
}
