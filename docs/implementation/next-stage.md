# 下一阶段：模型服务接入

更新：2026-10-18。供 GPT-6.1 Sol 实现；本轮仅设计核对，不代表接入功能已完成。

## 基线与核对范围

- 分支 `feature/mvp-core`；实际 HEAD **`fe491f1b73f2bd22a9cb1b7eea754593e2051e7f`**。开始时 `git status --porcelain=v1` 为空。此前提及的未提交焦点/弹窗/恢复修复已在 `d4ff54b`；后续 `547ee52` 是验证记录、`fe491f1` 是交接。未回退、清理或提交任何用户代码。
- 已读取用户提供的 AGENTS.md 指令；仓库、祖先目录及 docs 下未发现额外 AGENTS.md，根目录没有 `.codegraph/`。本次只核对服务/队列、schema/事务、导航与接入入口、相关原生网络配置；未全仓风格审查。
- 已实现：SQLite 数据层、主题/组件、导航、书架、作品、章节、编辑器、版本及恢复。依据现有代码和 [HANDOFF](../HANDOFF.md)、[验证记录](../validation/2026-10-18-core-writing.md)；不重做第一阶段。记录中的 13 套件/104 项检查与 Pixel AVD 验证是**前次结果**，本轮未重跑应用测试、未调用真实模型。
- 部分实现：`src/features/modelServices.ts` 只有 list/get/getDefault；get 缺 keyMask/revision，has_key 只是数据库标记。没有 secure、AI provider 或 S02/S15；package.json 尚无安全存储依赖。
- 部分实现：`chapters.finalize` 真实保存快照、取消旧任务并按默认 service_id 入队三任务；`jobs.ts` 仅 list/recoverRunning/pauseWithoutService；`app/jobQueue.ts` 仅监听事件后检查「任意服务记录是否存在」。没有 no_key/notice/offline、恢复、取消句柄、重试或 runner。已有服务 ≠ 可用 Key ≠ AI 会执行；本阶段不把这些队列能力宣称完成。
- 占位：`ShelfScreen` 设置按钮、`dialogs.ensureModelService` 的连接分支、S04/S07 的 AI 入口、伙伴/档案页面。待验收：iOS 整体、真实设备锁屏/杀进程、中文输入与长正文性能；Android 历史记录只是模拟器，不是真机覆盖。

## 执行依据与范围

