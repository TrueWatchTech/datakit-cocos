# Cocos Hybrid integration samples

The repository maintains one Hybrid integration sample for each supported
Creator generation. Each project opens directly in Creator and installs
`@truewatchtech/cocos-sdk` from `file:../../packages/cocos`.

| Project | Creator version | Instructions |
| --- | --- | --- |
| `hybrid-creator2/` | 2.4.15 | [Creator 2 setup and validation](hybrid-creator2/README.md) |
| `hybrid-creator3/` | 3.8.8 | [Creator 3 setup and validation](hybrid-creator3/README.md) |

Both projects demonstrate the same integration flow: the native host starts
the SDK, opens Cocos, then receives RUM View and Session Replay ownership when
the user returns to the native page. Buttons validate RUM Actions and Errors,
linked Logs, automatic network collection, manual Trace/Resource collection,
Replay visual changes, and privacy masking.

Creator-specific code covers engine APIs, Android lifecycle differences, and
Replay camera/layout checks. SDK bridges and build extensions are installed
by each project's `npm run setup` command.

## Configure and run

Follow the matching project's README for `setup`, `configure`, Creator build,
and `native:install`. Credentials are generated from `SAMPLE_*` environment
variables into ignored files under that project's `native-host/` directory.

From the repository root, `npm run sample:configure` configures Creator 3 by
default. To configure Creator 2 from the root, use:

```bash
npm run sample:configure -- --native-host-dir examples/hybrid-creator2/native-host
```

Hybrid validation requires an Android or iOS build. Editor/browser preview
does not have a native SDK instance to attach to.

## 统一验收（Creator 2.x / 3.x）

两个项目使用同一套功能验收，不按引擎版本重复维护用例。当前主示例版本为
Creator 2.4.15 和 3.8.8；2.4.9 兼容包也执行这张表。验收记录必须填写实际引擎、
OS、设备、SDK 构建版本和结果，不能用一个版本或平台的结果代替另一列。

原生首页 → **Open Cocos Page** → **Open Starport Game** → 大厅 → 选关 →
战斗 → 暂停／继续 → 结算 → 大厅 → **返回验收主页** → **Native page**。
游戏页面为同一 Cocos Scene 内的逻辑页面，以 `Starport/Lobby`、
`Starport/StageSelect`、`Starport/Battle`、`Starport/Results`、`Starport/Settings`
手动切换 RUM View。它验证页面与回放切换，不替代引擎 `loadScene` 自动采集专项。

共同配置：Hybrid、2 FPS、最长边 720、medium、单帧上限 40 KiB、触点 show。
游戏、HUD 和主页使用同一业务相机。2 FPS 是回放采样目标，不是游戏帧率；
静态去重、编码限制和设备负载可能使实际上传帧率更低。

| ID | 操作（两代相同） | 验收结果（两代相同） |
| --- | --- | --- |
| A01 | 冷启动，Native Auto Network，打开 Cocos；往返 3 次 | Native/Cocos View 和 Replay 归属正确，无重复初始化、黑屏、旧帧或继续采集已离开的页面 |
| A02 | Auto Network、Manual Trace 各点击一次 | 自动请求与手工请求分别产生一个 Resource；方法、状态、耗时正确，Trace 传播头和 Resource 关联符合配置，无重复采集 |
| A03 | RUM + Log、RUM Error 各点击一次 | Action、Error、关联 Log 可检索，View/session 关联正确；动作名两代相同，`creator_generation` 区分构建 |
| A04 | Replay change 连点 3 次，每次停留 2 秒 | 真机画面和回放颜色顺序一致；触点位置正确，无过期帧倒放 |
| A05 | 查看三个隐私探针；依次移动缩放、切换 fit、同时应用两者，再还原 | 真机三个 token 可见；回放灰／黑／灰，无文字泄漏；12 条绿色边、2 个 KEEP ME、公开文字和按钮保持可见，无扩散遮挡；允许投影向外取整不足 1 像素 |
| G01 | 打开游戏；大厅切换装备，设置音效后返回；选择 3 个关卡之一 | 飞船动画持续；装备、音效与选中关卡反馈正确；重进游戏后本地装备／音效／奖励存档保留 |
| G02 | 开始行动，先按住摇杆中心，再分别向左、右、上、下和斜向拖动，每次松手；同时按住攻击；使用闪避和修复 | 中心无漂移，角色方向与摇杆一致，松手／取消触点后停止；第二根手指不抢占移动触点；自动瞄准、弹道、追击、碰撞扣血、能量和冷却正确；修复最多恢复到 100 |
| G03 | 战斗中暂停 5 秒、继续、重新挑战；再切后台 5 秒后回前台 | 暂停期间敌人、弹道、计时不推进；恢复后无遗留按键／触点；重开清空上一局；后台返回保持暂停，用户继续后恢复 |
| G04 | 完成三波并击败守卫；另一次不攻击直至失败 | 胜利／失败均进入结算；击破、晶体、时间和奖励正确，奖励只入账一次；重试／下一关／大厅入口可用 |
| G05 | 战斗持续至少 60 秒，完成 G02–G04，再查看同一 session 的 Replay | 大厅、战斗、HUD、暂停层和结算都可见；动作顺序、触点、血量和画面变化对应；`battle_start`、`pause`、`resume`、`battle_complete` 等事件和 Log 关联当前 Starport View |
| G06 | 游戏退出至验收主页，重开游戏，再退出并返回原生；重复 3 次 | 无重复输入监听、残留游戏图层／音效；主页隐私探针重新生效，回放相机和原生归属恢复 |
| P01 | 相同设备、关卡、装备和操作路线，分别测试关闭／开启录制各 3 轮，每轮至少 60 秒 | 保存帧耗时曲线、P95/P99、超过 50/100 ms 的次数及环境；检查周期性尖峰和画面停顿。模拟器流畅或 3D 专项流畅不代表真机战斗验收通过 |

