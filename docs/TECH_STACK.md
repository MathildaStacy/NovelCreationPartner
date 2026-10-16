# 技术栈选型文档

> **文档版本**: 1.0  
> **最后更新**: 2026-10-16  
> **状态**: ✅ 已确定

## 前端技术栈

### 核心框架

| 技术 | 版本 | 用途 | 选型理由 |
|------|------|------|---------|
| React Native | 0.87.1 | 移动端框架 | 跨平台、生态成熟、团队技能匹配 |
| TypeScript | ^6.0.3 | 开发语言 | 类型安全、提升代码质量 |
| React | 19.2.3 | UI库 | React Native依赖 |

### 状态管理

**Zustand** `^5.0.2`

**选型理由**：
- 轻量简洁，学习曲线平缓（比Redux简单80%）
- TypeScript支持完善
- 性能优秀，无需Provider嵌套
- 支持中间件（persist、devtools）
- 适合中小型项目，后期扩展性好

**替代方案对比**：
- ❌ Redux Toolkit: 样板代码多，学习成本高
- ❌ Context API: 性能问题，复杂状态管理能力弱
- ✅ Jotai: 备选方案，原子化状态，但生态不如Zustand

### UI组件库

**@gluestack-ui/themed** `^1.1.60`

**选型理由**：
- 现代化设计系统，开箱即用
- 完整的组件覆盖（40+组件）
- 支持深色模式
- TypeScript原生支持
- 高度可定制，基于unstyled组件
- 性能优秀，按需加载
- 文档完善，社区活跃

**包含组件**：
Button, Input, Text, Box, VStack, HStack, Card, Modal, Toast, Select, Checkbox, Radio, Switch, Slider, Avatar, Badge, Divider, Spinner等

### 导航

**React Navigation** `^7.0.0`

**选型理由**：
- React Native官方推荐
- 生态最成熟，社区最大
- TypeScript类型安全支持
- 支持所有导航模式（Stack、Tab、Drawer）
- 深度链接、状态持久化支持

**安装包**：
- `@react-navigation/native`
- `@react-navigation/bottom-tabs` (底部Tab)
- `@react-navigation/native-stack` (页面栈)
- `react-native-screens`
- `react-native-safe-area-context` (已安装)

### 表单处理

**react-hook-form** `^7.53.0`

**选型理由**：
- 性能最优，减少不必要的重渲染
- API简洁直观
- TypeScript类型推导完善
- 验证规则灵活（支持yup、zod等）
- 文件体积小（~45KB）

**配套验证库**：
- **zod** `^3.23.8` (TypeScript优先的schema验证)

### 数据请求与状态

**axios** `^1.7.7` + **@tanstack/react-query** `^5.59.0`

**选型理由**：
- **axios**: 成熟稳定的HTTP客户端，拦截器支持
- **react-query**: 
  - 自动缓存、后台同步
  - Loading/Error状态管理
  - 自动重试、轮询
  - 离线支持
  - DevTools完善

### 本地存储

**@react-native-async-storage/async-storage** `^2.1.0`

**用途**: 简单数据存储（用户设置、token等）

**react-native-mmkv** `^3.1.0`

**用途**: 高性能场景（章节内容、草稿等大数据）

**选型理由**：
- AsyncStorage: 官方维护，简单场景足够
- MMKV: 性能是AsyncStorage的30倍，适合频繁读写

### 日期处理

**date-fns** `^4.1.0`

**选型理由**：
- 轻量，按需引入（模块化）
- 中文locale支持完善
- TypeScript原生支持
- 比moment.js更轻（~70KB vs ~230KB）
- 函数式API，tree-shaking友好

### 工具函数

**lodash** `^4.17.21`

**选型理由**：
- 成熟稳定的工具函数库
- 按需引入（使用babel-plugin-lodash）
- 减少重复造轮子

### 图标库

**@expo/vector-icons** `^14.0.4`

**选型理由**：
- 包含多个图标集（MaterialIcons, Ionicons, FontAwesome等）
- React Native兼容性好
- 使用简单，按需加载

### 开发工具

| 工具 | 版本 | 用途 |
|------|------|------|
| ESLint | ^8.19.0 | 代码检查 |
| Prettier | 2.8.8 | 代码格式化 |
| Jest | ^29.6.3 | 单元测试 |
| @testing-library/react-native | ^12.7.2 | 组件测试 |

## 后端技术栈（规划）

### 业务后端

| 技术 | 版本 | 用途 |
|------|------|------|
| Java | 17 | 后端语言 |
| Spring Boot | 3.2+ | 业务框架 |
| PostgreSQL | 15+ | 关系型数据库 |
| Redis | 7+ | 缓存 |

### AI服务

