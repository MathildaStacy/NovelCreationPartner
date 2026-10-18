# 技术架构设计文档

> 版本 1.1（2026-10-16）。V1 改为本地优先、App 直连模型服务。需求来源见[产品说明文档](docs/PRODUCT_BRIEF.md)，功能与交互见[产品设计文档](docs/PRODUCT_DESIGN.md)，界面规范见 [UI 设计规范](docs/UI_DESIGN.md)。本文的库选型为建议，以开发时的验证结果为准。

## 1. 总体架构

V1 没有业务服务器。App 在手机本地保存全部数据，直接调用用户配置的模型服务。

```
┌──────────────────────────── 手机（React Native App）────────────────────────────┐
│                                                                                  │
│  界面层  screens/ + components/        书架、编辑器、AI 伙伴、档案、审核……       │
│     │                                                                            │
│  功能层  features/                     作品、章节、档案、记忆审核、冲突、写作助手 │
│     │                │                                                           │
│     │          AI 任务层 ai/tasks/      创意引导、描写、摘要、记忆提取、冲突检测  │
│     │                │  上下文组装 ai/context/   提示词 ai/prompts/              │
│     │          模型适配层 ai/providers/  统一请求 → Responses / Messages          │
│     │                │  SSE 解析（XHR 增量读取）  错误归一与重试                  │
│     ▼                │                                                           │
│  本地数据层                                                                      │
│   SQLite（作品、章节、版本、档案、审核、对话、服务配置）   FTS5 全文检索           │
│   系统安全存储（API Key：iOS Keychain / Android Keystore）                       │
│   文件（封面图片、导出与备份）                                                    │
└──────────────────────────────────┬───────────────────────────────────────────────┘
                                   │ HTTPS，用户自己的 Base URL + Key
               ┌───────────────────┴───────────────────┐
               ▼                                       ▼
   OpenAI Responses API                     Anthropic Messages API
   （官方或兼容的中转服务）                  （官方或兼容的中转服务）
```

为什么这样做：

1. **上线快、成本低。** 不需要账号系统、服务器和运维，团队精力集中在写作体验和 AI 质量上。
2. **用户数据不经过我们。** 作品只在手机上，Key 只发往用户自己选择的服务商。
3. **不托管 Key。** 服务器保存用户 Key 需要加密、审计和泄露应急，V1 直接避开这类风险。
4. **代价**：暂不支持多设备同步；复杂的 AI 工作流只能在手机上执行。前者靠导出/导入备份缓解，后者在 V1 的任务规模下可以接受（见第 7 节）。

## 2. 移动端技术选型

| 领域 | 建议 | 说明 |
| --- | --- | --- |
| 框架 | React Native 0.87.1 + TypeScript | 已搭建，见 [开发环境指南](docs/DEVELOPMENT.md) |
| 导航 | React Navigation（native-stack + bottom-tabs） | 书架为根栈，作品内为底部标签 |
| 状态管理 | Zustand | 轻量；持久数据以 SQLite 为准，Zustand 只放界面状态 |
| 本地数据库 | op-sqlite 或 react-native-nitro-sqlite | 需要 FTS5（trigram 分词）、事务、同步 API。**开发 0.1 时验证 FTS5 trigram 是否可用**，不可用则改为 LIKE + 自建倒排索引 |
| 安全存储 | react-native-keychain | iOS Keychain（`WHEN_UNLOCKED_THIS_DEVICE_ONLY`），Android Keystore |
| 网络 | 内置 `XMLHttpRequest`（流式）、`fetch`（非流式） | RN 0.87 的 `fetch` 不能逐段读取响应体，流式统一走 XHR `onprogress` 增量解析 SSE；备选 react-native-sse |
| JSON Schema 校验 | ajv（或 zod 生成 schema） | 用于结构化输出的本地校验与降级 |
| 图标 | lucide-react-native + react-native-svg | 见 UI 设计规范 3.4 |
| 文件 | react-native-fs 或同类库 + 系统分享面板 | 导出、备份、封面图片 |
| 国际化 | V1 只做简体中文，文案集中在 `src/locales/zh-CN.ts` | 方便以后加语言 |