关闭录制的对照包保留同样的 RUM／Log／Trace 配置，仅移除样例 `attach` 的 `replay`
配置；不要使用 `leaveCocos()` 当作录制开关，它会连同 Hybrid 归属一起改变。
首次资源加载与稳定战斗分别记录，性能结论附实际数据；尚未测量的条目标记“未验证”。
键盘也支持 WASD／方向键、空格攻击、Shift 闪避、E 修复、Esc 暂停。

网络按钮默认请求 httpbin，只能验证传播头和 Resource。APM Trace 验收需换成有
APM 的后端，同时明确 JS 与原生网络采集归属，避免双重收集。隐私用例验证矩形边界，
不代表任意图形轮廓、透明遮挡或多相机合成。

### 仅差异项另列

| 范围 | 专项 | 区分原因 |
| --- | --- | --- |
| Creator 2 | Extra: camera 2D/3D | `is3DNode` 相机节点切换及隐私投影是 2.x API |
| Creator 3 | Extra: 3D Replay scene | 透视 MeshRenderer、遮挡和独立 UI 相机；HUD 隐藏时验证 3D，显示时记录当前单相机回放不包含独立 HUD 的限制，不能算全屏合成通过 |
| Creator 2 / Android | 原生页 Cocos HTTP 200 / 404 | 2.x 的 Cocos2dxHttpURLConnection 和独立 `:cocos` 进程路径，与 3.x 生命周期及网络实现不同 |
| iOS（两代） | NSURLConnection 开关、CocoaPods／SPM | 按平台／依赖管理方式补充；两代共用标准。Cocos XHR 底层分别为 2.x NSURLConnection、3.x NSURLSession |

具体差异操作见各项目 README；共同用例仅在此维护。

### iOS NSURLConnection automatic collection

The sample and bridge use TrueWatchSDK **1.6.8-alpha.5**. To exercise the legacy
network API, add `-SampleURLConnection YES` to the Xcode scheme's launch
arguments, rebuild, and click **Native Auto Network**. This calls
`sendNativeURLConnectionRequest()` and enables both
`FTRumConfig.enableTraceURLConnectionResource` and
`FTTraceConfig.enableAutoTraceURLConnection`. Neither flag is enabled by default.
Use `-SampleURLConnection NO` to return to the default NSURLSession request.

Match `layer=native-urlconnection` and the unique `request_id` in the URL against
the uploaded RUM Resource. Confirm one Resource per request, HTTP method/status,
duration, and Trace identifiers; a successful HTTP response alone does not prove
Resource collection.

Cocos JS automatic tracking and native tracking can collect the same XHR twice.
Creator 2.4.9/2.4.15 uses NSURLConnection; Creator 3.8.8 uses NSURLSession.
For the NSURLConnection probe, the native button bypasses JS tracking. Before
also exercising Cocos **Auto Network** with native collection enabled, disable
`autoTrack.network` to let the native layer own those requests. The manual
Resource button still reports explicitly: saved XHR methods only bypass JS
instrumentation, so native collection can duplicate that manual Resource too.
For production, choose one collection owner for each request path; preserve
native collection for independent host requests where possible.

### Using Swift Package Manager on iOS

Set `ios.dependencyManager` to `"spm"` in a project-root
`cocos-sdk.config.json` before rebuilding in Creator, then run the existing
`native:install` command with your iOS build directory. Both the SDK bridge and
native sample host are linked through SPM. Open the generated `.xcodeproj` for a
fresh project; CocoaPods is only needed when migrating an existing Pods
installation or managing other host dependencies. See the root README for the
configuration and migration details.

### 共用游戏源码

`acceptance-game/` 是游戏规则、布局与音效的唯一来源。各项目的 `StarportScene.ts`
只适配引擎绘图、输入、生命周期和音频。`npm run setup` 自动执行复制；修改共用源码后，
在仓库根运行 `npm run samples:sync`，再重新导出两个项目。不要编辑生成的
`assets/acceptance-game/`。`node scripts/sync-sample-game.mjs --check` 检查两份生成资产一致。

历史诊断工程、复制的 SDK、流量基准和合成上传工具仍保留为本地文件，不属于正式样例。
