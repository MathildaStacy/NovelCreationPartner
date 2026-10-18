import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /** completed/cancelled on iOS; opened on Android (no reliable destination completion callback). */
  writeAndShare(name: string, base64: string, mime: string): Promise<string>;
  /** Clears previous-process export files only; never accepts a path. */
  cleanupExports(): Promise<void>;
  /** JSON {name,base64}; null means the system picker was cancelled. No paths cross this boundary. */
  pick(): Promise<string | null>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('DocumentStore');
