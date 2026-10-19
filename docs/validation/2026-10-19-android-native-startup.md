# Android 原生组件缺失回归 · 2026-10-19

基线：远端 `main` 的 `e93c605`。设备为本机 `Pixel_10_Pro`，Android 17 / API 37.2 / arm64-v8a / 16 KB 页面；Node 24.22.0、JDK 17。反馈截图来自另一台 Pixel 7 / API 36，当前只看到其中第 2 条 `RNCClipboard` 错误，不能断言截图中其余三条的具体内容。

## 排查结论

- 全新工作区执行 `npm ci`，完整编译 main 的 Debug / Release 成功。覆盖安装 main Debug 后正常进入首次引导，应用进程没有记录缺失原生模块的 JS 异常。
- 模拟器原有 Debug 安装包配合 main 的 Metro JS，实际出现 `Log 2 of 4`。逐条查看：第 1 条是 Console Warning，第 2 条为 `CoverStore` 缺失，第 3 条为 `AppInfo` 缺失，第 4 条为 `DocumentStore` 缺失。Logcat 同时记录启动封面/导出清理失败。
- 原生依赖的 autolinking 配置和新编译包正常。旧安装包配合新 JS 可以复现同类故障；Metro、Fast Refresh 和 Reload 均不能补齐 APK 内的原生模块。反馈者需要重新编译并覆盖安装配套的 APK。
- 代码存在启动诊断缺口：`index.js` 静态导入 App，App 的导入链包含剪贴板包，其 `getEnforcing('RNCClipboard')` 可在业务启动错误页挂载之前抛错。其他缺失模块的动态导入也会生成开发红屏，尽管上层捕获了异常。

## 修复与回归

入口改为先用非强制的 `TurboModuleRegistry.get` 检查剪贴板、SQLite、Keychain 以及四个应用自有原生模块；全部存在后才导入 App。缺失时仅显示依赖 RN 内置组件的提示页，列出全部缺失名称，提醒覆盖安装并保留数据；Debug 另提供重编译命令。不借助可能缺失的剪贴板复制错误。

| 检查 | 结果 |
| --- | --- |
| 原有旧 APK + 修复后 JS | 正常显示“应用需要更新”，列出 `RNKeychainManager`、`AppInfo`、`CoverStore`、`DocumentStore`、`ModelTransport`；该进程的 ReactNativeJS / AndroidRuntime 日志无错误或警告 |
| 入口回归测试 | 覆盖剪贴板缺失、多个自有模块缺失、SQLite/Keychain 缺失与全部正常四种情况；缺失时确认未导入 App，正常时确认加载 App |
| 完整 Debug 包 | 引导 → 跳过模型配置 → 书架 → 设置/关于正常 |
| 真实系统剪贴板 | 关于页点击版本后，在新建作品名称框执行系统粘贴，读回 `AI 小说创作伙伴 1.0（构建 1）（开发版）`，后续内容受名称长度限制截断 |
| 写作与保存 | 仅新建测试作品 `Clipboard Pixel Regression` 和一章，正文 `The letter waits beside the window.`；界面显示 30 字、已保存 |
| 原数据保护 | 安装前通过 run-as 本地备份。原 schema 2 升级到 13；逐项比较原有 3 章的 ID、work ID、标题和正文，全部一致；新增测试正文在真实 SQLite 中已持久化 |
| Release 离线运行 | 停止 Metro、移除本次 ADB reverse，覆盖安装正常 Release，冷启动可进入书架并打开测试章节，正文仍可见 |
| Release 剪贴板与日志 | 关于页复制安装版本成功；本次 Release 应用进程的 ReactNativeJS / AndroidRuntime 日志无错误或警告 |
| 工程检查 | ESLint、TypeScript、68 suites / 596 tests 通过；最终 Debug / Release 构建成功；`git diff --check` 通过 |

最终 Release APK SHA-256：`09108cf52789f323138915222d37a54f5342c92fcf7a9072d43b66870c1ff481`。

未卸载应用、清数据或回写数据库。所有业务写入限定新建测试作品及首次引导偏好；没有调用模型服务，实际 `ai_attempts` 为 0。测试作品保留供检查。最终保留完整 Release 安装包，关闭本次 Metro 并移除本次端口转发。

本地日志、APK、XML 和数据备份位于 `/tmp/novel-android-clipboard-20261019/`；含设备数据的临时文件不提交仓库。原始四条记录保存在 `logbox-*.xml`，旧包与新包进程日志分别为 `old-apk-main-js.log`、`stale-fixed-logcat.log`、`fixed-debug-logcat.log`、`fixed-release-logcat.log`，最终工程检查为 `final-check.log`、`final-build.log`。

本轮未验证 Windows、反馈者的具体安装包、iOS 或完整业务流程；这份记录只覆盖 Android 启动兼容性、剪贴板和写作保存的回归。
