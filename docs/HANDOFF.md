# 开发交接 · 2026-10-18

新会话从本文开始，再读 [next-stage.md](implementation/next-stage.md)。这是工作记录，不替代详细设计；模型接入阶段尚未整体完成。第一阶段写作功能已有实现，不重新开发。

## 当前仓库与审查基线

- 仓库：`~/Desktop/Personal/NovelAgent/NovelCreationPartner`；分支：`feature/mvp-core`。
- 本阶段接手基线：`fe491f1b73f2bd22a9cb1b7eea754593e2051e7f`。
- **当前代码结束提交：`1293abf4c60edb2301a03fcb4ccc729d3fa6cb95`**。后续工作记录提交不改变此代码审查范围；新会话仍需执行 `git status` / `git log` 核对事实。
- 本阶段所有实现均已本地提交，没有 push。工作区仍有接手时已有的 Astra 设计修改：`ARCHITECTURE.md` 和 detailed-design 下 D02/D03/D05、G01/G02/G03、S02/a/b/c、S15/a；接手摘要比对无变化，未混入实现提交。不要还原、清理或擅自提交这些文件。
- 已读取用户提供的 AGENTS 指令；此前检查仓库与祖先目录无额外 AGENTS，仓库无 `.codegraph/`。环境或指令改变时重新核对。

## 本阶段提交

| 提交 | 可验收范围 |
| --- | --- |
| `a659172` | dispose 后旧 Autosave 及等待中的 flush 不得再次写入，补恢复竞态测试 |
| `95a1a1b` | `react-native-keychain@10.0.0`、专用 Android/iOS TurboModule、UTF-8 包装层及受控原生探针 |
| `8c18f9a` | 模型服务迁移、CRUD/default/revision、Key 新槽切换和持久化清理补偿、recentModels 同事务 |
| `33b57e5` | 原生注册/abort/invalidate 竞争修复、禁止 OkHttp 隐式重发、503 请求次数探针 |
| `4345067` | 双协议 Provider、SSE/JSON、错误归一、取消/超时/唯一终态、消费者停读时资源释放 |
| `1293abf` | 20 秒列表/ping、有限重试/effort 降级、结果关联和 persist 防旧写回、三测试并发上限 |

## 已实现与未完成

- 核心写作已实现：作品/章节/分卷、排序、编辑器自动保存/撤销重做、版本比较/恢复、定稿快照和任务入队。Sheet/ChapterFormSheet/初始编辑器焦点及恢复保护原有修复在 `d4ff54b`，本轮已复核并补旧 Autosave 修复。旧 `1a0a9d7`、`34eb307` 都不能作为当前基线。
- 模型服务实现到 features：`list/get/getDefault/save/remove/setDefault/revealKey/test/fetchModels/resolveUrl/hasPendingKeyCleanup/retryPendingCleanup`。`get` 不存在抛 NOT_FOUND，返回内存现算 keyMask/revision；调用方以当前 G02 为准。
- 已实现 OpenAI Responses / Anthropic Messages 的单请求适配与列表、最小连接测试；这些模块不发送作品、不执行后台 AI。测试是合成协议和可注入传输，不代表真实服务接通。
- **顺序 1 原生 gate 未解除**：源码、Codegen 和 JS 检查通过；Android/iOS 编译、设备增量/abort/禁重定向、Release HTTP/ATS、锁屏/强杀仍待作者本机。完整 S02/a/b/c、S15 服务区/a、书架设置与 D03 导航入口（顺序 5）尚未实施；顺序 6 未验收。按交接先验证原生接入，再投入完整 UI。
- 主页未完成，保留书架根路由与作品概览入口，不能把已有页面当作主页验收。详细设计存在：[S03 App 根页](detailed-design/S03-shelf.html)、[S01 首次启动](detailed-design/S01-welcome.html)、[S05 作品内首页](detailed-design/S05-overview.html)。作者要求只确认有无，不修改这些设计。
- S01 引导、S15 其余设置/备份导出/完整回收站、业务 AI、上下文/结构化任务、档案/伙伴/记忆审核/冲突、runner 均不属于本次完成范围。`jobs.ts` 仍仅列表/恢复/无服务暂停；有配置或 Key 不代表任务开始执行，不唤醒历史任务计费。

## 关键实现与后续易错点

