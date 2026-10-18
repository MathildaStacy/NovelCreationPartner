# 模型接入原生验证（更新至 2026-10-19）

初始记录基线为 `fe491f1`，当时按作者要求未运行 Android/iOS 构建或设备验证。2026-10-18 至 19 日已按最新授权补做 Android 构建、正常 Release 离线流程及 Debug 受控传输探针，结果见下方。原生源码及 Codegen 生成成功本身不代表原生编译/运行通过，也不代表真实模型连接成功。

## 已检查的事实

- Node 24.22.0；安全存储新增锁定依赖 `react-native-keychain@10.0.0`，其余依赖版本未更新。
- RN 0.87.1 的 iOS `RCTHTTPRequestHandler.mm` 在 redirect delegate 中调用 `completionHandler(nextRequest)`；Android `NetworkingModule` 使用默认 OkHttp client。内置 XHR 的 JS 回调不能在下一跳前拒绝所有重定向。
- 采用 G03 允许的应用专用 TurboModule：Android 独立 OkHttp（两种 redirects=false、关闭自动重试/Cookie/cache），iOS ephemeral NSURLSession（redirect completionHandler(nil)、无 Cookie/cache/credential storage）。不修改全局 RN 网络策略和依赖源码。
- JavaScript 单元测试仅证明包装层分段、UTF-8 边界、取消和订阅释放；不证明两端原生行为。
- 原生复核修正请求注册/abort/invalidate 竞争；Android 禁用认证挑战与重复 exchange，额外抑制 OkHttp 对 `503 + Retry-After: 0` 的内部重发（保留真实响应头给 JS）。源码审查不是设备验收，受控探针增加 GET/POST 各一次计数。
- Android Release 当前不放行局域网明文 HTTP；iOS 保留 `NSAllowsArbitraryLoads=false / NSAllowsLocalNetworking=true`。没有放宽安全边界。**Release 数字私网 HTTP/ATS 是待决风险**，不能声称已完成。原生桥对 HTTPS 正常证书验证不设例外。
- `android:allowBackup=false` 保持；iOS Keychain 使用 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`，不启用云同步；Android 使用 AES-GCM Keystore。

## 本机操作（不卸载、不清现有数据库）

1. `source scripts/dev-env.sh`；在终端运行 `node scripts/model-probe-server.cjs`。服务监听 8765/8766，输出只含端口，`/stats` 只含计数，不记录请求头、凭据或正文。
2. Android：`adb reverse tcp:8765 tcp:8765` 及 `adb reverse tcp:8766 tcp:8766`；先以 `npm start -- --config metro.model-probe.config.js --reset-cache` 启动专用 Metro（已运行普通 Metro 时先停止），再 `npm run android -- --mode debug --no-packager` 构建探针。Release 使用 `ENTRY_FILE=index.model-probe.js npm run android -- --mode release`。普通应用入口仍为 `index.js`，不导入探针。
3. iOS：按开发指南执行 `bundle exec pod install`；Xcode 打开已有 workspace，Debug 复用上一步专用 Metro；Release 用 `ENTRY_FILE=index.model-probe.js xcodebuild -workspace ios/NovelCreationPartner.xcworkspace -scheme NovelCreationPartner -configuration Release -destination 'id=<设备 UDID>'`（按本机签名配置安装）。真机地址填 `http://你的电脑名.local:8765`，与电脑同网；不要填真实服务或真实 Key。
4. 点击“运行探针”。它只创建随机无效临时 Key，核对系统存取，向受控端点收取分段和 UTF-8，取消一条 hold 请求，再逐个测试 301/302/307/308 和 GET/POST 的 503。预期 `secureRoundTrip/secureRemoved/incremental/utf8/abort/noImplicitRetry/retryAfterPreserved=true`、`redirectsBlocked=[301,302,307,308]`、`sinkRequests=0 / sinkWithAuth=0`、`abortedHolds>=1`、`unavailableGets=1 / unavailablePosts=1`。在电脑打开 `http://127.0.0.1:8765/stats` 复核。重复测试前重启 fixture 清计数。
5. 分别验证 Android/iOS Release 的 `.local` 与私网 IPv4 HTTP、HTTPS 分段到达、取消、后台挂起后返回。HTTP 因平台策略失败时保留失败，不改成测试成功。Release 上述五项都通过才可解除原生 gate。
6. 锁屏/解锁分别验证安全存取与缺失槽位；捕获系统日志时检索运行时临时值，检查 Keystore/Keychain 与 HTTP 原生调试无泄露。不要使用真实 Key 或将临时值写进验证文档/截图。进程在探针中途终止可能留下无效临时槽位，需用该平台凭据调试工具确认并清除 `NovelCreationPartner.model.probe-*`；不清业务凭据。
7. 完成后停止专用 Metro、重新用普通 `npm start` 启动，正常构建不再传 ENTRY_FILE；停止 fixture，保留写作数据库。普通 `npm run check` 继续可用。

