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

完整需求见[产品说明文档](docs/PRODUCT_BRIEF.md)。

## 🛠️ 技术栈

- **框架**: React Native 0.87.1
- **语言**: TypeScript
- **包管理**: npm
- **状态管理**: 待选型（建议 Redux Toolkit 或 Zustand）
- **UI 组件库**: 待选型（候选：React Native Paper、gluestack-ui 等）
- **后端**: 预计使用 Java + Spring Boot（业务后端）+ Python + LangGraph（Agent 编排）

## 📁 项目结构

```
NovelCreationPartner/
├── .github/                # CI 工作流、Issue / PR 模板、CODEOWNERS
├── android/                # Android 原生代码
├── ios/                    # iOS 原生代码
├── __tests__/              # 测试文件
├── docs/
│   ├── PRODUCT_BRIEF.md    # 产品说明文档（需求来源）
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

| 优先级 | 功能 | 状态 |
|--------|------|------|
| P0 | 小说项目与章节管理 | 🔲 待开发 |
| P0 | 创意引导 | 🔲 待开发 |
| P0 | 人物与世界观档案 | 🔲 待开发 |
| P0 | 局部描写辅助 | 🔲 待开发 |
| P0 | 章节摘要与记忆更新 | 🔲 待开发 |
| P0 | 基础一致性检查 | 🔲 待开发 |
| P1 | 参考资料检索 | 🔲 待开发 |
| P1 | 卷纲与章节大纲 | 🔲 待开发 |
| P2 | 复杂多 Agent 协作 | 🔲 待开发 |

### 实施路线

1. **阶段 1：原型**（当前）
   - ✅ 项目搭建
   - 🔲 基础 UI 框架
   - 🔲 创意引导原型

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

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 📞 联系方式

- 项目仓库: [https://github.com/MathildaStacy/NovelCreationPartner](https://github.com/MathildaStacy/NovelCreationPartner)
- Issue Tracker: [GitHub Issues](https://github.com/MathildaStacy/NovelCreationPartner/issues)

## 🙏 致谢

- 感谢所有为本项目做出贡献的开发者
- 产品设计灵感来源于广大网络小说创作者的实际需求

---

**开始创作你的故事吧！✨**
