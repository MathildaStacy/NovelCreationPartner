import * as appInfo from '../../src/features/appInfo';
const mockInfo=jest.fn();
jest.mock('../../src/native/NativeAppInfo',()=>({__esModule:true,default:{getInfo:()=>mockInfo()}}));
test('About uses installed bundle version, build and release mode',async()=>{
  mockInfo.mockResolvedValueOnce(JSON.stringify({version:'2.4.1',build:'42',debug:false}));
  expect(await appInfo.get()).toEqual({version:'2.4.1',build:'42',debug:false});
});
test('unavailable or malformed native metadata stays explicitly unknown',async()=>{
  mockInfo.mockRejectedValueOnce(new Error('unavailable'));
  expect(await appInfo.get()).toBeNull();
  mockInfo.mockResolvedValueOnce(JSON.stringify({version:'2.4.1',build:'unknown',debug:true}));
  expect(await appInfo.get()).toBeNull();
});