## 需转发 Astra 的决策（有证据后处理）

证据：设计接受用户任意私网 IPv4、localhost、`.local` 的 HTTP；Android 只能静态配置域名明文例外，无法用 XML 表达全部动态 CIDR，当前 Release 默认拒绝；iOS 本地 ATS 配置对数字 IP 的不同 OS 行为需真机确认。

选项：A. 保留仅 HTTPS 与能被平台现有策略接受的本地地址，缩小 S02 校验承诺；B. 允许应用级 cleartext 网络策略，所有模型流量仍必须经过本地 URL 校验与禁重定向传输；C. 对指定已验证地址提供更受限的原生明文传输。

推荐：先提交两端 Release 探针结果；若确需动态数字私网 HTTP，审查 B 的平台影响后更新 G03/S02，再实现。当前不采用 B、不改变设计、不把平台阻碍伪装为完成。

## 当前验收状态

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 见最新 resume.md 及本次 Pixel 验收记录 |
| RN 0.87.1 两端 Codegen | 已生成（临时输出目录；不提交生成产物） |
| Android 编译与打包 | Debug、正常 Release 均通过；Release 覆盖安装运行通过 |
| Android Debug 增量、UTF-8、abort、禁重定向与无隐式重发 | Pixel_10_Pro 受控 localhost 探针通过；非真实模型 |
| iOS 编译与设备传输 | 缺完整 iOS SDK，未执行；Codegen 不解除此项 |
| Release HTTP/ATS、HTTPS 传输、锁屏与完整生命周期、原生日志泄露检查 | 未全面验收；Debug 探针不解除这些 gate |
| 官方/兼容网关真实 ping | 未执行，无真实凭据 |

## Android 受控探针实测 · 2026-10-19

设备为本机 `Pixel_10_Pro` AVD，`emulator-5554`，Android 17，1280 × 2856。代码为 `2067d4d` 加设置版本来源修复。正常 `assembleRelease` 首次成功耗时 3 分 21 秒，修复后再次成功耗时 34 秒、355 tasks；正常 Release 使用内置 JS bundle，覆盖安装保留原数据，无 Metro 依赖。完整离线验收见 [Pixel 合并前验收](2026-10-19-pixel-merge.md)。

模型传输另外使用 Debug APK、专用 Metro 8088 和受控 localhost fixture：设备 8081 reverse 到主机 8088，8765/8766 reverse 到 fixture。只使用随机无效临时 Key，没有访问真实模型或收费服务。

| 探针结果 | 实测 |
| --- | --- |
| `secureRoundTrip / secureRemoved` | `true / true` |
| `incremental / utf8 / abort` | `true / true / true` |
| `noImplicitRetry / retryAfterPreserved` | `true / true` |
| `redirectsBlocked` | `[301, 302, 307, 308]` |
| `sinkRequests / sinkWithAuth` | `0 / 0` |
| `abortedHolds` | `1` |
| `unavailableGets / unavailablePosts` | `1 / 1` |

fixture 的 `/stats` 已通过主机 curl 复核。测试后已停止本次 fixture/Metro、移除本次全部 reverse，并装回正常 Release，未卸载或清除应用数据。这验证 Android Debug 受控地址上的原生传输与系统安全存取；不证明 Release 的私网 HTTP、`.local`、HTTPS 证书/传输或 iOS 行为，不证明锁屏、后台挂起及进程终止等完整生命周期，也不代表真实模型效果或许可发布 gate 已通过。正常 Release 对私网 HTTP 的既有平台限制保持待决，没有放宽全局安全策略。
