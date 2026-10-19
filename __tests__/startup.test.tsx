import React from 'react';
import { AppRegistry, TurboModuleRegistry } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { NativeBuildErrorScreen } from '../src/screens/boot/NativeBuildErrorScreen';

const mockLoadApp = jest.fn();
jest.mock('../App', () => {
  mockLoadApp();
  return { __esModule: true, default: () => null };
});

const nativeGet = TurboModuleRegistry.get;
const installedModules = ['RNCClipboard', 'OPSQLite', 'RNKeychainManager', 'AppInfo', 'CoverStore', 'DocumentStore', 'ModelTransport'];
function registeredRoot(missing: string[]) {
  jest.spyOn(TurboModuleRegistry, 'get').mockImplementation(name => {
    if (missing.includes(name)) { return null; }
    return installedModules.includes(name) ? {} as never : nativeGet(name);
  });
  return rootProvider();
}

const register = jest.spyOn(AppRegistry, 'registerComponent');
require('../index');
expect(register).toHaveBeenCalledWith('NovelCreationPartner', expect.any(Function));
const rootProvider = register.mock.calls[0][1];
register.mockRestore();

afterEach(() => {
  jest.restoreAllMocks();
  mockLoadApp.mockClear();
});

test.each([
  { missing: ['RNCClipboard'] },
  { missing: ['AppInfo', 'CoverStore', 'DocumentStore', 'ModelTransport'] },
  { missing: ['OPSQLite', 'RNKeychainManager'] },
])('the real entry point avoids importing App when native modules are missing: $missing', async ({ missing }) => {
  const Root = registeredRoot(missing);
  expect(mockLoadApp).not.toHaveBeenCalled();
  let screen!: ReactTestRenderer;
  await act(async () => { screen = create(<Root />); });
  const error = screen.root.findByType(NativeBuildErrorScreen);
  expect(error.props.missingModules).toEqual(missing);
  const text = JSON.stringify(screen.toJSON());
  expect(text).toContain('应用需要更新');
  expect(text).toContain('不要卸载应用或清除数据');
  expect(text).toContain('npm run android');
  await act(async () => screen.unmount());
});

test('the real entry point loads App when the installed native modules are present', () => {
  expect(registeredRoot([])).toEqual(expect.any(Function));
  expect(mockLoadApp).toHaveBeenCalledTimes(1);
});
