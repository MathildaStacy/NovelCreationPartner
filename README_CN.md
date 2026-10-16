# AI 小说创作伙伴 (NovelCreationPartner)

一款面向小说创作新手的 AI 创作助手移动应用，帮助用户将零散创意发展为可持续创作的完整故事。

## 📖 项目简介

本项目是一个跨平台移动应用（Android & iOS），旨在为小说创作新手提供系统化的创作辅助。通过 AI 技术帮助用户：

- 🎯 将模糊创意发展为完整的世界观和人物设定
- 📝 提供环境、心理、外貌等局部描写辅助
- 🧠 维护故事记忆，确保长篇创作的一致性
- 📚 基于参考资料提供有依据的情节建议
- ✅ 检测设定冲突，避免前后矛盾

**核心理念**：AI 是创作顾问而非代笔工具，作者保留最终决定权。

完整需求见[产品说明文档](docs/PRODUCT_BRIEF.md)。页面与交互见[产品设计文档](docs/PRODUCT_DESIGN.md)，视觉规范见 [UI 设计规范](docs/UI_DESIGN.md)，界面原型见 [docs/design/prototype.html](docs/design/prototype.html)（下载后用浏览器打开）。

V1 采用本地优先方案：不需要注册账号，作品保存在手机本地；用户填写自己的模型服务地址和 API Key，支持 OpenAI Responses API 与 Anthropic Messages API 两种协议，Key 只保存在系统钥匙串中。

## 🛠️ 技术栈

