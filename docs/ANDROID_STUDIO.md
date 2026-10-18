# 用 Android Studio 打开和运行

这是一个 React Native 项目。Android Studio 需要打开 `android/` 子目录，项目根目录用于安装 JavaScript 依赖和启动 Metro。

## 第一次准备

在项目根目录执行：

```sh
nvm install
nvm use
npm ci
source scripts/dev-env.sh
npm run doctor -- --android
```

Android Studio 的 SDK Manager 需要安装 Platform 37、Build Tools 37.0.0、NDK 27.1.12297006、CMake 3.22.1 和 Platform Tools。工具版本和安装命令见[开发环境指南](DEVELOPMENT.md)。

## 在 Android Studio 中打开

1. 启动 Android Studio，选择 **Open**，打开本项目的 `android/` 目录，不要选择仓库根目录。
2. 等待 Gradle Sync 完成。执行 Sync 前必须已经运行过 `npm ci`，否则 `node_modules/@react-native/gradle-plugin` 不存在，Gradle 无法加载 React Native 插件。
3. 打开 **Settings/Preferences → Build, Execution, Deployment → Build Tools → Gradle**，将 **Gradle JDK** 设为 JDK 17（或 Android Studio 自带的 17+ JDK）。项目 CI 使用 JDK 17。
4. 在 **Device Manager** 启动一个模拟器，或连接已打开 USB 调试的 Android 真机。Apple Silicon Mac（M 系列芯片）选择官方 **ARM64 / arm64-v8a** 系统镜像；Intel/AMD 电脑选择 x86_64 镜像。APK 的构建架构不能替代模拟器对宿主芯片的要求。

本机已验证的设备是用户在 Android Studio 中创建的 **Pixel 10 Pro / API 37.2 / Google Play 16 KB Page Size / arm64-v8a**，使用官方 Android Emulator 37.2.12。可以直接复用这个设备。编译用的 SDK Platform 与模拟器系统镜像分别安装，模拟器无需与 compile SDK 使用相同版本。

## 运行应用

React Native Debug 变体需要 Metro 提供 JavaScript bundle，因此先在项目根目录的终端启动：

```sh
source scripts/dev-env.sh
npm start -- --host 127.0.0.1
```

Metro 保持运行，再在另一个项目终端连接设备：

```sh
source scripts/dev-env.sh
adb devices
adb -s emulator-5554 reverse tcp:8081 tcp:8081
```

`emulator-5554` 替换为 `adb devices` 显示的目标设备。重启模拟器或重新连接设备后，重新执行 `adb reverse`。

本机已将应用的 **Dev Settings → Debug server host & port for device** 设置为 `127.0.0.1:8081`，通过上述 ADB 转发连接 Metro。卸载应用或清除应用数据后，需要重新设置：在应用内打开开发菜单（macOS 独立模拟器通常使用 **⌘M**，也可以执行 `adb -s emulator-5554 shell input keyevent 82`），进入 **Dev Settings**，填写地址后 **Reload**。Android 17 上即使拒绝本地网络权限，也可以通过这个回环地址调试。

然后回到 Android Studio：

1. 顶部运行配置选择 `app`。
2. 选择已经启动的模拟器或真机。
3. 点击 **Run ▶** 启动，或点击 **Debug 🐞** 连接原生调试器。

Android Studio 会安装并启动 `app`，Metro 终端保持运行即可支持 Fast Refresh。也可以在另一个已加载 `scripts/dev-env.sh` 的终端执行 `npm run android`。

当前应用启动时会打开本地 SQLite 并执行迁移，成功后进入 **我的书架**。首次引导和模型连接页在本阶段跳过；可以离线创建作品、管理章节、编辑和自动保存正文、定稿，以及查看和恢复历史版本。数据库打开或迁移失败时会显示可复制错误详情的错误页。Pixel 10 Pro 的本轮验证结果见[核心写作验证记录](validation/2026-10-18-core-writing.md)。

## 调试代码

- **Java/Kotlin 原生代码**：使用 Android Studio 的 **Debug app**，在原生代码中设置断点，通过 Debug 面板查看线程和变量；设备日志在 **Logcat** 查看。
- **TypeScript/React 代码**：在 Metro 终端按 **j** 打开 **React Native DevTools**，设置 JavaScript 断点并检查组件。Android Studio 的原生调试器负责 Java/Kotlin/C++ 调试，TypeScript 断点通过 React Native DevTools 调试。
- **修改页面**：编辑 `src/screens/` 中的对应页面，保存后通过 Fast Refresh 更新模拟器。`App.tsx` 负责启动、导航和全局弹层；验证数据持久化与首次进入行为时，使用冷启动重新检查。

若出现 **Unable to load script** 或连接 `10.0.2.2:8081` 超时，检查 Metro 仍在运行、`adb reverse --list` 包含 `tcp:8081 tcp:8081`，并确认应用中的调试服务器地址是 `127.0.0.1:8081`。可用 `curl http://127.0.0.1:8081/status` 检查 Metro，正常返回 `packager-status:running`。

## 只验证 Android 构建

不需要启动设备时，在项目根目录执行：

```sh
source scripts/dev-env.sh
cd android
./gradlew :app:assembleDebug --no-daemon -PreactNativeArchitectures=arm64-v8a
```

成功后 APK 在 `android/app/build/outputs/apk/debug/app-debug.apk`。如果 Android Studio 提示找不到 SDK，请在 **Settings/Preferences → Languages & Frameworks → Android SDK** 设置 SDK Location，然后重新 Sync；`local.properties` 是本机文件，不需要提交到仓库。