不引入 OpenAI / Anthropic 官方 SDK：Anthropic TypeScript SDK 明确不支持 React Native，两家的协议都很简单，直接用 HTTP 更可控。

## 3. 目录结构

```
src/
├── app/                    # 入口、导航、全局 Provider
│   ├── navigation/         # RootStack、WorkTabs、路由类型
│   └── providers/
├── theme/                  # 设计令牌：tokens.ts（颜色、字体、间距、圆角）
├── components/             # 通用组件：Button、Badge、ProposalCard、Sheet、BookCover……
├── screens/                # 页面，命名与设计文档的 S01–S15 对应
│   ├── onboarding/         # S01、S02（首次）
│   ├── shelf/              # S03、S04
│   ├── work/               # S05 概览、S06 章节
│   ├── editor/             # S07、S08、S09、版本历史
│   ├── partner/            # S10 AI 伙伴
│   ├── archive/            # S11、S12
│   ├── review/             # S13 记忆审核、S14 冲突处理
│   └── settings/           # S15、模型服务编辑（S02）
├── features/               # 业务逻辑（不含界面）：works、chapters、archive、memory、conflicts
├── ai/
│   ├── providers/          # 模型适配层（见第 5 节）
│   │   ├── types.ts        # 统一请求 / 事件 / 错误类型
│   │   ├── openaiResponses.ts
│   │   ├── anthropicMessages.ts
│   │   ├── sse.ts          # XHR 增量读取 + SSE 解析
│   │   ├── url.ts          # Base URL 拼接规则
│   │   └── errors.ts       # 错误归一、重试策略
│   ├── tasks/              # ideation、describe、summarize、extractMemory、detectConflicts
│   ├── context/            # 上下文组装与 token 预算
│   ├── prompts/            # 系统提示与各任务提示词
│   └── schemas/            # 结构化输出的 JSON Schema
├── data/
│   ├── db.ts               # 连接、事务、迁移入口
│   ├── migrations/         # 0001_init.sql ……
│   ├── repositories/       # 每张表一个仓储
│   └── backup/             # 导出、导入
├── secure/                 # Key 读写（只有这里能碰 Key）
├── store/                  # Zustand stores（界面状态）
├── locales/zh-CN.ts
└── utils/
```

约束：

- `secure/` 封装系统存储；`features/modelServices` 和 `ai/providers` 可临时读取 Key。S02 仅经 `modelServices.revealKey` 响应作者主动显示；UI 不直接访问 secure，见 G02 §5.11。
- 界面层不直接写数据库，统一通过 `features/` 调用仓储。
- AI 任务的输出只能写入"提议"类表（提案、候选），写入正式档案只能经由作者操作触发的 `features/` 函数。第 9 节的测试会检查这一点。

## 4. 本地数据模型

SQLite，主键用 UUID 文本，时间用 ISO 8601 字符串。以下为 V1 主要表，字段为初稿。

