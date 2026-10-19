# 开发环境与团队协作

## 工具版本

版本来自当前项目配置和 React Native 0.87.1。

| 工具 | 项目要求 |
| --- | --- |
| Node.js | `.nvmrc` 中的 24.22.0；不要使用 Node 25 |
| npm | 随上述 Node 安装，使用 `npm ci` 和 `package-lock.json` |
| Java | JDK 17 |
| Android SDK | Platform 37、Build Tools 37.0.0、Platform Tools |
| Android NDK / CMake | 27.1.12297006 / 3.22.1 |
| Android 最低系统 | API 24；当前 target SDK 36 |
| Xcode | >=16.1，完整应用及 iOS Simulator，需与 macOS 兼容 |
| iOS 最低系统 | 15.1 |
| Ruby | `.ruby-version` 中的 3.4.6 |
| CocoaPods | 1.16.2，通过 Gemfile.lock 与 Bundler 管理 |

Android 可在 macOS、Linux、Windows 开发；iOS 本地编译要求 macOS。无 Mac 的成员可通过 CI 检查 iOS 编译。

## 安装公共依赖

安装 [nvm](https://github.com/nvm-sh/nvm)（Windows 可使用 nvm-windows），在根目录执行：

```sh
nvm install
nvm use
npm ci
npm run check
```

不要全局安装旧版 `react-native-cli`，项目自带 CLI。依赖变更应提交 `package.json` 和 `package-lock.json`。

## Android

1. 安装 [JDK 17](https://adoptium.net/temurin/releases/?version=17) 和 [Android Studio / Command-line Tools](https://developer.android.com/studio)。Apple Silicon 选择 ARM64 下载。
2. 在 SDK Manager 安装上表版本，或执行：

```sh
# macOS 默认路径；其他系统使用本机 SDK 实际路径。
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
# 适用于通过安装器注册的 JDK：
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-37.0" "build-tools;37.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
```

3. 开启 Android 真机 USB 调试并授权电脑，以 `adb devices` 确认；或用 Android Studio Device Manager 创建模拟器（Apple Silicon 选 ARM64 镜像）。模拟器及系统镜像需另占空间。
4. 两个终端分别执行 `npm start` 和 `npm run android`。

也可以使用 Android Studio：先在项目根目录执行 `npm ci`，再用 Android Studio 打开 `android/` 子目录，等待 Gradle Sync 完成。选择 `app` 运行配置和已启动的模拟器/真机；Debug 运行前在项目根目录的终端执行 `npm start`。详细步骤见 [Android Studio 指南](ANDROID_STUDIO.md)。

只验证编译、无需设备：

```sh
cd android
./gradlew :app:assembleDebug --no-daemon -PreactNativeArchitectures=arm64-v8a
```

APK 位于 `android/app/build/outputs/apk/debug/`。该命令只构建 ARM64；x86_64 模拟器应更换架构参数。

本机可用 `source scripts/dev-env.sh` 加载 nvm、独立安装的 JDK、Ruby 和 SDK 路径；此脚本仅影响当前终端。Android Studio 的 Gradle JDK 也应设为 JDK 17。

## iOS

1. 从 App Store 或 [Apple Developer Downloads](https://developer.apple.com/download/all/) 安装与 macOS 兼容的完整 Xcode（>=16.1）。仅 Command Line Tools 无法构建 iOS。
2. 打开 Xcode 完成首次组件安装和许可证确认，安装 iOS Simulator runtime。必要时执行：

```sh
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
```

3. 使用 rbenv、mise 或 Ruby 官方构建安装 `.ruby-version` 对应版本，确保 `ruby -v` 使用 Ruby 3.4，而非 macOS 自带的 2.6。
4. 在根目录安装依赖：

```sh
gem install bundler -v 2.6.9
bundle install
cd ios
bundle exec pod install
cd ..
npm run ios
```

仓库已提交 `ios/Podfile.lock`，让团队和 CI 使用相同的 Pods 版本。手动启用 iOS CI 时使用 `pod install --deployment` 检查锁文件；原生依赖或 Codegen 接口变化后，在本地执行 `bundle exec pod install` 并提交更新后的锁文件。

原生调试打开 `ios/NovelCreationPartner.xcworkspace`。iOS 模拟器无需付费 Apple Developer 账号；真机需在 Xcode 配置自己的 Apple Team 和签名，上架另需开发者计划。

## 日常检查与 CI

```sh
npm run doctor    # 严格检查工具链，缺失时退出码为 1
npm run doctor -- --android  # 仅检查 Android 开发环境，暂未安装 Xcode 时使用
npm run check     # ESLint + TypeScript + Jest
```

CI 在 `main` 推送、面向 `main` 的 PR 和手动触发时运行：

| 检查名 | 内容 |
| --- | --- |
| Quality | 干净安装依赖、lint、类型检查、Jest 测试 |
| Android build | JDK 17 + Gradle，编译 ARM64 debug APK，保存 7 天 |
| iOS build | 暂不自动运行、不作为合并门禁；手动勾选 `build_ios` 时在 macOS 编译 iOS Simulator，无签名 |

当前以 Android 开发为主。需要排查 iOS 时，在 Actions → CI → Run workflow 勾选 `build_ios`，或运行 `gh workflow run ci.yml -f build_ios=true`。恢复 iOS 开发后，应修复原生编译问题，再恢复自动构建和必过检查。当前已知问题是 `CoverStore` 引用的 `PHPickerConfiguration`、`PHPickerFilter` 和 `PHPickerViewController` 在链接时未找到，需要检查 PhotosUI framework 链接配置。

编译通过后，业务功能仍需设备测试。CI 不执行商店发布。公开 Fork 的首次 Actions 运行可能需要维护者批准，这是 GitHub 的默认行为。

## GitHub 协作权限

仓库：[MathildaStacy/NovelCreationPartner](https://github.com/MathildaStacy/NovelCreationPartner)。

| 场景 | 是否需要邀请 |
| --- | --- |
| 阅读、克隆、提 Issue | 不需要，仓库公开 |
| Fork 后提交 PR | 不需要直接写入权限 |
| 直接向本仓库推送开发分支 | 需要协作者 Write 权限 |
| 修改仓库设置、管理访问权限 | 保留给仓库所有者 |

个人账号仓库的普通协作者获得 Write 访问权限；Read/Triage/Maintain 等精细角色需要组织仓库。无需共享账号、PAT 或 SSH 私钥。

邀请入口：[Settings → Collaborators](https://github.com/MathildaStacy/NovelCreationPartner/settings/access) → Add people → 输入 GitHub 用户名 → 朋友接受邀请。当前协作者为 `@Citrusyouzi` 和 `@123mengxin123`，均具有 Write 权限。

`main` 的目标规则：

- 通过 PR 合并，至少 1 位其他代码负责人批准；代码负责人为 `@MathildaStacy`、`@Citrusyouzi` 和 `@123mengxin123`。
- 新推送使旧批准失效，所有审查讨论必须解决。
- 要求 Quality、Android build 通过，并更新到最新 `main`；iOS build 暂为手动可选检查。
- 禁止强制推送与删除分支。
- 使用 Squash merge，合并后自动删除开发分支。
- 对管理员同样强制执行保护；仓库所有者也必须通过 PR，并等待全部必过检查和代码负责人批准后合并。

新成员接受邀请后，可将其他维护者追加到 `.github/CODEOWNERS`。PR 作者不能批准自己的 PR；维护者自己提交的 PR 必须由另一位代码负责人批准，因此团队应至少配置两位代码负责人。

```sh
git switch main
git pull --ff-only
git switch -c feature/your-feature
# 开发、npm run check、提交
git push -u origin feature/your-feature
gh pr create --base main
```

Issues 和 Projects 功能已开启；可按需建立项目看板。启用功能与创建具体看板是两个步骤。
