# NovelCreationPartner · AI 小说创作伙伴

面向小说创作新手的 Android / iOS 应用，使用 React Native 0.87.1、React 19 和 TypeScript。当前已实现本地写作核心、模型配置服务层及双协议连接测试；模型配置界面、主页、业务 AI 和原生设备验收尚未完成。接续开发前请阅读[开发交接](docs/HANDOFF.md)。

AI 协助创意澄清、人物与世界观管理、局部描写和故事一致性检查，作者保留最终决定权。V1 本地优先：无需账号，作品存在手机上，用户自带 OpenAI Responses 或 Anthropic Messages 服务的地址和 API Key。

| 文档 | 内容 |
| --- | --- |
| [开发交接](docs/HANDOFF.md) | 当前完成范围、提交、验证、阶段边界与下一会话入口 |
| [MVP 详细设计](docs/detailed-design/index.html) | 页面交互和本地服务、AI 调用契约，作为开发依据 |
| [产品说明](docs/PRODUCT_BRIEF.md) | 需求来源（V1.0 讨论稿） |
| [产品设计](docs/PRODUCT_DESIGN.md) | 页面、流程、AI 模型服务、记忆状态、MVP 范围 |
| [UI 设计规范](docs/UI_DESIGN.md) | 设计令牌、组件、页面布局 |
| [界面原型](docs/design/prototype.html) | 16 个画面，下载后用浏览器打开 |
| [技术架构总图](docs/architecture/index.html) | 分层、模块、运行机制、AI 运行时、扩展点、演进路线 |
| [架构](ARCHITECTURE.md) | 本地优先架构、数据模型、模型适配层、里程碑 |
| [产品规划](README_CN.md) | 功能模块与路线图 |
| [Android Studio 指南](docs/ANDROID_STUDIO.md) | 打开 Android 原生工程、启动 Metro、运行模拟器或真机 |

## 开始开发

完整步骤见[开发环境指南](docs/DEVELOPMENT.md)。

```sh
git clone https://github.com/MathildaStacy/NovelCreationPartner.git
cd NovelCreationPartner
nvm install
nvm use
npm ci
npm run check
```

安装原生工具链后：

```sh
source scripts/dev-env.sh  # macOS + nvm；仅影响当前终端
npm run doctor           # 检查工具链
# 暂未安装 Xcode 时使用 npm run doctor -- --android
npm start                # 保持此终端运行 Metro
# 在另一个已配置环境的终端中选择一项：
npm run android
npm run ios
```

如果使用 Android Studio，请先执行 `npm ci`，然后用 Android Studio 打开 `android/` 子目录；完整步骤见 [Android Studio 指南](docs/ANDROID_STUDIO.md)。

## 团队协作

- [协作指南](CONTRIBUTING.md)：分支 → Pull Request → CI → 审查 → 合并。
- [权限和分支规则](docs/DEVELOPMENT.md#github-协作权限)：受邀开发者获得 Write 权限。
- [Issues](https://github.com/MathildaStacy/NovelCreationPartner/issues)：报告问题与规划需求。
- [Actions](https://github.com/MathildaStacy/NovelCreationPartner/actions)：质量检查、Android debug APK 和 iOS 模拟器编译，不包含商店发布。

公开仓库允许所有人阅读、克隆和通过 Fork 提交 PR；直接推送开发分支需要协作者权限。采用 [GNU GPL v3.0](LICENSE)（`GPL-3.0-only`）。

Copyright (c) 2026 MathildaStacy。项目代码的修改与分发须遵守 GPL v3.0；第三方依赖仍遵循各自许可证。
