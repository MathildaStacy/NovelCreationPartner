# Pixel 10 Pro 合并前验收 · 2026-10-19

本轮按作者最新授权完成当前切片的本机验收、必要修复与本地 main 收口，不扩展 A–E 的后续范围，不 push。实现仍以详细设计、G01–G03 与 G04 明确修订为准。代码基线为 `2067d4d`，本轮仅修正 S15 的安装版本来源，以及跨日期失效的编辑器测试选择器。

## 环境与数据保护

- 本机已有 `Pixel_10_Pro` AVD，`emulator-5554`，Android 17 / API 37 / arm64-v8a / 1280 × 2856。启动参数 `-no-snapshot-save`，未 wipe、卸载或清应用数据；测试时屏幕超时设为 30 分钟。
- `source scripts/dev-env.sh`：Node 24.22.0，JDK 17。正常 `assembleRelease` 成功，首次 3 分 21 秒 / 355 tasks；S15 修复后再次成功，34 秒 / 355 tasks。使用普通 `index.js` 的内置 bundle，正常 Release 启动不依赖 Metro。
- 最终 Release APK SHA-256：`ded6671c08bc7efee4c6eff0c3a87d95f918e11dbc8eb99698ba082953677930`。
- 安装前通过旧 Debug 包的 `run-as` 备份数据库。原库 schema 2，1 部作品、3 章、0 个模型服务。`adb install -r` 升级后 schema 13，逐项比较原有 3 章的 ID、work ID、标题与正文，完全一致。没有把数据库复制回 App 或用 SQL 改业务数据。
- 为读取实际导出文件及升级后数据库，临时覆盖安装已有 Debug APK，在启动前 `run-as tar` 只读取数据库、封面与导出 cache；随后恢复正常 Release。读取不会执行启动清理或业务写入。备份文件仅在本机 `/tmp` 留存，不提交包含应用数据的文件。
- 所有新增业务操作限定本次测试作品 `Pixel Merge Validation` 和其恢复副本；原有 `Pixel Smoke 20261018` 正文未修改。

## 实际 Release 界面与 SQLite 结果

| 操作 | 实测结果 |
| --- | --- |
| S01 引导与跳过模型配置 | 可进入书架；原有作品与 3 章可见 |
| 创建独立作品、章节、输入正文 | `Mira reaches the lighthouse. The silver key opens the door.` 显示 50 字；保存中转为已保存 |
| 描写助手未配置模型 | 正确显示 D03；“不用 AI，继续写”返回，无自动绑定或发送 |
| 无模型服务时定稿 | 预览显示无服务/费用未知；作者确认后已定稿，3 个整理任务暂停；版本历史显示当前定稿 |
| 新建人物与字段历史 | Mira、别名 Keeper、摘要与身份 Lighthouse keeper 保存可见；字段版本显示手动、始终有效 |
| 档案实际原生检索 | `Kee` 三字查询命中别名，`Mi` 两字短查询命中名称；原生 FTS5 迁移与启动正常。中文组合输入、全部字段按章编辑/重排不在本轮设备覆盖内 |
| S12c 无服务补全 | 显示 1–5 字段选择；预览触发 D03，取消后返回，不自动请求 |
| 系统照片选择 | Photo Picker 取消不改封面；选择仓库现有 192 × 192 PNG 后生成私有 JPEG，192 × 192 / 6232 bytes；再次取消选择后强停重启，图片仍显示 |
| 强停重启后写作 | 已保存正文、50 字、已定稿及定稿版本保留。未验证输入尚未落盘的强杀边界 |
| TXT / Markdown 导出 | 真实 Android chooser 显示带书名/章名的 `.txt` / `.md`；实际 cache 文件 103 / 108 bytes，读取并核对正文包含完整测试句 |
| 备份导出 | chooser 显示 `.ncpbak`；实际文件 7246 bytes，ZIP 含 manifest.json、data.json 和 JPEG 附件 |
| 备份选择取消 | 系统 ACTION_OPEN_DOCUMENT 返回原恢复页，无新增作品 |
| 实际备份恢复 | 将本次导出原件复制至 Downloads，从系统选择器选择，预览后确认，新增 `Pixel Merge Validation（恢复）`；原作品未覆盖 |
| 恢复内容与新 ID | 真实 SQLite 核对新 work/chapter/entry/cover token ID，正文、别名、定稿版本保留；恢复人物详情与图片在界面可见。封面导入按设计再次 JPEG 规范化，192 × 192 / 6239 bytes，像素各通道平均绝对差约 0.938 / 0.541 / 0.195，不要求有损编码字节相同 |
| 回收站 | 仅将本次恢复副本经 UI 软删除，实际显示 1 项；恢复后为空，作品及封面仍可见；未清空或永久删除 |
| 设置与关于 | 原生版本 1.0 / 构建 1，实际存储显示从约 1.4 到 1.5 MB；默认描写候选 1；可打开 488 项离线许可列表并看到 1 项缺文提示 |
| 修复后正常包复验 | S15 副标题与关于页同为安装版本 1.0，读取失败的测试明确显示“版本信息不可用”，不回退 JS package 0.0.1 |

