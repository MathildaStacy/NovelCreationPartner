import * as Keychain from 'react-native-keychain';
import type { SecureDriver } from './index';

const options = (ref: string) => ({
  service: `NovelCreationPartner.model.${ref}`,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
  // iOS generic passwords are not synchronizable unless explicitly opted in.
});
export const keychainDriver: SecureDriver = {
  async setKey(ref, key) {
    const result = await Keychain.setGenericPassword('model', key, options(ref));
    if (!result) { throw new Error('unavailable'); }
  },
  async getKey(ref) {
    const result = await Keychain.getGenericPassword(options(ref));
    return result ? result.password : null;
  },
  async removeKey(ref) {
    // The native library treats a missing item as a successful idempotent delete.
    if (!(await Keychain.resetGenericPassword(options(ref)))) {
      throw new Error('unavailable');
    }
  },
};