- **框架**: React Native 0.87.1
- **语言**: TypeScript
- **包管理**: npm
- **本地数据**: SQLite（建议 op-sqlite）+ 系统安全存储（Keychain / Keystore）
- **状态管理**: Zustand（建议）
- **AI 接入**: App 直连用户配置的 OpenAI Responses / Anthropic Messages 服务，不使用官方 SDK
- **后端**: V1 不需要；云同步与服务端工作流（Java + Spring Boot、Python + LangGraph）留待后续评估，详见[架构文档](ARCHITECTURE.md#8-后续演进可选)

## 📁 项目结构

```
NovelCreationPartner/
├── .github/                # CI 工作流、Issue / PR 模板、CODEOWNERS
├── android/                # Android 原生代码
├── ios/                    # iOS 原生代码
├── __tests__/              # 测试文件
├── docs/
│   ├── PRODUCT_BRIEF.md    # 产品说明文档（需求来源）
│   ├── PRODUCT_DESIGN.md   # 产品设计文档（页面、交互、AI 模型服务）
│   ├── UI_DESIGN.md        # UI 设计规范（设计令牌、组件、页面布局）
│   ├── design/
│   │   └── prototype.html  # 界面原型（16 个画面，浏览器直接打开）
│   └── DEVELOPMENT.md      # 开发环境与团队协作指南
├── scripts/                # 环境检查（doctor.cjs）与终端环境脚本（dev-env.sh）
├── App.tsx                 # 应用入口组件
├── index.js                # 应用注册入口
├── package.json            # 项目依赖配置
├── tsconfig.json           # TypeScript 配置
├── babel.config.js         # Babel 配置
├── metro.config.js         # Metro 打包配置
├── ARCHITECTURE.md         # 技术架构设计
├── CONTRIBUTING.md         # 贡献指南
└── README_CN.md            # 中文说明文档（本文件）
```

在 Android Studio 中打开和运行 Android 版本，请阅读 [Android Studio 指南](docs/ANDROID_STUDIO.md)。Android Studio 要打开 `android/` 子目录；项目根目录用于安装 npm 依赖和启动 Metro。

## 🚀 快速开始

### 环境要求

请以[开发环境指南](docs/DEVELOPMENT.md)和仓库配置为准：Node 24、JDK 17、Android SDK 37、Xcode >=16.1、Ruby 3.4、CocoaPods 1.16.2。

### 安装步骤

1. **克隆项目**
```bash
git clone https://github.com/MathildaStacy/NovelCreationPartner.git
cd NovelCreationPartner
```

2. **安装依赖**
```bash
npm ci
```

3. **iOS 额外配置**（仅 macOS）
```bash
bundle install
cd ios && bundle exec pod install && cd ..
```

4. **运行项目**

Android:
```bash
npm run android
# 或
npx react-native run-android
```

iOS:
```bash
npm run ios
# 或
npx react-native run-ios
```

### 常用命令

```bash
# 启动 Metro 打包服务器
npm start

# 运行 Android 应用
npm run android

# 运行 iOS 应用（仅 macOS）
npm run ios

# 代码检查
npm run lint

# 运行测试
npm test

# 提交前完整检查（lint + 类型检查 + 测试）
npm run check
```

## 🎯 核心功能模块（规划中）

### 1. 创意孵化与需求澄清
- 零散创意输入与结构化
- 智能提问引导完善设定
- 多方案候选与影响分析

### 2. 世界观与设定管理
- 世界规则、地理、势力管理
- 设定关联与冲突检测
- 版本记录与追溯

### 3. 人物与关系管理
- 人物档案（外貌、性格、目标）
- 关系图谱与状态变化
- 行为一致性检查

### 4. 剧情规划与情节建议
- 梗概、卷纲、章节大纲
- 冲突、转折、伏笔管理
- 基于设定的合理性检查

### 5. 资料研究与参考案例
- 参考资料检索与分析
- 叙事机制提炼
- 原创方案生成

### 6. 局部描写辅助
- 环境、心理、动作描写生成
- 多风格候选文本
- 选中文本的改写/扩写

### 7. 故事记忆与一致性检查
- 设定、事实、时间线维护
- 自动冲突检测
- 变更审核与追溯

## 📋 开发计划

### MVP（最小可行产品）范围

以[产品设计文档第 10 节](docs/PRODUCT_DESIGN.md#10-mvp-范围修订)为准，摘要如下：

| 优先级 | 功能 | 状态 |
|--------|------|------|
| P0 | 书架、作品与章节管理、章节编辑器 | 🔲 待开发 |
| P0 | 模型服务配置（OpenAI Responses / Anthropic Messages） | 🔲 待开发 |
| P0 | AI 伙伴创意引导 | 🔲 待开发 |
| P0 | 故事档案（人物、世界观、地点、势力、规则） | 🔲 待开发 |
| P0 | 描写助手（局部描写、改写、扩写） | 🔲 待开发 |
| P0 | 定稿、章节摘要与记忆审核 | 🔲 待开发 |
| P0 | 基础冲突检测 | 🔲 待开发 |
| P0 | 备份与导出 | 🔲 待开发 |
| P1 | 伏笔管理、卷纲与章节大纲、参考资料 | 🔲 待开发 |
| P2 | 账号与云同步、后端工作流、多 Agent | 🔲 待评估 |

### 实施路线

开发里程碑 0.1–0.6 见[架构文档第 10 节](ARCHITECTURE.md#10-开发里程碑建议)。

1. **阶段 1：原型**（当前）
   - ✅ 项目搭建
   - ✅ 产品设计、UI 设计与界面原型
   - 🔲 基础 UI 框架与本地数据层
   - 🔲 模型服务接入与创意引导原型

2. **阶段 2：记忆闭环**
   - 🔲 章节管理
   - 🔲 事件提取
   - 🔲 变更审核

3. **阶段 3：检索增强**
   - 🔲 资料导入
   - 🔲 语义检索
   - 🔲 来源展示

4. **阶段 4：工作流与评估**
   - 🔲 LangGraph 集成
   - 🔲 质量评估体系

5. **阶段 5：扩展协作**（按真实使用效果引入）
   - 🔲 剧情审查
   - 🔲 伏笔管理
   - 🔲 专业 Agent（按需）

## 🤝 贡献指南

我们欢迎所有形式的贡献！受邀协作者直接在本仓库创建分支，外部贡献者请先 Fork。详细流程见 [CONTRIBUTING.md](CONTRIBUTING.md) 与[开发环境指南](docs/DEVELOPMENT.md)。

1. 从 `main` 创建特性分支 (`git switch -c feature/your-feature`)
2. 提交前运行 `npm run check`
3. 按提交信息规范提交 (`git commit -m "feat: 简要说明"`)
4. 推送分支 (`git push -u origin feature/your-feature`)
5. 开启 Pull Request，等待 CI 通过和代码审查

### 代码规范

- 遵循项目的 ESLint 配置
- 使用 TypeScript 进行类型标注
- 提交前运行 `npm run check`（lint + 类型检查 + 测试）确保代码质量
- 为新功能编写测试用例

### 提交信息规范

采用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

类型（type）：
- `feat`: 新功能
- `fix`: 修复 Bug
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建或辅助工具变动

示例：
```
feat(editor): 添加章节自动保存功能
fix(memory): 修复设定冲突检测误报问题
docs(readme): 更新安装步骤说明
```

## 📄 许可证

本项目采用 GNU GPL v3.0（`GPL-3.0-only`），详见 [LICENSE](LICENSE)。

Copyright (c) 2026 MathildaStacy。项目代码的修改与分发须遵守 GPL v3.0；第三方依赖仍遵循各自许可证。

## 📞 联系方式

- 项目仓库: [https://github.com/MathildaStacy/NovelCreationPartner](https://github.com/MathildaStacy/NovelCreationPartner)
- Issue Tracker: [GitHub Issues](https://github.com/MathildaStacy/NovelCreationPartner/issues)

## 🙏 致谢

- 感谢所有为本项目做出贡献的开发者
- 产品设计灵感来源于广大网络小说创作者的实际需求

---

**开始创作你的故事吧！✨**
