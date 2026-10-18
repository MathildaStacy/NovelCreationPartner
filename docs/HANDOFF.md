# 开发交接 · 2026-10-18

供下一会话继续开发使用。本文记录已实现范围和阶段边界，不代表完整 MVP 已完成。详细设计仍是开发依据，本文不替代设计。

## 仓库状态

- 路径：`~/Desktop/Personal/NovelAgent/NovelCreationPartner`
- 分支：`feature/mvp-core`
- 本轮开始时实际 HEAD 为 `b412a5a`，工作区干净；用户最初提供的 `34eb307` 是更早的数据层提交。
- 最新代码提交为 `d4ff54b`；验证记录提交为 `547ee52`。本文和 README 的交接更新另有文档提交，接手时以 `git log`、`git status` 为准。
- 已在本地提交，没有 push；由用户在本机执行 push。
- 保留已有工作，没有 reset、清空应用数据或卸载应用。

## 已完成范围

此前已有数据层、主题、通用组件、启动、导航、书架及搜索。本轮继续完成核心写作页面：

| 页面 | 当前实现 |
| --- | --- |
| S04 新建作品 | 离线创建、字段校验、D03 模型服务检查与跳过、D04 未保存提醒、防重复创建；离开页面后迟到的检查结果不会继续创建或弹旧提示 |
| S05 / S05a 概览与作品信息 | 真实统计、最近编辑、任务和档案计数；创建第一章、编辑作品信息、删除及撤销；未实现目标页的入口显示阶段提示 |
| S06 / S06a / S06b 章节 | 分卷列表、左滑和长按菜单、共享新建/编辑弹窗、章节类型和卷选择、移动、定稿/取消定稿、版本入口、删除确认及撤销 |
| S06c 卷管理 | 新建、重命名、上下移动、删除空卷；属于回收站章节的卷不能删除 |
| S06d 章节排序 | 长按手柄拖动、跨卷与空卷落点、边缘滚动、编号预览、无障碍移动；完成后一次性提交完整布局 |
| S07 编辑器 | 2 秒防抖自动保存、连续输入 10 秒保存期限、串行 flush、保存失败保留正文和重试/复制/放弃；撤销重做、缩进显示与存储偏移映射、字数、光标、离页快照；选区栏暂不接 AI |
| S07a / S07b | 更多菜单、手动版本、字体与字号偏好、共享定稿确认；导出仍是占位 |
| S07d / S07e | 版本列表、段落和字符对比、相同段落折叠、恢复前快照、整章恢复和来源导航；恢复后清空撤销重做 |

主题、竖排文字书封、通用组件和中文文案可直接复用。中文文案集中于 `src/locales/zh-CN.ts`；`locales/work.ts`、`chapters.ts`、`editor.ts` 保留兼容 re-export。

## 本轮提交

| 提交 | 内容 |
| --- | --- |
| `598284a` | 对齐 G02 写作契约、排序完整布局校验、提案计数、版本对比预算和原生导航保护 |
| `78563fa` | S04、S05、S05a |
| `146c9e7` | S06 及 S06a–d |
| `51e4e0c` | S07、S07a/b/d/e、自动保存与版本恢复 |
| `1a0a9d7` | 写作页面中文文案集中化 |
| `d4ff54b` | 恢复后读取失败保护、迟到请求保护、原生弹窗/编辑器焦点与状态行布局修复 |
| `547ee52` | Android 运行指南和 Pixel 核心写作验证记录 |

## 服务与设计决定

设计入口为 [detailed-design/index.html](detailed-design/index.html)。服务名称、参数和事务规则以 [G02](detailed-design/G02-local-services.html) 为准；页面按对应 S 页，AI 后续按 [G03](detailed-design/G03-ai-runtime.html)。本轮先修改 G02，再写对应实现：

- `chapters.reorder(workId, layout)` 接收全部卷（含空卷）及全部未删除章节各一次；不完整、重复或归属错误的布局返回 `VALIDATION`，不部分保存。
- 新增 `proposals.pendingCount(chapterId)`，为 D02 提供真实待审核提案数。
- 版本 LCS 对比最多分配 4,000,000 个单元；超预算保留相同前后缀，中间按替换展示，避免矩阵内存失控。大文本对比不保证最少差异块，正文和恢复内容不受影响。
- 同步既有决定：`works.remove` 不修改任务表，由队列跳过已删除作品；最近快照正文相同且理由为 `auto` / `before_ai` 时，可升级为永久理由，不新建重复快照。
- 恢复前正文与最近永久快照相同时复用该快照。因此恢复后未必多出一个名为“恢复前”的行，但恢复前内容仍可找回。

界面只调用 `src/features/`，不能直接访问数据库。服务的多步写操作放在同一事务；事务内部辅助函数接收 `tx`，不能调用 `db()`，否则会等待自己持有的串行锁。事件应在提交后发出。设备调试时只读导出 SQLite 不属于 UI 代码访问。

## 重要代码位置与易回归行为