| 技术 | 版本 | 用途 |
|------|------|------|
| Python | 3.11+ | AI服务语言 |
| FastAPI | 0.115+ | Web框架 |
| LangChain | 0.3+ | LLM编排 |
| LangGraph | 0.2+ | Agent工作流 |
| pgvector | - | 向量检索 |

## 项目目录结构

```
src/
├── components/              # UI组件
│   ├── common/             # 通用组件
│   │   ├── AppButton.tsx
│   │   ├── AppInput.tsx
│   │   ├── AppCard.tsx
│   │   └── Loading.tsx
│   ├── project/            # 项目相关组件
│   ├── chapter/            # 章节相关组件
│   └── character/          # 人物相关组件
│
├── screens/                # 页面
│   ├── home/
│   │   └── HomeScreen.tsx
│   ├── project/
│   │   ├── ProjectListScreen.tsx
│   │   ├── ProjectDetailScreen.tsx
│   │   └── CreateProjectScreen.tsx
│   ├── chapter/
│   │   ├── ChapterListScreen.tsx
│   │   └── ChapterEditorScreen.tsx
│   ├── character/
│   │   └── CharacterListScreen.tsx
│   └── settings/
│       └── SettingsScreen.tsx
│
├── navigation/             # 导航配置
│   ├── RootNavigator.tsx
│   ├── MainTabNavigator.tsx
│   └── types.ts
│
├── store/                  # Zustand状态管理
│   ├── projectStore.ts
│   ├── chapterStore.ts
│   ├── characterStore.ts
│   └── userStore.ts
│
├── services/               # 服务层
│   ├── api/               # API调用
│   │   ├── client.ts      # axios配置
│   │   ├── project.ts
│   │   ├── chapter.ts
│   │   └── character.ts
│   └── storage/           # 本地存储
│       ├── asyncStorage.ts
│       └── mmkv.ts
│
├── hooks/                  # 自定义Hooks
│   ├── useProject.ts
│   ├── useChapter.ts
│   └── useCharacter.ts
│
├── types/                  # TypeScript类型
│   ├── project.ts
│   ├── chapter.ts
│   ├── character.ts
│   └── api.ts
│
├── utils/                  # 工具函数
│   ├── validation.ts
│   ├── format.ts
│   └── date.ts
│
├── constants/              # 常量
│   ├── theme.ts           # 主题配置
│   ├── colors.ts          # 颜色
│   └── routes.ts          # 路由名称
│
├── mock/                   # Mock数据
│   └── data.ts
│
└── assets/                 # 静态资源
    ├── images/
    └── fonts/
```

## 开发阶段

### Phase 1: 基础框架 (当前)
- ✅ 技术选型确定
- 🔲 依赖安装
- 🔲 项目结构搭建
- 🔲 主题配置
- 🔲 导航框架

### Phase 2: UI界面开发
- 🔲 通用组件封装
- 🔲 项目列表页
- 🔲 创建项目页
- 🔲 章节管理页
- 🔲 编辑器页面

### Phase 3: 数据层
- 🔲 Mock数据
- 🔲 API接口定义
- 🔲 状态管理集成
- 🔲 本地存储

### Phase 4: 后端对接
- 🔲 真实API集成
- 🔲 认证授权
- 🔲 数据同步

## 依赖安装命令

```bash
# UI组件库
npm install @gluestack-ui/themed @gluestack-style/react react-native-svg

# 状态管理
npm install zustand

# 导航
npm install @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs
npm install react-native-screens react-native-gesture-handler

# 表单
npm install react-hook-form zod @hookform/resolvers

# 数据请求
npm install axios @tanstack/react-query

# 本地存储
npm install @react-native-async-storage/async-storage react-native-mmkv

# 工具库
npm install date-fns lodash
npm install --save-dev @types/lodash

# 图标
npm install @expo/vector-icons

# 测试
npm install --save-dev @testing-library/react-native @testing-library/jest-native
```

## 注意事项

1. **iOS额外配置**: 安装新依赖后需要执行 `cd ios && pod install`
2. **版本锁定**: 使用 `npm ci` 而不是 `npm install` 确保版本一致
3. **清理缓存**: 遇到问题时运行 `npm start -- --reset-cache`
4. **TypeScript严格模式**: 保持 `tsconfig.json` 的 `strict: true`

## 参考文档

- [React Native官方文档](https://reactnative.dev/)
- [Zustand文档](https://zustand-demo.pmnd.rs/)
- [gluestack-ui文档](https://gluestack.io/)
- [React Navigation文档](https://reactnavigation.org/)
- [react-hook-form文档](https://react-hook-form.com/)
- [TanStack Query文档](https://tanstack.com/query/latest)

---

**维护者**: 开发团队  
**审批状态**: ✅ 已通过
