import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type TransportEvent = {
  requestId: string;
  kind: string;
  status: CodegenTypes.Double;
  headers: string;
  data: string;
  code: string;
};

export interface Spec extends TurboModule {
  start(requestId: string, url: string, method: string, headers: string, body: string): void;
  abort(requestId: string): void;
  readonly onEvent: CodegenTypes.EventEmitter<TransportEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('ModelTransport');