- `src/app/boot.ts`：打开数据库、迁移、启动维护、读取 `onboardingDone`；本阶段两条路由均进入书架。迁移失败阻止正常启动并显示错误页。
- `src/app/hooks.ts`：`useLoad` 和 `useDirtyGuard`。后者使用 `usePreventRemove`，解除拦截后再执行导航；保存中的 busy 拦截须先注册，避免吞掉保存后的离页操作。
- `src/components/Sheet.tsx`：等待原生 `Modal.onShow` 后开始进入动画，动画完成才发 `onShown`；退出中快速重开也能继续进入。直接在 Modal 刚挂载时 focus，在 Android 上可能只有焦点/全选而不弹键盘。
- `src/screens/work/ChapterFormSheet.tsx`：数据 ready 和 Sheet shown 都满足后聚焦标题；选择卷返回不会重载用户已填内容。
- `src/screens/editor/useInitialEditorFocus.ts`：正文挂载与 native-stack 首次进入动画完成后才聚焦一次，历史返回和恢复不反复抢焦点。
- `src/screens/editor/autosave.ts`、`history.ts`、`indent.ts`、`locate.ts`：保存调度、补丁式撤销重做、显示/存储偏移和定位。接入 AI 插入时必须复用这些机制，并按设计保存 `before_ai`。
- `EditorScreen.tsx`：恢复后的整章重载开始即 dispose 旧 Autosave，并隐藏旧正文；失败显示可重试错误页，不能让旧会话覆盖刚恢复的内容。已有故障注入回归测试。
- `VersionDiffScreen.tsx`：从编辑器恢复时移除两层历史页并回到原编辑器；从章节列表恢复时进入新编辑器。不要改成不断堆叠编辑器。
- 从作品返回书架使用 `popTo('Shelf')`，避免重复创建根书架。

## 明确未完成的功能

不要把已有 schema、只读统计或占位入口当作完整功能：

- S01、S02/S02a–c：引导、模型服务配置、测试连接和系统安全存储尚未实现。`modelServices.ts` 目前只有 `list/get/getDefault`；`has_key` 是元数据，尚无真实 Keychain/Keystore 集成。`get` 尚无设计中的 `keyMask`，`save/remove/setDefault/resolveUrl/test/fetchModels` 也待实现。
- G03：模型协议适配、流式请求、上下文预算、结构化输出、取消和重试、用量记录、实际 AI 任务执行尚未实现。
- `jobs.ts` 当前只有列表、启动恢复、无服务暂停；无 AI runner，也没有完整的取消/重试管理和 S05b。无服务定稿会真实入队三项任务，再置为 `paused/no_service`；当前暂停检查以“没有任何模型服务记录”为条件。已有服务时不代表任务会被执行，`no_key/notice/offline` 等暂停和自动恢复尚未实现。
- S08、S09、S10 及子页：描写助手、候选、AI 伙伴尚未实现，选区操作目前仅保留入口检查/阶段提示。
- S07c、S11–S14a：档案速查、条目及关系、记忆审核、冲突处理尚未实现。`proposals.ts` 仅待审核计数，`conflicts.ts` 仅章节冲突读取。
- S15 及子页：设置、完整回收站、备份恢复、TXT/Markdown 导出、系统分享尚未实现。`trash.ts` 已有作品/章节恢复和 30 天清理；档案条目恢复、完整回收站操作尚未完成。
- 图片封面、图片来源 D06 暂未实现，本阶段只做文字书封。

建议下一块从 S02 + 模型服务写入/系统安全存储开始，随后按 G03 建立可验证的模型请求层；具体继续哪块仍以用户下一次安排为准。不要接入服务器或把 API Key 写进 SQLite、日志和备份。

## 检查与设备验证

最后一次代码检查：`npm run check` 全通过，**13 个测试套件 / 104 项测试，ESLint 无警告，TypeScript 通过**。测试在 `__tests__/`，数据库辅助在 `__tests__/helpers/db.ts`（Node SQLite，仅测试使用）。

Android Debug 构建成功，并在用户已有的 Android Studio **Pixel 10 Pro** AVD 实际验证：离线创建、正文保存、撤销重做、手动版本、定稿/任务暂停、版本对比与恢复、标题全选和键盘、章节跨空卷拖动、删除撤销、冷启动数据保留。完整记录见 [验证报告](validation/2026-10-18-core-writing.md)。

设备保留本轮测试作品 `Pixel Smoke 20261018`：第一卷一章（86 字、有修改未定稿），`Second Volume` 两章（21 字与空章），删除测试已撤销。保留此作品与其他已有数据，不使用 `adb clear`、卸载或重建 AVD 作为常规排错手段。

iOS 尚未运行；中文输入法组合输入、低端设备 2 万字以上长章性能、真实磁盘耗尽、系统杀进程边界尚需后续设备验证。

## 下一会话开始时

先执行并核对当前事实，避免按旧提交重新开发已完成内容：

```sh
git log -10 --oneline
git status --short
source scripts/dev-env.sh
npm run check
```

Android 继续验证可复用 `Pixel_10_Pro`（API 37.2 / Google Play 16 KB / arm64-v8a），先检查设备和 Metro 是否仍在运行；不要重复开启占用同端口的服务：

```sh
source scripts/dev-env.sh
adb devices
curl http://127.0.0.1:8081/status
# Metro 未运行时，在独立终端执行：
npm start -- --host 127.0.0.1
# 另一个终端：
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 shell am start -n com.novelcreationpartner/.MainActivity
```

需要重新构建时：

```sh
source scripts/dev-env.sh
cd android
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
```

完整环境说明见 [Android Studio 指南](ANDROID_STUDIO.md) 和 [开发环境指南](DEVELOPMENT.md)。`/tmp` 中的截图、UI 脚本和数据库副本都是临时验证产物，不是交接依赖。

继续遵守用户要求：中文简洁交流；严格按详细设计；发现设计与实现需调整时先改设计并说明；尽量保留已有工作，只修已确认的问题；每块通过 `npm run check` 后用英文 conventional commits 提交；不 push；完成后更新本文及设备验证记录。
