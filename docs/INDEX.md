# 文档索引

NovelCreationPartner项目的完整文档导航。

---

## 🚀 快速开始

新开发者推荐阅读顺序：

1. [README](../README.md) - 项目概述
2. [快速上手指南](./QUICK_START.md) - 环境搭建和开发入门
3. [产品说明](./PRODUCT_BRIEF.md) - 了解产品定位和目标
4. [项目看板](./KANBAN.md) - 查看当前任务和进度

---

## 📖 产品文档

### 核心文档

| 文档 | 内容 | 更新时间 |
|------|------|----------|
| [产品说明](./PRODUCT_BRIEF.md) | 产品定位、目标用户、核心功能、需求来源 | 项目初期 |
| [产品设计](./PRODUCT_DESIGN.md) | 页面流程、AI模型服务、记忆状态、MVP范围 | 项目初期 |
| [UI设计规范](./UI_DESIGN.md) | 设计令牌、组件规范、页面布局 | 项目初期 |
| [界面原型](./design/prototype.html) | 16个画面的交互原型（浏览器打开） | 项目初期 |

### 规划文档

| 文档 | 内容 | 更新时间 |
|------|------|----------|
| [项目看板](./KANBAN.md) | 任务追踪、Sprint规划、进度指标 | 2026-10-16 |
| [产品规划](../README_CN.md) | 功能模块与路线图 | 项目初期 |

---

## 🏗️ 技术文档

### 架构与设计

| 文档 | 内容 | 更新时间 |
|------|------|----------|
| [架构设计](../ARCHITECTURE.md) | 本地优先架构、数据模型、模型适配层 | 项目初期 |
| [技术栈选型](./TECH_STACK.md) | 前端技术栈选型理由（Zustand/Navigation/gluestack-ui） | 2026-10-16 |
| [开发进度](./DEVELOPMENT_PROGRESS.md) | 已完成功能、待开发功能、技术债务 | 2026-10-16 |

### 开发指南

| 文档 | 内容 | 更新时间 |
|------|------|----------|
| [快速上手](./QUICK_START.md) | 环境搭建、常用命令、开发工作流 | 2026-10-16 |
| [开发环境指南](./DEVELOPMENT.md) | 完整的开发环境配置步骤 | 项目初期 |
| [协作指南](../CONTRIBUTING.md) | 分支策略、PR流程、代码规范 | 项目初期 |

### 开发记录

| 文档 | 内容 | 更新时间 |
|------|------|----------|
| [开发日志](./DEV_LOG.md) | 每日开发记录、技术决策、问题解决 | 2026-10-16 |
| [阶段一总结](./PHASE1_SUMMARY.md) | 基础架构搭建完成总结 | 2026-10-16 |

---

## 👥 团队协作

