const {spawnSync} = require('node:child_process');
const {existsSync, readFileSync} = require('node:fs');
const path = require('node:path');

let missing = 0;
function report(name, ok, detail) {
  console.log(`${ok ? 'OK' : 'MISSING'} ${name}: ${detail}`);
  if (!ok) {missing += 1;}
}
function run(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8'});
  return {ok: !result.error && result.status === 0,
    text: `${result.stdout || ''}${result.stderr || ''}`.trim()};
}

const expectedNode = readFileSync(path.join(__dirname, '../.nvmrc'), 'utf8').trim();
report('Node', process.versions.node === expectedNode,
  `${process.versions.node}; project version ${expectedNode} (nvm use)`);
report('Dependencies', existsSync(path.join(__dirname, '../node_modules/react-native')),
  'npm ci');
const java = run('java', ['-version']);
report('JDK', java.ok && /version "17\./.test(java.text),
  java.text.split('\n')[0] || 'Install JDK 17 and set JAVA_HOME');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
report('Android SDK', !!sdk && existsSync(sdk), sdk || 'Set ANDROID_HOME');
for (const item of ['platform-tools/adb', 'platforms/android-37.0/android.jar',
  'build-tools/37.0.0/aapt2', 'ndk/27.1.12297006/source.properties',
  'cmake/3.22.1/bin/cmake']) {
  report(item, !!sdk && existsSync(path.join(sdk, item)), 'Required for Android builds');
}
if (process.platform === 'darwin') {
  const xcode = run('xcodebuild', ['-version']);
  const version = xcode.text.match(/Xcode (\d+)\.(\d+)/);
  report('Xcode', xcode.ok && !!version &&
    (Number(version[1]) > 16 || (Number(version[1]) === 16 && Number(version[2]) >= 1)),
    xcode.text.split('\n')[0] || 'Install full Xcode >= 16.1');
  const pods = run('bundle', ['exec', 'pod', '--version']);
  report('CocoaPods', pods.ok, pods.text.split('\n')[0] || 'bundle install');
} else {
  console.log('INFO iOS builds require macOS + Xcode; use the macOS CI job on other systems.');
}
process.exitCode = missing ? 1 : 0;
