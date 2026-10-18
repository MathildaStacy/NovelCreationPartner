import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
/** Only opaque tokens and image bytes are accepted. Paths are never input parameters. */
export interface Spec extends TurboModule {
  pick(): Promise<string | null>;
  importImage(base64: string): Promise<string>;
  read(token: string): Promise<string>;
  remove(token: string): Promise<void>;
  prune(keepTokensJson: string): Promise<void>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('CoverStore');