TXT chooser 中曾选择系统 “Save” 接收项，该接收项提示 “Can't save text. Try saving a link instead.”。App 的分享契约仅报告 chooser 已打开，本轮不把接收方持久保存标为通过；未发送至 Gmail、云盘或其他人。

最终本地库为 schema 13，3 部活动作品、5 个活动章节、2 个活动人物条目；`ai_attempts` 为 0。新增测试作品保留供作者查看。原有 3 章再次逐项比较仍完全一致。

## 独立 Debug 原生探针

使用专用 Metro 8088、设备 8081 reverse 到 8088，fixture 8765/8766，仅访问受控 localhost，凭据是随机无效临时值。探针结果：

```json
{
  "secureRoundTrip": true,
  "secureRemoved": true,
  "incremental": true,
  "utf8": true,
  "abort": true,
  "redirectsBlocked": [301, 302, 307, 308],
  "sinkRequests": 0,
  "sinkWithAuth": 0,
  "abortedHolds": 1,
  "noImplicitRetry": true,
  "retryAfterPreserved": true
}
```

主机 `curl http://127.0.0.1:8765/stats` 核对：`sinkRequests=0`、`sinkWithAuth=0`、`abortedHolds=1`、`unavailableGets=1`、`unavailablePosts=1`。本次完整设备日志扫描没有 `invalid-probe-` 临时值标记，也没有指向本 App 的 AndroidRuntime fatal 块；这不能代替所有原生安全日志与生命周期验收。全局日志中其他系统进程的崩溃不归为 App 崩溃。

测试后停止本次 fixture/Metro，移除本次全部 ADB reverse，再次装回普通 Release；模拟器保留运行、书架可打开。探针与真实 App 数据操作分别记录，未调用真实模型或收费服务。

## 工程检查与修复

- 设备发现设置页仍显示 JS package 的 0.0.1，而关于页按原生包显示 1.0。现统一经 `features/appInfo.get()` 读取安装版本，失败明确未知，保持 UI → features 边界；新增原生版本一致与未知回退的 2 项回归测试。
- 首次全量检查跨过午夜后，4 个编辑器恢复测试因固定匹配“今天”失败，实际版本列表正确显示“昨天”。选择器现按版本行的时分与字数匹配，保留恢复、旧会话保护和撤销断言；没有修改产品日期逻辑。
- 最终 `source scripts/dev-env.sh && npm run check`：63 suites / 573 tests，ESLint / TypeScript 通过；`git diff --check` 通过。Android 最终 Release 的生产代码与本次安装包一致；测试和文档不进入 APK。
- 本地证据：`/tmp/novel-pixel-release-build.log`、`/tmp/novel-pixel-release-final.log`、`/tmp/novel-pixel-check-final.log`、`/tmp/novel-pixel-probe-stats.json`。临时文件不保证跨机器持久存在，关键命令、结果和边界已记入本文。

## 保留的发布与设备缺口

iOS 缺完整 SDK，仍未编译链接或运行；真实模型效果/成本未测。Release 私网 IPv4 HTTP、`.local` / ATS、真实 HTTPS、锁屏/挂起/请求中强杀恢复，云照片/云盘、近上限文件内存、低存储、长列表性能与大字布局没有完整验收。Debug localhost 探针不解除这些 gate，不放宽全局明文策略。

`ansi-fragments@0.2.1` 完整项目许可来源缺口仍存在，许可生成仍按已有证据保持失败；本地 main 合并不等于商店发布或全部 MVP 验收通过。下次只按作者选择推进一个明确小切片，见[最新交接](../implementation/2026-10-18-resume.md)。
