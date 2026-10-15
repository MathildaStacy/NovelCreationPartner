# 技术架构设计文档

## 1. 总体架构

NovelCreationPartner 采用前后端分离的架构设计，移动端通过 API 与后端服务通信。

```
┌─────────────────────────────────────────────────────────────┐
│                     移动端 (React Native)                    │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────┐ │
│  │ UI 组件层 │  │ 状态管理  │  │ 业务逻辑  │  │ API 服务 │ │
│  └───────────┘  └───────────┘  └───────────┘  └──────────┘ │
└───────────────────────────────┬─────────────────────────────┘
                                │ REST/WebSocket
┌───────────────────────────────┴─────────────────────────────┐
│                    后端服务集群                              │
│  ┌──────────────────┐    ┌─────────────────────────────┐   │
│  │ Java 业务后端     │    │ Python Agent 编排服务        │   │
│  │ (Spring Boot)    │◄───┤ (LangGraph + LangChain)     │   │
│  └──────────────────┘    └─────────────────────────────┘   │
│         │                           │                        │
│         ▼                           ▼                        │
│  ┌──────────────┐          ┌───────────────┐               │
│  │ PostgreSQL   │          │ 向量数据库     │               │
│  │ (业务数据)    │          │ (RAG 检索)    │               │
│  └──────────────┘          └───────────────┘               │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   LLM API 服务        │
                    │ (OpenAI/Anthropic等)  │
                    └───────────────────────┘
```

## 2. 移动端架构

### 2.1 技术选型

| 层次 | 技术方案 | 说明 |
|------|---------|------|
| 框架 | React Native 0.87.1 | 跨平台开发框架 |
| 语言 | TypeScript | 类型安全 |
| 状态管理 | Redux Toolkit / Zustand | 待选型，建议 Zustand（更轻量） |
| UI 组件 | React Native Paper | Material Design 风格 |
| 导航 | React Navigation | 官方推荐导航库 |
| 网络请求 | Axios | HTTP 客户端 |
| 本地存储 | AsyncStorage / MMKV | 轻量级数据存储 |
| 实时通信 | Socket.io-client | WebSocket 连接 |
| 富文本编辑 | @react-native-community/editor | 待选型 |

### 2.2 目录结构设计

```
src/
├── components/              # 可复用 UI 组件
│   ├── common/             # 通用组件（按钮、输入框等）
│   ├── editor/             # 编辑器相关组件
│   ├── character/          # 人物管理组件
│   └── worldview/          # 世界观管理组件
├── screens/                # 页面组件
│   ├── home/               # 首页
│   ├── project/            # 项目管理
│   ├── editor/             # 编辑器页面
│   ├── character/          # 人物页面
│   ├── worldview/          # 世界观页面
│   └── settings/           # 设置页面
├── navigation/             # 导航配置
│   ├── RootNavigator.tsx   # 根导航器
│   ├── MainTabNavigator.tsx # 主 Tab 导航
│   └── types.ts            # 导航类型定义
├── services/               # API 服务
│   ├── api/                # API 调用封装
│   │   ├── project.ts      # 项目相关 API
│   │   ├── character.ts    # 人物相关 API
│   │   ├── generation.ts   # 生成相关 API
│   │   └── memory.ts       # 记忆相关 API
│   ├── websocket/          # WebSocket 服务
│   └── storage/            # 本地存储服务
├── store/                  # 状态管理
│   ├── slices/             # Redux slices / Zustand stores
│   │   ├── project.ts      # 项目状态
│   │   ├── character.ts    # 人物状态
│   │   ├── editor.ts       # 编辑器状态
│   │   └── user.ts         # 用户状态
│   └── index.ts            # Store 配置
├── hooks/                  # 自定义 Hooks
│   ├── useProject.ts       # 项目相关逻辑
│   ├── useGeneration.ts    # 生成相关逻辑
│   └── useMemory.ts        # 记忆相关逻辑
├── utils/                  # 工具函数
│   ├── validation.ts       # 数据验证
│   ├── formatting.ts       # 格式化工具
│   └── datetime.ts         # 日期时间处理
├── types/                  # TypeScript 类型定义
│   ├── project.ts          # 项目类型
│   ├── character.ts        # 人物类型
│   ├── worldview.ts        # 世界观类型
│   └── api.ts              # API 类型
├── constants/              # 常量
│   ├── config.ts           # 配置常量
│   ├── colors.ts           # 颜色常量
│   └── routes.ts           # 路由常量
├── locales/                # 国际化
│   ├── zh-CN.json          # 简体中文
│   └── en-US.json          # 英文
└── assets/                 # 静态资源
    ├── images/             # 图片
    ├── fonts/              # 字体
    └── animations/         # 动画文件
```

### 2.3 核心模块设计

#### 2.3.1 编辑器模块