```sql
-- 作品
CREATE TABLE works (
  id TEXT PRIMARY KEY,
  title TEXT,                       -- 可为空（未命名作品）
  genre TEXT,                       -- xuanhuan / xianxia / dushi / ...
  premise TEXT,                     -- 一句灵感 / 梗概
  style_note TEXT,                  -- 文风偏好
  status TEXT NOT NULL DEFAULT 'ongoing',   -- ongoing / finished
  planned_chapters INTEGER,
  cover_path TEXT,                  -- 为空时使用文字书封
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted_at TEXT                   -- 回收站
);

CREATE TABLE volumes (
  id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id),
  title TEXT NOT NULL, order_index INTEGER NOT NULL
);

-- 章节：正文只保存当前版本，历史在 chapter_versions
CREATE TABLE chapters (
  id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id),
  volume_id TEXT REFERENCES volumes(id),
  title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'main',  -- main / extra / draft
  order_index INTEGER NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  char_count INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'draft',      -- draft / finalized / modified
  finalized_version_id TEXT,                -- 上次定稿的版本，用于差异提取
  summary TEXT,                             -- 定稿后生成
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

CREATE TABLE chapter_versions (
  id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id),
  body TEXT NOT NULL,
  reason TEXT NOT NULL,                     -- auto / finalize / before_ai / manual / before_restore
  created_at TEXT NOT NULL
);

-- 档案条目：人物、世界观、地点、势力、规则、伏笔
CREATE TABLE entries (
  id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id),
  type TEXT NOT NULL,                       -- character / world / place / faction / rule / foreshadow
  name TEXT NOT NULL, aliases TEXT,         -- 别名，JSON 数组，用于上下文匹配
  summary TEXT,
  state TEXT NOT NULL,                      -- PROPOSED / CONFIRMED / ESTABLISHED / CONFLICTED / RETIRED
  source_kind TEXT NOT NULL,                -- manual / partner / review
  source_ref TEXT,                          -- 对话消息 id 或 章节 id + 原句
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- 条目字段：按章节生效，不覆盖过去
CREATE TABLE entry_facts (
  id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES entries(id),
  field TEXT NOT NULL,                      -- appearance / personality / ability / secret / ...
  value TEXT NOT NULL,
  state TEXT NOT NULL,                      -- 同 entries.state
  effective_from_chapter INTEGER,           -- 自第 N 章起生效；为空表示设定层面始终有效
  effective_to_chapter INTEGER,
  source_kind TEXT NOT NULL, source_ref TEXT,
  supersedes_id TEXT REFERENCES entry_facts(id),   -- 版本链
  created_at TEXT NOT NULL
);

CREATE TABLE relations (
  id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id),
  from_entry TEXT NOT NULL REFERENCES entries(id), to_entry TEXT NOT NULL REFERENCES entries(id),
  kind TEXT NOT NULL, note TEXT,
  effective_from_chapter INTEGER, effective_to_chapter INTEGER,
  state TEXT NOT NULL, created_at TEXT NOT NULL
);

-- 记忆变更提案（S13）
CREATE TABLE memory_proposals (
  id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id),
  chapter_id TEXT NOT NULL REFERENCES chapters(id),
  kind TEXT NOT NULL,                       -- add / update / retire
  target_type TEXT NOT NULL, target_entry_id TEXT, target_name TEXT NOT NULL,
  field TEXT, before_value TEXT, after_value TEXT NOT NULL,
  evidence TEXT NOT NULL,                   -- 正文原句
  confidence TEXT NOT NULL,                 -- high / medium / low
  status TEXT NOT NULL DEFAULT 'pending',   -- pending / accepted / edited / rejected
  reject_reason TEXT, decided_at TEXT, created_at TEXT NOT NULL
);

-- 冲突（S14）
CREATE TABLE conflicts (
  id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id),
  type TEXT NOT NULL, severity TEXT NOT NULL,
  a_ref TEXT NOT NULL, a_quote TEXT NOT NULL,
  b_ref TEXT NOT NULL, b_quote TEXT NOT NULL,
  explanation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',      -- open / fixed_text / updated_entry / intentional / later
  note TEXT,                                -- 有意为之的备注
  fingerprint TEXT NOT NULL,                -- 用于"有意为之"后不再重复报警
  created_at TEXT NOT NULL, resolved_at TEXT
);

-- AI 伙伴对话
CREATE TABLE conversations (id TEXT PRIMARY KEY, work_id TEXT NOT NULL, title TEXT, created_at TEXT NOT NULL);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,                       -- user / assistant
  content TEXT NOT NULL,                    -- 文本
  structured TEXT,                          -- 结构化部分（JSON），如创意选项及其采纳状态
  service_id TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
  created_at TEXT NOT NULL
);

-- 模型服务（不含 Key）
CREATE TABLE model_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,                   -- openai_responses / anthropic_messages
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '{}',       -- JSON：maxOutputTokens、effort、authHeader、store、能力探测结果
  is_default INTEGER NOT NULL DEFAULT 0,
  last_test_at TEXT, last_test_ok INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- 后台任务队列（定稿后的摘要、记忆提取、冲突检测）
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id),
  kind TEXT NOT NULL,                       -- summarize / extract_memory / detect_conflicts
  chapter_id TEXT REFERENCES chapters(id),
  status TEXT NOT NULL DEFAULT 'queued',    -- queued / running / done / failed
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- 全文检索（trigram 可直接匹配中文子串；可用性待验证）
CREATE VIRTUAL TABLE chapters_fts USING fts5(body, content='chapters', content_rowid='rowid', tokenize='trigram');
CREATE VIRTUAL TABLE entries_fts  USING fts5(name, aliases, summary, content='entries', content_rowid='rowid', tokenize='trigram');
```

