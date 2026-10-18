/* global jest */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@react-native-clipboard/clipboard', () => require('@react-native-clipboard/clipboard/jest/clipboard-mock.js'));
// The device driver needs the native module; tests use node:sqlite instead.
jest.mock('@op-engineering/op-sqlite', () => ({ open: () => { throw new Error('op-sqlite is not available in Jest'); } }));
// Native photo/file behavior requires device acceptance; tests inject explicit drivers for cover operations.
jest.mock('./src/native/NativeCoverStore', () => ({ default: {
  pick: jest.fn(async () => null), prune: jest.fn(async () => {}), remove: jest.fn(async () => {}),
  read: jest.fn(async () => { throw new Error('Native image read is not available in Jest'); }),
  importImage: jest.fn(async () => { throw new Error('Native image processing is not available in Jest'); }),
} }));
jest.mock('./src/native/NativeDocumentStore', () => ({ default: {
  cleanupExports: jest.fn(async () => {}), pick: jest.fn(async () => null),
  writeAndShare: jest.fn(async () => { throw new Error('Native system share is not available in Jest'); }),
} }));
