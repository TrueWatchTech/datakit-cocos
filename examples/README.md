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

## Shared acceptance (Creator 2.x / 3.x)

Both projects use one functional acceptance checklist without duplicating cases
by engine version. The main samples target Creator 2.4.15 and 3.8.8; the 2.4.9
compatibility package also follows this checklist. Record the actual engine,
OS, device, SDK build version, and result for each run. Results from one version
or platform cannot substitute for another.

Native home → **Open Cocos Page** → **Open Starport Game** → Hangar → Stage
selection → Battle → Pause/resume → Results → Hangar → **Back to Sample** →
**Native page**. Game pages are logical pages within one Cocos Scene. They
manually switch RUM Views using `Starport/Lobby`, `Starport/StageSelect`,
`Starport/Battle`, `Starport/Results`, and `Starport/Settings`. This verifies page
and Replay transitions; it does not replace dedicated engine `loadScene`
automatic tracking checks.

Shared configuration: Hybrid, 2 FPS, longest edge 720, medium quality, 40 KiB
maximum per frame, and touch points set to show. The game, HUD, and home page
use the same application camera. The 2 FPS setting is a Replay sampling target,
not the game frame rate; static-frame deduplication, encoding limits, and device
load may lower the actual upload frame rate.

| ID | Steps (both generations) | Expected result (both generations) |
| --- | --- | --- |
| A01 | Cold start, tap Native Auto Network, and open Cocos; make 3 round trips | Native/Cocos View and Replay ownership is correct, with no duplicate initialization, black screens, stale frames, or continued capture of a page after leaving it |
| A02 | Tap Auto Network and Manual Trace once each | Automatic and manual requests each produce one Resource with the correct method, status, and duration; Trace propagation headers and Resource correlation match the configuration, without duplicate collection |
| A03 | Tap RUM + Log and RUM Error once each | Action, Error, and correlated Log data are searchable with correct View/session correlation; action names match across generations, and `creator_generation` identifies the build |
| A04 | Tap Replay change 3 times, waiting 2 seconds each time | Colors appear in the same order on the physical device and in Replay; touch positions are correct, with no stale frames replayed out of order |
| A05 | Inspect all three privacy probes; move/scale, toggle fit, apply both, then restore | All three tokens are visible on the physical device; Replay shows gray/black/gray with no text leakage; all 12 green edges, both KEEP ME labels, public text, and buttons remain visible without mask spillover; outward projection rounding of less than 1 pixel is allowed |
| G01 | Open the game; switch weapons in the hangar, set sound preferences and return; select one of 3 stages | Ship animation continues; weapon, sound, and selected-stage feedback is correct; local weapon, sound, and reward saves persist after reopening the game |
| G02 | Start a mission; hold the stick center, then drag left, right, up, down, and diagonally, releasing each time; hold attack simultaneously; use dash and repair | No center drift; movement follows the stick and stops on release/cancel; a second finger does not steal the movement touch; auto-aim, projectiles, pursuit, collision damage, energy, and cooldowns work correctly; repair caps health at 100 |
| G03 | Pause battle for 5 seconds, resume, and restart; then background for 5 seconds and return | Enemies, projectiles, and timers stop while paused; no stuck keys/touches remain after resuming; restart clears the previous round; returning from the background keeps the game paused until the user resumes |
| G04 | Clear three waves and defeat the guardian; in another round, do not attack and wait for defeat | Both victory and defeat open results; kills, crystals, time, and rewards are correct, with rewards credited once; retry, next stage, and hangar buttons work |
| G05 | Battle for at least 60 seconds, complete G02–G04, then inspect Replay for the same session | Hangar, battle, HUD, pause overlay, and results are visible; action order, touches, health, and visual changes match; events such as `battle_start`, `pause`, `resume`, and `battle_complete`, plus Logs, correlate with the current Starport View |
| G06 | Exit to the sample home, reopen the game, then exit and return to native; repeat 3 times | No duplicate input listeners or leftover game layers/audio; home-page privacy probes work again, and the Replay camera and native ownership are restored |
| P01 | Use the same device, stage, weapon, and movement route; run 3 rounds each with recording disabled/enabled, at least 60 seconds per round | Save frame-time plots, P95/P99, counts above 50/100 ms, and environment details; check periodic spikes and visual stalls. Smooth simulator or dedicated 3D performance does not establish physical-device battle acceptance |

For the control build with recording disabled, keep the same RUM/Log/Trace
configuration and remove only `replay` from the sample's `attach` options. Do not
use `leaveCocos()` as a recording toggle: it also changes Hybrid ownership.
Record initial asset loading and steady-state battle separately, support
performance conclusions with actual data, and mark unmeasured items as
"Unverified". Keyboard controls also support WASD/arrow keys, Space to attack,
Shift to dash, E to repair, and Esc to pause.

Network buttons request httpbin by default and only verify propagation headers
and Resources. APM Trace acceptance requires a backend with APM and explicit JS
versus native network collection ownership to avoid duplicate collection.
Privacy cases verify rectangular boundaries; they do not establish support for
arbitrary outlines, transparent occlusion, or multi-camera composition.

### Separate checks for platform differences

| Scope | Check | Reason for separate coverage |
| --- | --- | --- |
| Creator 2 | Extra: camera 2D/3D | Camera-node switching with `is3DNode` and its privacy projection use 2.x APIs |
| Creator 3 | Extra: 3D Replay scene | Perspective MeshRenderer geometry, occlusion, and an independent UI camera; verify 3D with the HUD hidden, and record the current single-camera Replay limitation that omits the independent HUD when visible; this does not count as successful full-screen composition |
| Creator 2 / Android | Native-page Cocos HTTP 200 / 404 | The 2.x Cocos2dxHttpURLConnection and separate `:cocos` process path differ from 3.x lifecycle and network implementations |
| iOS (both generations) | NSURLConnection toggle, CocoaPods/SPM | Additional checks depend on platform/dependency management, with shared criteria for both generations. Cocos XHR uses NSURLConnection in 2.x and NSURLSession in 3.x |

See each project's README for specific steps; shared cases are maintained only here.

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

### Shared game source

`acceptance-game/` is the single source for game rules, layout, and sound effects.
Each project's `StarportScene.ts` only adapts engine drawing, input, lifecycle,
and audio. `npm run setup` copies the shared source automatically. After editing
it, run `npm run samples:sync` at the repository root, then export both projects
again. Do not edit the generated `assets/acceptance-game/` directories.
`node scripts/sync-sample-game.mjs --check` verifies both generated copies match.

Legacy diagnostic projects, copied SDKs, traffic benchmarks, and synthetic upload
tools remain local files and are not part of the maintained samples.