数据库通过 `migrations/` 顺序迁移，版本号写入 `PRAGMA user_version`。

## 5. 模型适配层

协议、流式终态、取消、超时与测试以 [G03](docs/detailed-design/G03-ai-runtime.html) 为准；模型服务接口、Key 槽位切换与补偿以 [G02 §5.11](docs/detailed-design/G02-local-services.html#services) 为准。下方类型和 XHR 图仅为早期结构示意，不替代上述契约（包括新增 cancelled 终态、必传 signal）。

模型接入须新增迁移：随机 `key_ref`、服务 `revision` 与只含引用的 `credential_cleanup` 表；Key 不进 SQLite，旧 Key 在新配置提交前保留。原生传输禁止自动重定向，XHR 无法保证时使用应用专用最小原生桥；两端验证后才能验收。任务顺序见 [阶段交接](docs/implementation/next-stage.md)。

```ts
// ai/providers/types.ts
export type Protocol = 'openai_responses' | 'anthropic_messages';

export interface ModelService {
  id: string; name: string; protocol: Protocol; baseUrl: string; model: string;
  options: { maxOutputTokens?: number; effort?: 'low' | 'medium' | 'high';
             authHeader?: 'x-api-key' | 'bearer'; store?: boolean;
             caps?: { jsonSchema?: boolean; effort?: boolean; streaming?: boolean } };
}

export interface GenerateRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxOutputTokens: number;
  effort?: 'low' | 'medium' | 'high';
  jsonSchema?: { name: string; schema: object };   // 有则要求结构化输出
  stream: boolean;
  signal?: AbortSignal;
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'done'; text: string; usage?: Usage; stop: 'end' | 'length' | 'refusal' }
  | { type: 'error'; error: ProviderError };

export interface Provider {
  listModels(): Promise<string[]>;
  generate(req: GenerateRequest): AsyncIterable<StreamEvent>;
}
```

- `openaiResponses.ts` 和 `anthropicMessages.ts` 各自负责：拼地址、组请求头和请求体、解析 SSE 事件或非流式响应、把服务商错误映射成统一的 `ProviderError`（`kind`: network / auth / permission / not_found / bad_request / quota / rate_limit / server / truncated / refusal）。
- `errors.ts` 统一重试策略：429 按 `retry-after` 等待，5xx / 529 指数退避，均最多 2 次；额度类错误不重试。
- 结构化输出降级（去掉 Schema 参数，改用提示词约束 + 本地校验）在 `tasks/` 层完成，探测结果写回 `model_services.options.caps`。
- 不发送 `temperature` / `top_p`。

### 5.1 SSE 读取

```
XMLHttpRequest  ──onprogress──▶  取 responseText 新增部分  ──▶  按空行切分事件
      │                                                            │
      └── abort()（停止生成 / 90 秒无事件）                           ▼
                                                         event: / data: 解析 → JSON
                                                                   │
                                                       协议适配器映射为 StreamEvent
```

注意 `responseText` 会持续增长，长文本时只保留未解析的尾部，避免重复扫描。

## 6. AI 任务执行

| 任务 | 触发 | 执行位置 | 结果写入 |
| --- | --- | --- | --- |
| 创意引导 | AI 伙伴发送消息 | 前台，流式 | `messages`（选项在 `structured` 中，带采纳状态） |
| 描写 / 选区改写 | 描写助手 | 前台，流式，最多 3 个并发 | 内存中的候选；作者插入后写 `chapters` 并先存 `chapter_versions` |
| 章节摘要 | 定稿 | 后台队列 | `chapters.summary` |
| 记忆提取 | 定稿，摘要之后 | 后台队列 | `memory_proposals`（pending） |
| 冲突检测 | 记忆提取之后；档案修改后（P1） | 后台队列 | `conflicts`（open） |

后台队列在 App 内运行（JS 层串行执行，持久化在 SQLite 的 `jobs` 表，App 重启后继续）。V1 不使用系统后台任务；App 退到后台时暂停，回到前台后继续，概览页显示进度。

## 7. 安全与隐私

1. **Key**：只存系统安全存储；不进入 SQLite、备份、日志、崩溃报告；界面默认仅显示掩码，S02 可按作者操作临时显示；平台存取仅封装在 `secure/`。
2. **传输**：只允许 HTTPS；`http` 仅限 localhost 和局域网地址，并提示风险（Android 需在 `network_security_config` 中按需放行，iOS 需配置 ATS 例外，V1 默认不放行）。
3. **数据外发**：只发往用户配置的服务地址；首次使用 AI 时说明会发送哪些内容。OpenAI 默认 `store: false`。
4. **无遥测**：V1 不接入统计与崩溃上报 SDK。如需崩溃上报，P1 再评估，并做成可关闭。
5. **备份**：导出文件不含 Key；恢复后需重新填写。
6. **日志**：调试日志对请求体只记录长度和哈希，不记录正文与 Key；发布版关闭详细日志。

## 8. 后续演进（可选）

以下在 V1 验证核心闭环之后，按需求评估：

| 阶段 | 内容 | 说明 |
| --- | --- | --- |
| 云同步 | 账号 + 端到端加密同步 | 业务后端可用 Java + Spring Boot；服务器只存加密数据，仍不托管 Key |
| 后端编排 | Python + LangGraph 执行长流程任务（整卷大纲、批量一致性检查） | 用户可选择"本机执行"或"服务端执行"；服务端执行需用户明确授权上传相关内容 |
| 检索增强 | 向量检索（端上向量库或服务端 pgvector） | 先评估 FTS5 关键词检索是否已满足需要 |
| 多 Agent | 剧情审查、伏笔管理等专业流程 | 以评估结果决定是否拆分，见产品说明第 9 节 |

演进时保持两条原则：业务事实以结构化数据为准，不以向量库或工作流检查点作为唯一事实来源；AI 输出改变正式档案前必须经过作者确认。

## 9. 测试策略

| 层 | 内容 | 工具 |
| --- | --- | --- |
| 单元 | Base URL 拼接、SSE 解析（含分包、跨块事件）、错误映射、上下文预算、JSON 校验与降级 | Jest |
| 协议契约 | 用录制的响应样本回放两种协议的流式与非流式结果、各类错误 | Jest + 样本文件 |
| 数据 | 迁移、仓储、备份导出导入往返一致 | Jest + SQLite（Node 端） |
| 安全 | Key 不出现在 SQLite 文件、备份文件和日志中；AI 任务不能直接写正式档案 | Jest |
| 界面 | 关键页面渲染与交互 | React Native Testing Library |
| 端到端 | 首次使用、写作、定稿审核主流程 | 真机 / 模拟器手动验收，P1 引入 Maestro |

CI 已有 Quality、Android build、iOS build 三项检查（见[开发环境指南](docs/DEVELOPMENT.md#日常检查与-ci)）。

## 10. 开发里程碑（建议）

| 里程碑 | 内容 |
| --- | --- |
| 0.1 基础 | 导航骨架、设计令牌与基础组件、SQLite 与迁移、书架与作品 / 章节 CRUD、编辑器自动保存与版本；验证 FTS5 trigram |
| 0.2 模型服务 | 适配层、SSE、连接测试、Key 安全存储、S02 / S15；两种协议各接一个官方地址和一个中转地址 |
| 0.3 写作助手 | 描写助手、选区操作、候选流式展示与插入 |
| 0.4 创意与档案 | AI 伙伴、结构化选项、档案与人物详情、状态与版本 |
| 0.5 记忆闭环 | 定稿、摘要、记忆提取与审核、冲突检测与处理 |
| 0.6 打磨 | 备份恢复、错误处理全覆盖、无障碍、性能（中低端 Android 长章节） |

---

**文档版本**：1.1
**最后更新**：2026-10-16
**维护者**：MathildaStacy
