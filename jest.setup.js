/* global jest */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@react-native-clipboard/clipboard', () => require('@react-native-clipboard/clipboard/jest/clipboard-mock.js'));
// The device driver needs the native module; tests use node:sqlite instead.
jest.mock('@op-engineering/op-sqlite', () => ({ open: () => { throw new Error('op-sqlite is not available in Jest'); } }));