```typescript
// 编辑器状态接口
interface EditorState {
  currentChapter: Chapter | null;
  content: string;
  selectedText: {
    start: number;
    end: number;
    text: string;
  } | null;
  suggestions: Suggestion[];
  isGenerating: boolean;
}

// 编辑器操作
interface EditorActions {
  loadChapter(chapterId: string): Promise<void>;
  saveChapter(): Promise<void>;
  selectText(start: number, end: number): void;
  generateDescription(type: DescriptionType): Promise<void>;
  acceptSuggestion(suggestion: Suggestion): void;
}
```

#### 2.3.2 记忆管理模块

```typescript
// 记忆状态枚举
enum MemoryState {
  PROPOSED = 'proposed',      // AI 提议
  CONFIRMED = 'confirmed',    // 作者确认
  ESTABLISHED = 'established', // 正文已建立
  CONFLICTED = 'conflicted',  // 存在冲突
  RETIRED = 'retired'         // 已废弃
}

// 记忆变更提案
interface MemoryChangeProposal {
  id: string;
  type: 'add' | 'update' | 'delete';
  target: Memory;
  reason: string;
  source: {
    chapterId: string;
    excerpt: string;
  };
  conflicts: Conflict[];
}
```

## 3. 后端架构

### 3.1 Java 业务后端

#### 技术栈
- Spring Boot 3.x
- Spring Data JPA
- Spring Security (JWT)
- PostgreSQL
- Redis (缓存)

#### 职责
- 用户认证与授权
- 项目、章节 CRUD
- 人物、世界观数据管理
- 版本控制与历史记录
- 权限管理与协作

#### 核心 API 设计

```
POST   /api/auth/login              # 用户登录
POST   /api/auth/register           # 用户注册

GET    /api/projects                # 项目列表
POST   /api/projects                # 创建项目
GET    /api/projects/:id            # 项目详情
PUT    /api/projects/:id            # 更新项目
DELETE /api/projects/:id            # 删除项目

GET    /api/projects/:id/chapters   # 章节列表
POST   /api/projects/:id/chapters   # 创建章节
GET    /api/chapters/:id            # 章节详情
PUT    /api/chapters/:id            # 更新章节
DELETE /api/chapters/:id            # 删除章节

GET    /api/projects/:id/characters # 人物列表
POST   /api/projects/:id/characters # 创建人物
PUT    /api/characters/:id          # 更新人物

GET    /api/projects/:id/worldview  # 世界观数据
PUT    /api/projects/:id/worldview  # 更新世界观

GET    /api/memory/changes/pending  # 待审核变更
POST   /api/memory/changes/approve  # 批准变更
POST   /api/memory/changes/reject   # 拒绝变更
```

### 3.2 Python Agent 编排服务

#### 技术栈
- FastAPI
- LangChain
- LangGraph
- PostgreSQL (共享数据库)
- pgvector (向量检索)

#### 职责
- AI 任务路由与编排
- LLM 调用与流式响应
- RAG 检索与上下文组装
- 工作流状态管理
- 记忆提取与冲突检测

#### 核心 Agent 工作流

```python
# 创意孵化工作流
ideation_workflow = StateGraph()
ideation_workflow.add_node("extract_info", extract_initial_info)
ideation_workflow.add_node("identify_gaps", identify_missing_info)
ideation_workflow.add_node("generate_questions", generate_clarifying_questions)
ideation_workflow.add_node("generate_options", generate_creative_options)

# 描写辅助工作流
description_workflow = StateGraph()
description_workflow.add_node("retrieve_context", retrieve_scene_context)
description_workflow.add_node("generate_candidates", generate_descriptions)
description_workflow.add_node("validate_scope", validate_generation_scope)

# 记忆更新工作流
memory_workflow = StateGraph()
memory_workflow.add_node("extract_facts", extract_story_facts)
memory_workflow.add_node("detect_conflicts", detect_setting_conflicts)
memory_workflow.add_node("generate_proposal", generate_change_proposal)
```

#### API 设计

```
POST /api/agent/ideation          # 创意孵化
POST /api/agent/description       # 描写生成
POST /api/agent/plot-suggestion   # 情节建议
POST /api/agent/memory-update     # 记忆更新
POST /api/agent/conflict-check    # 冲突检测

WebSocket /ws/generation          # 流式生成连接
```

## 4. 数据模型设计

### 4.1 核心实体

```sql
-- 项目表
CREATE TABLE projects (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    genre VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 章节表
CREATE TABLE chapters (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    title VARCHAR(200),
    content TEXT,
    order_index INT NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 人物表
CREATE TABLE characters (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    appearance JSONB,
    personality JSONB,
    background TEXT,
    goals JSONB,
    abilities JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 世界观设定表
CREATE TABLE worldview_settings (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    category VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    rules JSONB,
    state VARCHAR(20) DEFAULT 'proposed',
    source VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 故事事实表
CREATE TABLE story_facts (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    chapter_id UUID,
    fact_type VARCHAR(50) NOT NULL,
    content JSONB NOT NULL,
    effective_from INT,  -- 生效章节序号
    effective_to INT,    -- 失效章节序号
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);

-- 记忆变更提案表
CREATE TABLE memory_change_proposals (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    change_type VARCHAR(20) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id UUID,
    content JSONB NOT NULL,
    reason TEXT,
    source_chapter_id UUID,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (source_chapter_id) REFERENCES chapters(id)
);
```