| 资源 | 内容 |
|------|------|
| [协作指南](../CONTRIBUTING.md) | Git工作流、代码审查、提交规范 |
| [GitHub Issues](https://github.com/MathildaStacy/NovelCreationPartner/issues) | Bug报告、功能需求、问题讨论 |
| [GitHub Actions](https://github.com/MathildaStacy/NovelCreationPartner/actions) | CI/CD状态、构建产物 |
| [Pull Requests](https://github.com/MathildaStacy/NovelCreationPartner/pulls) | 代码审查和合并 |

---

## 📂 代码结构

### 关键目录

```
NovelCreationPartner/
├── src/
│   ├── constants/          # 全局常量
│   │   ├── colors.ts      # 色彩系统
│   │   ├── theme.ts       # 主题配置
│   │   └── routes.ts      # 路由常量
│   ├── types/             # TypeScript类型
│   │   ├── project.ts     # 项目类型
│   │   ├── chapter.ts     # 章节类型
│   │   └── character.ts   # 人物类型
│   ├── store/             # Zustand状态
│   │   └── projectStore.ts # 项目状态
│   ├── navigation/        # 导航配置
│   │   ├── RootNavigator.tsx
│   │   └── MainTabNavigator.tsx
│   ├── screens/           # 页面组件
│   │   ├── home/         # 首页
│   │   ├── project/      # 项目管理
│   │   └── settings/     # 设置
│   └── mock/             # 测试数据
└── docs/                  # 项目文档
```

### 关键文件说明

| 文件 | 作用 |
|------|------|
| `src/constants/colors.ts` | 深色主题色彩系统定义 |
| `src/constants/theme.ts` | 间距、圆角、阴影等设计令牌 |
| `src/store/projectStore.ts` | 项目状态管理（CRUD操作） |
| `src/navigation/RootNavigator.tsx` | 根导航配置（Stack） |
| `src/navigation/MainTabNavigator.tsx` | 底部Tab导航 |

---

## 🎨 设计资源

### 设计系统

- **色彩系统**：[colors.ts](../src/constants/colors.ts)
  - 5层渐进式深色背景
  - 青色主色调
  - 完整的语义化颜色

- **主题配置**：[theme.ts](../src/constants/theme.ts)
  - 8档间距系统（基于4px）
  - 6种圆角尺寸
  - 3层阴影效果

- **UI设计规范**：[UI_DESIGN.md](./UI_DESIGN.md)
  - 组件规范
  - 布局原则
  - 交互模式

### 原型和样机

- [界面原型](./design/prototype.html) - 16个交互画面

---

## 🔧 开发工具

### 常用命令

```bash
# 开发
npm start              # 启动Metro
npm run android        # 运行Android
npm run ios            # 运行iOS

# 代码质量
npm run lint           # ESLint检查
npm run typecheck      # TypeScript检查
npm run format         # 代码格式化
npm run check          # 运行所有检查

# 清理
npm run clean          # 清理缓存
npm run doctor         # 检查开发环境
```

### 工具链

- **包管理**：npm
- **代码检查**：ESLint
- **类型检查**：TypeScript
- **代码格式化**：Prettier
- **版本控制**：Git
- **CI/CD**：GitHub Actions

---

## 📊 项目状态

### 当前进度

- **阶段**：Sprint 1 - 基础架构搭建
- **完成率**：89%
- **下一个里程碑**：数据持久化实现

### 技术栈

**前端（已实现）**：
- React Native 0.87.1
- TypeScript
- Zustand（状态管理）
- React Navigation 7.x
- gluestack-ui

**后端（规划中）**：
- Java + Spring Boot
- Python + LangGraph
- PostgreSQL + pgvector

### 质量指标

- **ESLint通过率**：100%
- **TypeScript覆盖**：100%
- **已知Bug**：0
- **测试覆盖率**：0%（待建立）

---

## 🐛 问题反馈

遇到问题？

1. 查看[常见问题](./QUICK_START.md#常见问题)
2. 搜索[已有Issues](https://github.com/MathildaStacy/NovelCreationPartner/issues)
3. 创建新Issue并提供详细信息

---

## 📝 文档贡献

### 文档编写规范

1. **使用Markdown**：所有文档使用.md格式
2. **清晰的标题层级**：合理使用#、##、###
3. **代码示例**：使用代码块并指定语言
4. **及时更新**：功能变更后同步更新文档
5. **中文为主**：文档以中文为主，代码注释可用英文

### 需要更新文档的时机

- 添加新功能
- 修改现有功能
- 发现文档错误
- 技术栈变更
- 架构调整

---

## 📅 更新历史

| 日期 | 变更内容 |
|------|----------|
| 2026-10-16 | 创建文档索引；完成基础架构文档 |

---

## 🔗 外部资源

### 官方文档

- [React Native](https://reactnative.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [React Navigation](https://reactnavigation.org/)
- [Zustand](https://zustand-demo.pmnd.rs/)
- [gluestack-ui](https://gluestack.io/)

### 参考资料

- [React Native最佳实践](https://github.com/jondot/awesome-react-native)
- [TypeScript风格指南](https://github.com/microsoft/TypeScript/wiki/Coding-guidelines)
- [Git提交信息规范](https://www.conventionalcommits.org/)

---

**文档维护负责人**：开发团队  
**最后更新**：2026-10-16