**Sol 必须遵循 `docs/detailed-design/`，不能按本交接另起设计或以简化占位替代验收。** 阅读 [index](../detailed-design/index.html)、[G01](../detailed-design/G01-conventions.html)；接口/事务以 [G02](../detailed-design/G02-local-services.html#services) 为准，AI 行为以 [G03](../detailed-design/G03-ai-runtime.html) 为准，交互以 [S02](../detailed-design/S02-model-service.html)、[S02a](../detailed-design/S02a-model-picker.html)、[S02b](../detailed-design/S02b-advanced.html)、[S02c](../detailed-design/S02c-test-result.html)、[S15](../detailed-design/S15-settings.html)、[S15a](../detailed-design/S15a-service-actions.html) 和 D02/D03/D04/D05 为准。本文只限定本阶段交付切片及顺序；如实现受阻或契约仍冲突，先更新对应详细设计并说明原因，再实现，不能静默偏离。

本阶段交付：模型配置 CRUD/默认值、安全存储、双协议 HTTP/SSE/JSON 适配、取消/超时/错误归一、列表与 ping 测试；S02 及 a/b/c，S15 的服务区和 S15a，书架设置入口及现有 D03 → S02 的导航。S02a 是页面内模态，Key 不进入导航参数。复用现有 Sheet、DirtyGuard、中文文案和恢复后会话保护。

阶段性不交付（完整 MVP 设计不删减）：S01 欢迎/首次路由（继续已有书架启动，不伪造 onboardingDone）；S15 其余设置/备份/恢复/回收站/关于；业务 AI、D01 确认执行管道、上下文/Schema 降级任务、伙伴、档案/审核/冲突、后台 runner。S15 暂只呈现服务区；现有 AI 入口连接完成后返回原页面，保留准确的「后续阶段接入」说明，不自动发送作品、不提前创建作品。未来业务 AI 接入时再验收 D03 自动继续与 D01；本阶段 D03 返回保护仍需完成。连接服务不唤醒历史任务开始计费，也不把无 runner 的任务显示为处理中。

剩余 MVP 依赖简序：**本阶段模型接入 → 档案基础/关系与本地状态查询 → D01/上下文预算及描写候选插入 → AI 伙伴与结构化采纳 → 定稿 runner、S05b、记忆审核/冲突闭环 → 完整设置、引导与导出恢复 → 两端整体验收**。档案基础可独立于本阶段推进，但本轮不展开设计或派发其他会话。

## 本轮设计修订及原因

- G02 §5.11：补齐 revealKey、revision、草稿与 TestResult、persist 及取消类型；以新槽位切换和持久化清理登记替代「写同一 Key 后 DB 失败就删除」，避免丢旧 Key；删除后清理失败明确为已删除/待清理，纠正跨存储原子回滚承诺。
- G03 §2/3/6.1–2/8–11：明确原生禁重定向、唯一终态与取消、SSE 分帧/EOF/usage、有限响应与 deadline；测试全链路 20 秒，列表超时不继续生成；单次 progress 不能证明不支持流式；补足回复模型/模型列表/capsPatch 返回值，采用白名单诊断防止服务商回显泄密。
- 对应 S02/a/b/c、S15/a、D02/D03/D05 只同步上述冲突，ARCHITECTURE 标明 G02/G03 为当前契约。保留 G02「任务使用入队服务」并纠正 S15a 的「切默认重定向所有排队任务」；作品删除不改任务表也已消除相关描述冲突。

## 可独立提交的任务（按依赖顺序）

| 顺序 | 单次提交边界 | 完成证据 |
| --- | --- | --- |
| 1 | 原生接入可行性：验证 react-native-keychain 与 RN 0.87.1 新架构兼容；建立应用专用传输最小验证，确认两端增量交付、abort、发下一跳前禁重定向；确认 Release 局域网 HTTP/ATS 权限 | Android/iOS 实际结果和所选依赖版本写验证记录；只用运行时无效临时凭据、可控本地端点；不改全局 RN 网络或 node_modules。平台阻碍按下文升级 |
| 2 | G02 §5.11 迁移、secure、CRUD/default、revision 与清理补偿；recentModels 同业务事务、提交后事件 | 真实 SQLite + 可注入安全存储测试，逐断点故障/重启恢复；既有写作数据库升级不丢数据。get 行为变化检查现有调用方 |
| 3 | G03 §2/3 的 Provider/传输/SSE/JSON/错误归一；明确请求所有者与终态，纯解析和传输分开 | 双协议合成数据、分片与竞态测试；安全的 GET/POST、禁跳转、资源释放；不附带任何业务 AI 写库 |
| 4 | G03 §6.1–2 + G02 §5.11.3 的列表、测试、20 秒期限、有限重试/effort 降级、持久化防旧结果 | 草稿测试不写库，S15a 有条件写回；分页/缓存/次数/deadline 可断言；不探测 JSON Schema、不提高 ping 输出预算 |
| 5 | S02/a/b/c + D04/D05；S15 服务区/S15a + D02；书架/D03 最小入口与返回会话保护 | 按页面验收逐条验证：字段、显隐、焦点、列表手填/缓存、测试/保存提醒、默认/删除/清理延迟；只经 features 访问数据与网络 |
| 6 | Android/iOS 真机验收与回归记录 | 本文测试矩阵、对应 S/D 页验收与构建结果；缺设备/凭据的项目明确标未验收，不用 Mock 声称协议兼容 |

先完成 1 的最小验证，再投入完整 UI；每块跑相关测试，提交前 `source scripts/dev-env.sh` 后 `npm run check`。使用英文 conventional commit，只提交本阶段文件且保留外部未提交工作；不 push。不要重跑无关全仓审查，也不要自动启动其他模型/子代理。复杂风险才交 Astra，普通实现/测试修复由 Sol 完成。

## 契约索引与审查不变量

精确签名、类型、失败补偿见 **G02 §5.11.1–3**，请求/事件见 **G03 §2.2.0、§3、§6.1–2**；不复制第二套接口。审查至少守住：

- UI → features；服务所有 DB 写在事务内，内部 helper 只收 tx；网络/安全存储不占 DB 事务，业务提交后 emit。清理登记只存随机引用；保存失败不毁旧 Key、旧配置，删除已提交不得谎报回滚。默认非空恰好一个。
- Key 不入 SQLite/备份/导航/日志/原始错误/测试样本；设备锁定不等于丢 Key。显隐只响应作者操作，不把已读明文误当 Key 编辑；异步 reveal 不覆盖新输入。禁止跨 host 悄悄转发 Key；本阶段直接禁止全部重定向。
- 请求捕获配置/Key 快照；取消、超时、终态竞争只结算一次；abort 覆盖分页、等待、重发，迟到请求不更新 UI/lastTest/caps。草稿 test 默认不落库；persist 测试用 revision/序号隔离，删除永不复活记录。
- 测试固定 ping/64/low/store=false，20 秒全流程；不自动续写/扩大 token，不用模型名单硬编码限制自定义模型。结构化错误才能触发有限 effort 降级；不把模型特定参数接受情况当通用保证。
- 保留 `works.remove` 不改任务表、队列跳过已删除作品，以及 `versions.snapshotIn(tx, ...)` 相同正文从 auto/before_ai 升为永久理由的决定。本阶段不顺手重构这些服务。

## 必须覆盖的测试与设备验收

1. **存储故障**：新建/替换/留空/删除，准备登记失败、安全写入后失败、业务提交失败、提交后旧槽删除失败、清理登记移除失败；每个边界模拟重启，验证引用槽位不误删、遗留可重试、默认唯一、recentModels 与业务一致、事件只在提交后。并发保存/删除/默认切换、旧 revision、真实锁屏/解锁与槽位确实缺失分开测。
2. **协议**：URL 官方/网关前缀/完整端点、非法 scheme/userinfo/假私网；两种鉴权与版本头、store、output token 字段；OpenAI output 数组/拒绝，Anthropic text/thinking/累计 usage；SSE 每字节切片、中文/emoji、CRLF 拆分、多 data、注释、未知事件、损坏已知事件、重复终态、无终态 EOF、HTTP 200 内错误、JSON/HTML 兜底、超限；不重复追加文本或用量。
3. **生命周期/成本**：20 秒包括分页/重试，5 分钟生成上限；消息停在半帧、心跳、首字节/空闲、取消恰逢完成、iterator 提前退出、后台挂起后返回；取消后零新请求、无迟到 toast/DB 更新、无残留计时器。测试 POST 次数上限、429 quota/rate 区分、Retry-After 秒/日期/ms/非法值、effort 400 与笼统 output_config 400 不误降级。
4. **泄密/交互**：运行时生成的无效秘密随机值及模拟恶意回显检查 DB（含 WAL）、捕获的 JS/原生日志、lastTest/D05 复制内容和测试输出；不捕获真实 Key 到测试/截图。安全存储与 HTTP 调试排除系统备份/缓存。S02 改字段/关模态/保存/返回/删除时取消，dirty 提醒与键盘/焦点；S15a 离页完成无 toast，缺 Key 与待清理提示正确，旧写作数据不变。
5. **Android + iOS 真机**：锁屏读写/清理、强杀于 Key/DB 切换边界、重启、飞行模式/DNS/TLS、切后台与断流、Release 局域网 HTTP 与 iOS 本地网络权限、实际分段到达；用两受控端点验证 301/302/307/308 第二端点没有收到任何请求/鉴权。只在受控环境用临时无效值验证跳转，不能把真实 Key 发到测试服务器。
6. **真实兼容性**：两协议各至少官方端点与一个兼容网关（有用户配置才测），仅最小 ping、关闭多余探测，保留耗时/次数/响应类型证据。无可用服务或设备就记录缺口，不自行借用凭据或扩大付费测试。既有 Pixel 测试作品保留，不清数据、不卸载；设备验收不能由 Jest 代替。

本轮只修改文档：`git diff --check` 通过，变更行及交接中的 44 个本地链接/锚点检查通过，HTML ID 无重复；未运行应用测试或验证新功能。实现阶段需自己提交上述证据。

## 何时再交 Astra

当前跨存储补偿、草稿隔离、流终态/取消、20 秒测试预算、Key 脱敏、任务绑定服务策略已定案，Sol 可直接执行。只把有证据的边界问题升级：

- RN/平台无法同时满足增量、原生禁重定向、Release 私网 HTTP，需要改变传输范围或允许更广网络策略；带最小复现、两端差异和候选方案，不能先放宽安全边界。
- 实际官方/网关协议出现 G03 无法归一的终态/鉴权/字段行为，或新安全存储依赖无法支持所需保护和恢复；提供脱敏结构与版本，不贴 Key 或用户作品。
- 后续启动业务 AI/runner 前，另行审查定稿输入版本绑定、重定稿/删除竞态、取消与提案写入原子性、D01/成本预算。当前 jobs schema/半成品不能直接当作这些问题已解决。

后续审查以本基线到当前 HEAD 的 diff + 相关未提交修改为范围，优先数据丢失、密钥泄露、竞态、协议兼容与设计偏差；结论给文件、触发条件、修复建议，不重复通读仓库、不做纯风格重构。接手时保留本轮未提交设计修改，勿还原为旧契约。

## Sol 实现进度（2026-10-18）

- 接手实际基线 `fe491f1`。第一步已复核已提交的 `d4ff54b`；新增修复 `a659172`：旧 Autosave 被 dispose 后，等待中的 flush 不得再次写入。Node 24.22.0 下 `npm run check` 通过（13 套件 / 105 项）。Sheet/ChapterFormSheet/useInitialEditorFocus 的既有测试保留；无并发修改代码证据。
- 顺序 1：已增加 `react-native-keychain@10.0.0`、应用专用双端传输源码与独立受控探针入口；接口 Codegen 和 `npm run check` 通过（15 套件 / 118 项；本提交），plist/project 语法检查通过；原生编译/设备尚未验收，**顺序 1 gate 未解除**。操作与平台风险见 [原生验证记录](../validation/2026-10-18-model-transport.md)。不把 probe/Mock 当作真实模型接通。
- 作者要求 Android/iOS 构建与设备验证自行执行；实现者不运行构建、不清数据、不改全局明文策略。Release 私网 HTTP/ATS 证据待补；需改变边界时交 Astra，不修改设计文档。后续仅先做不依赖平台判定的存储/协议实现，完整 UI 等待 gate。
- 主页：作者明确未完成；现有书架不等同主页验收。已确认详细设计存在 `S03-shelf.html`（App 根页）、`S01-welcome.html`（首次启动）、`S05-overview.html`（作品内首页），按作者要求不修改架构/详细设计。
- 顺序 1 源码/探针基线提交 `95a1a1b`；顺序 2 本提交实现迁移、CRUD/default/revision、独立 Key 槽切换与持久化清理、recentModels 同事务、启动/active 恢复。存储与配置共 58 项测试，含真实 SQLite 与模块重载故障恢复；Node 24.22.0 全量 `npm run check` 通过（当前工作树 21 套件 / 248 项，含并行开发的协议测试）。test/fetchModels 与结果关联留在顺序 4，不将尚未接入的界面视为完成。