### 4.2 向量存储设计

```sql
-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 章节内容向量表
CREATE TABLE chapter_embeddings (
    id UUID PRIMARY KEY,
    chapter_id UUID NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_index INT NOT NULL,
    embedding vector(1536),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);

-- 向量索引
CREATE INDEX ON chapter_embeddings USING ivfflat (embedding vector_cosine_ops);

-- 参考资料向量表
CREATE TABLE reference_embeddings (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    source_name VARCHAR(200),
    content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX ON reference_embeddings USING ivfflat (embedding vector_cosine_ops);
```

## 5. 关键技术决策

### 5.1 为什么选择 React Native？

1. **开发效率**: 一套代码同时支持 iOS 和 Android
2. **生态成熟**: npm 包丰富，社区活跃
3. **热更新**: 支持 CodePush 等热更新方案
4. **性能足够**: 文本编辑和 UI 交互不需要原生级性能
5. **团队技能**: JavaScript/TypeScript 技能可复用到 Web 端

### 5.2 为什么采用前后端分离？

1. **职责清晰**: 移动端专注 UI/UX，后端专注业务逻辑
2. **可扩展性**: 后续可支持 Web 端、桌面端
3. **技术独立**: 前后端可独立迭代和部署
4. **专业分工**: Java 后端 + Python AI 服务发挥各自优势

### 5.3 为什么使用 LangGraph？

1. **工作流可视化**: 状态图清晰表达业务流程
2. **检查点机制**: 支持长流程的中断恢复
3. **状态管理**: 内置状态持久化能力
4. **调试友好**: 可追踪每一步的输入输出

### 5.4 为什么选择 PostgreSQL + pgvector？

1. **统一数据库**: 业务数据和向量数据在同一系统
2. **ACID 保证**: 关键业务数据需要事务保证
3. **成熟稳定**: 经过生产环境广泛验证
4. **向量检索**: pgvector 插件提供向量相似度搜索

## 6. 部署架构

### 6.1 开发环境

```
本地开发:
- 移动端: React Native Metro Server
- Java 后端: Spring Boot DevTools
- Python 服务: uvicorn --reload
- 数据库: Docker Compose (PostgreSQL + Redis)
```

### 6.2 生产环境（建议）

```
云服务架构:
┌──────────────────────────────────────────────┐
│ CDN / 静态资源 (App Bundle)                   │
└──────────────────────────────────────────────┘
                    │
┌───────────────────┴──────────────────────────┐
│ Load Balancer / API Gateway                  │
└──────┬──────────────────────────────┬────────┘
       │                              │
┌──────┴──────┐              ┌────────┴─────────┐
│ Java 服务集群│              │ Python 服务集群   │
│ (Kubernetes)│              │ (Kubernetes)     │
└──────┬──────┘              └────────┬─────────┘
       │                              │
┌──────┴──────────────────────────────┴────────┐
│ 数据层                                        │
│ - PostgreSQL (主从复制)                       │
│ - Redis (缓存 + 消息队列)                     │
│ - 对象存储 (用户上传文件)                      │
└──────────────────────────────────────────────┘
```

## 7. 性能优化策略

### 7.1 移动端优化

- 列表虚拟化（FlatList）
- 图片懒加载与缓存
- 代码分割与按需加载
- 状态管理优化（避免不必要的重渲染）
- 离线优先策略

### 7.2 后端优化

- 数据库索引优化
- Redis 缓存热点数据
- API 响应分页
- 长内容流式传输
- LLM 调用并发控制

### 7.3 AI 服务优化

- Prompt 缓存（Claude Prompt Caching）
- 结果缓存（相似查询）
- 向量检索索引优化
- 批量嵌入生成
- 模型选择（任务难度匹配）

## 8. 安全考虑

1. **身份认证**: JWT + Refresh Token
2. **API 鉴权**: 基于角色的访问控制（RBAC）
3. **数据加密**: HTTPS + 数据库字段加密
4. **输入验证**: 前后端双重验证
5. **Rate Limiting**: API 调用频率限制
6. **敏感信息**: 环境变量管理，不提交密钥

## 9. 监控与日志

1. **应用监控**: Sentry / Firebase Crashlytics
2. **性能监控**: 移动端启动时间、API 响应时间
3. **日志系统**: ELK Stack 或云日志服务
4. **埋点分析**: 用户行为统计
5. **告警机制**: 异常自动通知

## 10. 下一步工作

### 立即开始（Sprint 1）
- [ ] 搭建基础 UI 框架
- [ ] 实现用户认证流程
- [ ] 创建项目管理页面
- [ ] 建立 API 通信层

### 近期计划（Sprint 2-3）
- [ ] 实现章节编辑器
- [ ] 集成第一个 AI 功能（创意引导）
- [ ] 实现人物档案管理
- [ ] 搭建 Python Agent 服务原型

---

**文档版本**: 1.0  
**最后更新**: 2026-10-15  
**维护者**: MathildaStacy
