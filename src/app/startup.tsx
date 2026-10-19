import React, { type ComponentType } from 'react';
import { TurboModuleRegistry } from 'react-native';
import { NativeBuildErrorScreen } from '../screens/boot/NativeBuildErrorScreen';

// Check before importing App: clipboard and SQLite resolve native modules at
// import time, before the database boot error screen can handle a failure.
const requiredModules = [
  'RNCClipboard',
  'OPSQLite',
  'RNKeychainManager',
  'AppInfo',
  'CoverStore',
  'DocumentStore',
  'ModelTransport',
] as const;

export function getStartupComponent(): ComponentType {
  const missing = requiredModules.filter(name => TurboModuleRegistry.get(name) == null);
  if (missing.length) {
    return function IncompleteNativeBuild() {
      return <NativeBuildErrorScreen missingModules={missing} />;
    };
  }
  // A static import would evaluate native dependencies before the check above.
  return require('../../App').default;
}
