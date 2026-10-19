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

Gradle 优先使用本机 `android/local.properties` 的 `node.binary`，其次使用 `NODE_BINARY` 环境变量。未显式配置时，会寻找 `.nvmrc` 对应的 macOS/Linux nvm 安装（默认 `~/.nvm/versions/node/v<版本>/bin/node`，也支持 `NVM_DIR`），找不到时使用 PATH 中的 `node`。因此 macOS 从 Dock 或 Finder 打开 Android Studio 时也能使用已安装的项目 Node 版本。

Windows 的 nvm-windows 不使用上述目录结构，需确保 Android Studio 的 PATH 中包含 Node，或在本机 `android/local.properties` 中设置 `node.binary=C:/Program Files/nodejs/node.exe`（按实际安装路径填写，使用正斜杠，不加引号）。`local.properties` 已被 Git 忽略，不要提交个人安装路径。该修复已在 macOS 验证 Gradle 同步及 ARM64 Release 构建；尚未在 Windows 实机验证。

## 通过界面体验应用（无需 Metro）

依赖和工具链准备好后，可以完全通过 Android Studio 编译、安装和运行 Release 版本：

1. 在 **Device Manager** 启动目标模拟器（例如 **Pixel 10 Pro**），等待进入桌面。
2. 打开 **View → Tool Windows → Build Variants**（macOS 也可按 **⌘⇧A** 搜索 `Build Variants`）。
3. 将 **`:app`** 行的 **Active Build Variant** 设为 **`release`**，等待同步完成；**Active ABI** 按模拟器镜像选择，Apple Silicon 通常为 **`arm64-v8a`**，Intel/AMD 通常为 **`x86_64`**。
4. 顶部设备选择器选择已启动的模拟器，旁边的运行配置选择 **app**，点击 **Run ▶**。

Release 会将 JavaScript 和资源打包进 APK，关闭 Metro 后仍可运行。当前 Release 使用本地调试签名，适合本机体验；发布前需配置正式签名。修改代码后，再次点击 **Run ▶** 重新编译和安装。

若 **Run ▶** 灰显，先查看底部 **Build → Sync** 的错误。出现 `A problem occurred starting process 'command 'node''` 时，检查上述 Node 路径配置，再点击 **File → Sync Project with Gradle Files**。

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

## 原生组件缺失或启动出现多条错误

出现 `RNCClipboard could not be found`，或 `AppInfo`、`CoverStore`、`DocumentStore` 等原生组件缺失时，先确认设备安装包是否与当前代码一致。Metro / Fast Refresh 只更新 JavaScript，新增原生依赖或 Kotlin 模块后必须重新编译并覆盖安装；`npm ci` 或 Reload 本身不能更新手机里的原生组件。

在项目根目录执行 `npm ci`，保持当前项目的 Metro 运行，再运行 `npm run android`（多设备时用 `-- --device <adb设备ID>` 选择目标设备）。Android Studio 中则重新 Sync 后点击 **Run ▶**。保留应用数据，不要通过卸载或清数据解决此问题。Release 用户需要覆盖安装与代码配套的新 APK。

启动入口会先检查剪贴板、数据库、安全存储和应用自有原生组件。缺失时显示“应用需要更新”，一次列出缺失名称，暂不打开数据库或加载业务页面；可长按选择详情。Debug 页面同时提供重编译提示。这是旧安装包的诊断提示，仍需安装完整的新包才能恢复使用。

React Native 顶部的 `Log 2 of 4` 是错误/警告记录的条目计数，不足以判断有四个独立缺陷。请逐条查看或采集当前应用进程的 Logcat，再用同一份代码完整编译的安装包复验。

## 只验证 Android 构建

不需要启动设备时，在项目根目录执行：

```sh
source scripts/dev-env.sh
cd android
./gradlew :app:assembleDebug --no-daemon -PreactNativeArchitectures=arm64-v8a
```

成功后 APK 在 `android/app/build/outputs/apk/debug/app-debug.apk`。如果 Android Studio 提示找不到 SDK，请在 **Settings/Preferences → Languages & Frameworks → Android SDK** 设置 SDK Location，然后重新 Sync；`local.properties` 是本机文件，不需要提交到仓库。