- `src/features/modelServices.ts`：配置、Key 读取和清理共用短协调锁，网络不持锁。新 Key 先登记清理、写安全槽并读回，再业务事务切换引用；业务提交后 emit。清理失败是已保存/已删除且待清理，不能谎报回滚。启动、active 和后续写操作重试，无轮询。
- `src/data/migrations/0002_model_services.ts`：升级保留写作数据；旧无槽位记录清 hasKey/lastTest；部分唯一索引限制一个默认，非空服务保持恰好一个默认。
- `src/secure/keychain.ts`：设备绑定和锁定保护；安全存储与 SQLite 不能原子提交。锁定不等于缺槽，只有确认槽位不存在才修 hasKey、清测试状态并递增 revision。
- `src/ai/providers/{httpProvider,lifecycle,parse,sse,errors,connectionTest}.ts`：协议、有限缓冲、超时和取消；完整终态后停读也必须释放监听/连接。流中已有文字再断网返回 AI_STREAM_INTERRUPTED；已有文字不自动重发。
- 两端 `ModelTransport`：原生下一跳前禁止所有重定向；禁止 Cookie/cache/认证重发。Android 的 `503 + Retry-After: 0` 也不能隐式多发请求，探针用计数验证。
- S02 后续必须在关闭/连接字段变化时取消请求并释放 Key/result；清 caps 时同时丢弃旧 TestResult，防止保存重新合并旧能力。显示 Key 不等于作者修改 Key，异步 reveal 不能覆盖新输入；Key 不入导航或全局状态。
- TestResult 用 WeakMap 关联规范化配置、Key 身份、revision 和可信结果快照；克隆/拼装结果忽略，外部改返回对象不能改持久化内容。persist 只接受当前保存版本且 key=undefined，仅写 lastTest，不写 caps/revision；保存/删除取消在途请求，切默认不影响捕获的快照。
- `src/screens/editor/autosave.ts` / `EditorScreen.tsx`：恢复时 dispose 旧保存会话，加载失败不能露出旧正文；AI 插入未来复用 history/indent/locate 和 before_ai 快照。版本页返回与 `popTo('Shelf')` 保持现有导航行为。
- Sheet 等原生 onShow 和进入动画结束才发 onShown；ChapterFormSheet 等数据 ready 和 shown 才聚焦，选卷返回不覆盖输入。编辑器初始焦点还需等 native-stack 动画，历史返回/恢复不重复抢焦点。useDirtyGuard 的保存 busy 拦截先注册，解除拦截再导航。
- 章节 reorder 必须提供所有卷及全部未删除章节各一次，一次事务提交完整布局。版本 LCS 预算为 4,000,000 单元；超预算按中间替换展示。恢复前正文与永久快照相同会复用，不能以没有新增“恢复前”行判断丢失快照。

## 必须保留的约束

中文简洁交流；按 G02/G03 和对应 S/D 页实现，不重新规划。UI 只调用 features；数据库写事务，事务 helper 接收 tx，禁止在事务内调用 db()；提交后 emit。保留 works.remove 不改任务表、队列跳过删除作品，以及相同正文快照升级永久理由的决定。

作者要求本轮不修改架构/详细设计；若确需不可兼容契约、安全边界或跨模块变更，整理证据/选项/推荐交作者转 Astra，继续独立工作。常规实现和局部排错自行完成。确有必要可并行子 agent；不自动切换/启动其他模型。每块 check 后独立英文 conventional commit；不 push、不更新无关依赖、不清应用数据。Android/iOS 构建与设备验收由作者执行。

## 已执行检查与设备缺口

- Node **24.22.0**，必须先 `source scripts/dev-env.sh`。
- 代码结束提交前 `npm run check` 通过：**24 套件 / 324 项；ESLint 无警告，TypeScript 通过**。真实 SQLite + 安全存储故障注入覆盖补偿、重启、默认值与数据一致性；协议测试覆盖分包、终态、超时、取消及成本上限。
- 两端 Codegen 成功，plist/project 语法检查通过；受控 fixture Node HTTP smoke 通过。以上都不能代替原生编译/运行或真实模型兼容性。
- 本轮未运行 Android/iOS 构建、模拟器/真机或真实模型请求。[此前 Pixel 写作验证](validation/2026-10-18-core-writing.md) 是历史证据，不能据此宣称新增依赖和传输已验收。保留测试作品 `Pixel Smoke 20261018`，不 clear、不卸载。
- 本机具体命令、预期计数和安全取舍见 [模型原生验证记录](validation/2026-10-18-model-transport.md)。Release 私网 HTTP/ATS 尚未实证，不放宽全局明文策略；若平台不满足设计，按记录中的选项交 Astra 决策。
- 本次工作记录仅改 README/HANDOFF/next-stage；已检查文档差异和本地链接，没有重跑应用测试，上述 24 套件 / 324 项是代码结束提交前的实际结果。

## 新会话接续顺序

1. 读适用 AGENTS，执行下列命令核对状态；保留外部未提交设计修改，不重复安装依赖。
2. 读 [next-stage.md](implementation/next-stage.md) 和最新设备记录；按需读 G02 §5.11、G03 §2/3/6.1–2 及 S02/S15/D03 等页面，不另起架构设计。
3. 优先核对作者新增的两端探针/Release 结果；没有结果时明确 gate 未解除，不把 Mock 或源码检查算作通过。设备命令交作者本机执行。
4. gate 解除后继续顺序 5：S02/a/b/c、D04/D05、S15 服务区/a、D02、书架/D03 入口与返回保护。复用现有组件、样式和中文文案；每个可验收块 check/提交/更新 next-stage。
5. 完成顺序 6 设备验收并记录真实兼容性缺口。本阶段完成后停在交接点，不自行展开下一阶段。

```sh
git status --short
git log -10 --oneline
source scripts/dev-env.sh
node --version
npm run check
```

开发环境参考 [DEVELOPMENT](DEVELOPMENT.md)、[ANDROID_STUDIO](ANDROID_STUDIO.md)。持久记录全部在仓库；不依赖 `/tmp` 的提取文本、摘要、Codegen 输出或截图，新会话可直接读取 HTML 设计和源码。
