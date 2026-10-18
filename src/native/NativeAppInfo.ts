import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
export interface Spec extends TurboModule {
  /** Build metadata from the installed bundle, never package.json guesses. */
  getInfo(): Promise<string>;
  /** Bytes in fixed app-owned locations. No caller-provided path enters the bridge. */
  getStorageUsage(): Promise<string>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('AppInfo');
