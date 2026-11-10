# Changelog

## 0.1.1

Stable release consolidating the changes in `0.1.1-alpha.1` through `0.1.1-alpha.5`.

### Features

- **Web support**: Add Web Mobile and Web Desktop integration for Creator 2 and Creator 3, including automatic scene and action tracking, errors, logs, network collection, and trace correlation. Configure native and Web collection through shared project settings.
- **Web Session Replay**: Add optional canvas recording with sampling, capture frequency, image quality, dimensions, and per-image size limits. Canvas capture is blocked by default; protected nodes and input fields block the entire canvas instead of applying native node-level masks.
- **Native WebView configuration**: Forward `sdk.allowWebViewHost`, `rum.enableTraceWebView`, and `logger.enableWebViewLog` to Android and iOS. WebView RUM is enabled by default; WebView logs are disabled by default.
- **Native JavaScript errors and diagnostics**: Capture JSB errors and supported unhandled Promise rejections while preserving engine handlers. Add the standalone `scripts/collect-cocos-env.cjs` troubleshooting tool with local-only collection and redacted customer-specific labels.

### Fixes and improvements

- **Request compatibility**: Preserve application `fetch` and `XMLHttpRequest` arguments, options, existing trace headers, callbacks, and error behavior. Monitoring failures do not interrupt or retry requests, and stopping collection preserves host wrappers.
- **Native Replay rendering and lifecycle**: Correct Creator 2 render-target setup and pixel readback, separate capture handoff from display rendering, preserve camera clearing and alpha, and prevent display trails. Cancel deferred work when recording stops. Preserve full-window dimensions and emit resize events on rotation.
- **Native Replay privacy and touches**: Correct projected and clipped privacy bounds for perspective cameras, particles, meshes, and animated skinned meshes. Reject frames when protected geometry cannot be resolved safely. Keep queued touches associated with their original application, session, and View.
- **Automatic errors and logs**: Deduplicate identical native errors within the same View. Use a bounded console queue and exclude marked internal SDK diagnostics from automatic collection while preserving explicit manual reporting.
- **Creator compatibility and samples**: Correct Creator 2 scene API usage and embed sources in Creator 2 source maps. Improve Creator 2/3 rendering, input, layout, privacy, WebView, and 3D sample coverage. Keep Creator 2 hybrid navigation in one process; preserve Android reflection entry points and fix iOS dependency integration.

### Migration and dependencies

- Upgrade `@truewatchtech/cocos-sdk` and optional `@truewatchtech/cocos-session-replay` together to `0.1.1`. Rerun the SDK installer with `--replay` or `--no-replay`, regenerate the native project, and rebuild. Hybrid sample users should also rerun `native:install`.
- Upgrade Android Session Replay to stable `0.1.10`, including the focus-callback fix that restores rendering after returning from a full-screen native Activity. Android Agent remains `1.7.6`; iOS Agent / Session Replay remains `1.6.8`.
- Web integrations require separate Web reporting settings and an application ID. Install Browser RUM / Logs `3.3.22` as needed, plus Browser WebGL `3.3.8` for Replay, and run the installer with `--web`. Initialize Web Replay before the Cocos engine. Web does not support timed Actions, manual Resource timing, manual Long Tasks, or manual trace-header generation.

## 0.1.1-alpha.5

### Fixes

- **Native Replay privacy bounds**: Correct Creator 2 perspective projection on JSB and animated skinned-mesh privacy bounds. Skip unnecessary projection checks when no protected nodes are present, while continuing to reject frames whose protected geometry cannot be resolved safely.
- **Internal SDK diagnostics**: Exclude marked SDK and Replay failures and SDK diagnostic console messages from automatic error and log collection on native and Web platforms. Explicit manual reporting remains available.
- **Native automatic error deduplication**: Deduplicate identical error types, messages, and stacks within the same native View, including queued reports and multiple JSB subscribers. Keep errors in different Views independent and release reservations when reports cannot be delivered.

### Improvements

- **Hybrid samples**: Simplify dashboard navigation, improve Creator 2/3 rendering and 3D validation scenes, and standardize sample UI text and documentation in English.

### Migration

- Upgrade `@truewatchtech/cocos-sdk` and optional `@truewatchtech/cocos-session-replay` together to `0.1.1-alpha.5`. Rerun the SDK installer with `--replay` or `--no-replay`, regenerate the native project, and rebuild to install the updated runtime and native bridges.
- Native SDK dependencies remain Android Agent `1.7.6`, Android Session Replay `0.1.10-alpha01`, and iOS Agent / Session Replay `1.6.8`.

## 0.1.1-alpha.4

### Fixes

- **Network request compatibility**: Preserve application `fetch` and `XMLHttpRequest` arguments, request options, existing trace headers, callbacks, and error behavior. Monitoring failures no longer interrupt or retry application requests, and stopping collection preserves wrappers installed by the host application.
- **Creator 2 scene compatibility**: Avoid Node-only API access on `cc.Scene` during scene tracking, Replay capture, privacy checks, and touch collection.
- **Creator 2 native Replay**: Separate pixel processing and storage handoff from display rendering, reduce game-thread pixel-copy overhead, preserve display alpha and camera clearing behavior, and avoid display trails. Cancel deferred work when recording stops.
- **Hybrid sample compatibility**: Correct Creator 2/3 sample API usage, media fixtures, preview initialization, and resource cleanup. Update Creator 3.8.8 rendering examples and sample-local Metal compatibility. Add the stencil buffer required by Creator 2 sample hosts while preserving custom surface creation.

### Migration

- Upgrade `@truewatchtech/cocos-sdk` and optional `@truewatchtech/cocos-session-replay` together to `0.1.1-alpha.4`. Rerun the SDK installer with `--replay` or `--no-replay`, regenerate the native project, and rebuild to install the updated runtime and native bridges. Hybrid sample users should also rerun `native:install` for their generated projects.
- Native SDK dependencies remain Android Agent `1.7.6`, Android Session Replay `0.1.10-alpha01`, and iOS Agent / Session Replay `1.6.8`.

## 0.1.1-alpha.3

### Features

- **Native WebView configuration**: Forward `sdk.allowWebViewHost`, `rum.enableTraceWebView`, and `logger.enableWebViewLog` to Android and iOS. WebView RUM is enabled by default; WebView logs are disabled by default. Omit the host list to preserve native defaults, use `null` to allow every host, or use an empty array to disable automatic Bridge use.
- **Native JavaScript errors**: Automatically capture JSB errors and runtime-supported unhandled Promise rejections while preserving the engine's original error handler.
- **Environment collection tool**: Add `scripts/collect-cocos-env.cjs` to collect local Cocos, SDK dependency, component, and native integration facts for troubleshooting. The standalone tool does not execute project code or upload reports, and redacts customer-specific version labels and build metadata.

### Improvements

- **Console collection**: Defer automatic log reporting through a bounded queue, preserve original console behavior, and prevent SDK reporting from recursively collecting itself.
- **Replay validation samples**: Expand Creator 2 and Creator 3 samples with rendering, input, motion, layout, scrolling, asset, effect, privacy, and WebView validation scenes.

### Fixes

- **Native Replay capture and rotation**: Preserve full-window dimensions and camera projection, clear fresh Creator 2 render targets, and emit viewport resize events when rotating within a View.
- **Replay touch ownership**: Keep queued touches associated with their original application, session, and View during asynchronous capture and page transitions.
- **Replay privacy bounds**: Correct clipping and projected privacy bounds, including particle and mesh renderers; skip capture when protected geometry cannot be projected reliably.
- **Hybrid native samples**: Preserve Android reflection entry points in release builds and correct Swift Package Manager dependencies and Objective-C imports for iOS.

### Migration

- Upgrade `@truewatchtech/cocos-sdk` and optional `@truewatchtech/cocos-session-replay` together to `0.1.1-alpha.3`. Rerun the SDK installer with `--replay` or `--no-replay`, regenerate the native project, and rebuild to install the updated runtime, JSB error bootstrap, and native bridges.
- Native SDK dependencies remain Android Agent `1.7.6`, Android Session Replay `0.1.10-alpha01`, and iOS Agent / Session Replay `1.6.8`. Hybrid hosts continue to configure WebView collection through their native SDK initialization.

## 0.1.1-alpha.2

### Features

- **Web support**: Add Web Mobile and Web Desktop integration for Creator 2 and Creator 3, including scene and action tracking, errors, logs, automatic network collection, and trace correlation. Web Error events include `cocos_error_state`.
- **Web Session Replay**: Add optional canvas recording with sampling, capture frequency, image quality, dimensions, and per-image size limits. Canvas capture is blocked by default; protected nodes and input fields block the entire canvas rather than applying native node-level masks.
- **Unified project configuration**: Configure native and Web collection and Replay through project settings, with shared sampling and platform-specific capture options.

### Fixes

- **Creator 2 native Replay**: Correct render-target setup and pixel readback to resolve incorrect Replay frame capture on Android and iOS.
- **Creator 2 source maps**: Embed source content in base and Replay package source maps to address Creator 2 build compatibility when SourceMap is enabled.

### Migration

- Upgrade the base SDK and optional native Replay package together to `0.1.1-alpha.2`. Rerun the SDK installer and rebuild, including base-only native integrations, to install the required platform runtime.
- Web integrations require separate Web reporting settings and application ID. Install Browser RUM / Logs `3.3.22` as needed, plus Browser WebGL `3.3.8` for Replay, then run the installer with `--web`. Web Replay must initialize before the Cocos engine.
- Web does not support all native APIs, including timed Actions, manual Resource timing, manual Long Tasks, and manual trace-header generation.

## 0.1.1-alpha.1

### Fixes

- **Android Replay focus callbacks**: Upgrade Android Session Replay to `0.1.10-alpha01`, which forwards Window focus changes to the host and disables recorder callbacks retained under an outer wrapper after recording ownership changes. This fixes the Cocos rendering stop observed when returning from a full-screen native Activity. Android Agent remains `1.7.6`; iOS Agent / Session Replay remains `1.6.8`.
- **Creator 2 Hybrid sample navigation**: Keep Cocos and native pages in one application process. Cocos remains the launcher and task root; closing a native page resumes the existing Cocos Activity without recreating the engine. The sample reclaims Cocos recording ownership after drawing resumes.

### Migration

- Upgrade `@truewatchtech/cocos-sdk` and `@truewatchtech/cocos-session-replay` together to `0.1.1-alpha.1`. Rerun `npx truewatch-cocos install --replay`, resolve native dependencies, and rebuild. Native hosts that manage Replay themselves must also upgrade Android Session Replay to `0.1.10-alpha01`.
- Rerun the Creator 2 Hybrid sample's `native:install` command to migrate older exports from the separate Cocos process and bridge provider to the single-process Activity setup.

## 0.1.0

Initial stable release for native Android and iOS applications built with Cocos Creator.

### Features

- **RUM collection**: Support automatic scene, touch, JavaScript error, and runtime-supported unhandled Promise rejection tracking, plus manual View, Action, Error, Long Task, and Resource instrumentation. Configure native crash, Android ANR, UI blocking, and device performance monitoring.
- **Log collection**: Submit custom logs or capture Console output, with level filters, sampling, cache policies, and RUM session correlation.
- **Network monitoring and tracing**: Collect request and response metadata and total duration for runtime-provided `fetch` and `XMLHttpRequest`, and inject trace headers. Support manual Resource tracking and trace header generation for custom network integrations. DNS, TCP, and SSL timing breakdowns require manual instrumentation.
- **Optional Session Replay**: Provide `@truewatchtech/cocos-session-replay` with Creator 2 and Creator 3 entry points. Compose it with the base SDK through `withSessionReplay(baseSdk)` to capture Cocos visuals and associate them with RUM sessions, with configurable sampling, error-session sampling, capture frequency, and image dimensions.
- **Replay privacy and image controls**: Mask or hide nodes through the `ReplayPrivacy` component or code; input fields are masked and touch positions are hidden by default. Configure image quality presets and opt into per-image byte limits with `imagePolicy.maxFrameBytes`. Limits cover every image, including new-view and rotation frames, and do not impose a rolling traffic quota.
- **Native-host Hybrid integration**: Reuse the SDK initialized by the native host through `truewatchSdk.attach()`. Use `truewatchSdk.enterCocos()` and `truewatchSdk.leaveCocos()` to switch Cocos page tracking and Replay capture. When enabled, Cocos network tracking starts on attachment and remains active across page transitions without shutting down the host SDK.
- **Percentage sampling**: Configure RUM, error-session, log, trace, Replay, and error-Replay sampling with `sessionSamplingRate`, `sessionOnErrorSamplingRate`, `logSamplingRate`, `traceSamplingRate`, `sessionReplaySamplingRate`, and `sessionReplayOnErrorSamplingRate`. Values accept decimal percentages from `0` to `100`; legacy ratio fields retain their `0` to `1` behavior, and percentage fields take precedence, including an explicit `0`.
- **User context and installation**: Bind users and add global or per-event custom attributes, with DataKit or DataWay reporting. Provide Creator 2 and Creator 3 installation commands and native build extensions, with CocoaPods or Swift Package Manager for iOS.

### Improvements

- **Replay capture performance**: Perform native image encoding and Replay file reads and writes off the game thread on Android and iOS. Include image processing time in the configured capture interval.

### Integration Requirements

- Supports Cocos Creator 2.4.5–2.4.15 and 3.6.3–3.8.x; 3.0–3.6.2 is supported on a best-effort basis. Requires Android API 21+ or iOS 15.0+. Web, mini-game, and desktop targets are not supported.
- Uses Android Agent `1.7.6`, Android Session Replay `0.1.9`, and iOS Agent / Session Replay `1.6.8`. Swift Package Manager requires Swift tools 5.5 or later.
- Use `truewatchSdk.start()` for standalone applications or `truewatchSdk.attach()` after native-host initialization for Hybrid applications. These modes are mutually exclusive; Hybrid sampling is configured by the native host.
- For Replay, install `@truewatchtech/cocos-sdk` and `@truewatchtech/cocos-session-replay` at the exact same version and compose them before `start()` or `attach()`. Run `npx truewatch-cocos install --replay`, or `npx truewatch-cocos install --no-replay` for base-only applications, then regenerate the native project, resolve dependencies, and rebuild.

## 0.1.0-alpha.8

### Features

- **Percentage sampling configuration**: Add `sessionSamplingRate`, `sessionOnErrorSamplingRate`, `logSamplingRate`, `traceSamplingRate`, `sessionReplaySamplingRate`, and `sessionReplayOnErrorSamplingRate`. The new fields accept decimal percentages from `0` to `100`. Deprecated ratio fields retain their original `0` to `1` behavior; new fields take precedence, including an explicit `0`.

### Improvements

- **Native SDK dependencies**: Upgrade iOS Agent and Session Replay to `1.6.8-alpha.11`, Android Agent to `1.7.6-alpha09`, Android Session Replay to `0.1.9-alpha07`, and the Hybrid sample's Gradle Plugin to `1.3.9-alpha02`. Synchronize CocoaPods, SPM, native installers, and Hybrid sample dependencies.
- **Native percentage sampling**: Use the native percentage APIs for RUM, logging, tracing, and Session Replay. iOS now accepts fractional percentages such as `0.1` without integer rounding. Legacy ratio fields retain their existing conversion behavior.

### Fixes

- **Hybrid iOS sample resources**: Avoid duplicate native and Cocos collection for the Creator 3 sample's network requests.
- **npm release completion**: Finish publishing after both package uploads succeed without waiting for npm registry visibility. Registry propagation delays no longer interrupt publication of the package pair; version and content conflict checks still run before uploading either package.

### Migration

- **Minimum iOS version is now 15.0**, as required by TrueWatchSDK `1.6.8-alpha.11`. SPM packages require Swift tools 5.5 or later. The installer raises lower generated deployment targets to iOS 15.0 and preserves higher targets. Applications that must support iOS 12–14 should remain on an earlier SDK release.
- Upgrade `@truewatchtech/cocos-sdk` and `@truewatchtech/cocos-session-replay` together to `0.1.0-alpha.8`. Rerun `npx truewatch-cocos install --replay` for Replay integrations, or `npx truewatch-cocos install --no-replay` for base-only integrations, then regenerate and rebuild the native application. Resolve the updated CocoaPods or SPM dependencies before building iOS.
- Prefer the new `0`–`100` percentage fields for new integrations. Existing `0`–`1` ratio fields remain supported; when both are supplied, the percentage field takes precedence.

## 0.1.0-alpha.7

### Improvements

- **Session Replay image limits and capture cadence**: Replace the rolling minute budget and adaptive throttling with explicit per-image limits. Apply `imagePolicy.maxFrameBytes` to every image, including new-view and rotation frames, and include processing time in the configured capture interval. Preserve display coordinates when captured images are resized.
- **Integration samples and documentation**: Unify the Creator 2 and Creator 3 Hybrid samples around an interactive game, document public Replay and plugin APIs, and add measured Android Replay traffic references. Add Android 16 KB page-alignment settings and validation tooling to the Creator 3 sample.

### Fixes

- **Creator 3 Replay camera**: Isolate offscreen capture from the display camera so Replay does not alter the displayed scene or camera-dependent input coordinates.
- **Creator 3 Replay touches**: Record touches consumed by UI controls while preserving normal engine input dispatch and avoiding duplicate Replay events.

### Migration

- Upgrade `@truewatchtech/cocos-sdk` and `@truewatchtech/cocos-session-replay` together to `0.1.0-alpha.7`. Projects using Replay must rerun `npx truewatch-cocos install --replay` and rebuild the native application.
- Remove `imagePolicy.maxBytesPerMinute` and `imagePolicy.adaptiveCapture`. Configure `captureFps`, `maxImageDimension`, and `imagePolicy.maxFrameBytes` instead. Supplying `imagePolicy` enables the native V2 encoder and per-image byte limits; omitting it keeps legacy storage without an encoded-byte limit. Per-image limits do not impose a rolling traffic quota.

## 0.1.0-alpha.6

### Features

- **Optional Session Replay package**: Split Replay into `@truewatchtech/cocos-session-replay`, with Creator 2 and Creator 3 entry points, privacy components, and optional native bridges. The base `@truewatchtech/cocos-sdk` package no longer includes Replay.
- **Replay composition API**: Add `withSessionReplay(baseSdk)` and a public base plugin API. The composed SDK exposes Replay configuration, lifecycle operations, privacy controls, and camera selection.

### Improvements

- **Native installation and publishing**: Add explicit `--replay` / `--no-replay` installation, preserve SDK-managed asset identity during migration, and coordinate exact package versions with verification and resumable publication of both npm packages.

### Migration

- Install both packages at the exact same version, compose the SDK with `withSessionReplay` before `start` or `attach`, import Replay types from the Replay package, and call `setReplayCamera` on the composed SDK. Rerun installation with `--replay` and rebuild the native application.

## 0.1.0-alpha.5

### Features

- **iOS Swift Package Manager integration**: Add configurable CocoaPods or SPM installation for Creator 2 and Creator 3, including Hybrid native hosts. CocoaPods remains the default; the installer preserves the selected dependency manager and restores SPM references after Creator 3 CMake regeneration.

### Improvements

- **Native network SDK dependencies**: Upgrade Android Agent to `1.7.6-alpha03` and the Hybrid sample's Gradle Plugin to `1.3.9-alpha01`. Upgrade iOS Agent and Session Replay to `1.6.8-alpha.5` for both CocoaPods and SPM. The iOS version adds independently enabled NSURLConnection Resource collection and Trace correlation; both new switches default to disabled.
- **Network verification samples**: Add Creator 2 Android engine HTTP requests and opt-in iOS NSURLConnection requests to the Hybrid samples. Document how to verify uploaded Resources and prevent duplicate collection when JS or manual instrumentation overlaps native collection.
- **Creator 3 Replay sample**: Add a native 3D validation scene with camera, motion, and independent HUD controls to inspect capture behavior and the current single-camera limitation.

## 0.1.0-alpha.4

### Features

- **Session Replay privacy components**: Add a `ReplayPrivacy` editor component for Creator 2 and Creator 3 to mask or hide nodes and prefabs in captured Replay images. The installer copies the component into project assets; code overrides take priority, and input fields remain masked by default.

### Improvements

- **Session Replay capture performance**: Move Replay file reads, writes, and native image encoding off the game thread on Android and iOS. Rebuild the native project after updating the SDK to include the asynchronous bridge.
- **Hybrid privacy samples**: Add privacy component examples and mask-fit controls to the maintained Creator 2 and Creator 3 Hybrid samples.

### Fixes

- **Android Session Replay playback**: Upgrade the native dependency installer from `ft-session-replay:0.1.9-alpha02` to `0.1.9-alpha03`, which aligns segment compression with the Browser SDK format and restores playback of affected sessions containing multiple segments. Verified with published Maven artifacts in an old/new/old comparison across native and Cocos pages.

## 0.1.0-alpha.3

### Improvements

- **Android SDK dependencies**: Upgrade the Android agent SDK from `1.7.6-alpha01` to `1.7.6-alpha02` and Session Replay from `0.1.9-alpha01` to `0.1.9-alpha02` in the native dependency installer for Creator 2 and Creator 3.
- **Hybrid integration samples**: Keep one minimal Hybrid integration project for each Creator generation. Remove legacy diagnostic projects, copied SDK installations, and Replay traffic benchmark tools from the maintained examples.

### Fixes

- **TrueWatch npm publishing**: Enable publication of `@truewatchtech/cocos-sdk` from matching version tags in `TrueWatchTech/datakit-cocos`. Verify package versions, run tests, and build the package before publication. Handle first publication, skip an already-published version from the same commit, and reject conflicting release identities.
- **Release validation**: Keep the TrueWatch package metadata, runtime version, iOS bridge version, and lockfiles aligned at `0.1.0-alpha.3`.

## 0.1.0-alpha.2

### Fixes

- **Session Replay privacy masks**: Fix misplaced input-field and custom node masks in Creator 2 and Creator 3 when camera projection changes their position or size in the captured image. Skip the frame if privacy bounds cannot be projected reliably, preventing capture with an incorrectly positioned mask.

## 0.1.0-alpha.1

Released from commit `2bbeeb86270b666e5eeddc6f220586df66f10362`.

Initial prerelease with Real User Monitoring (RUM), logging, distributed tracing, and experimental Session Replay for Cocos Creator applications on native Android and iOS.

### Features

- **Automatic RUM collection and manual instrumentation**: Optionally track scene changes, touch interactions, and JavaScript errors and unhandled Promise rejections supported by the runtime. Manually record views, actions, errors, long tasks, and network resources to monitor key business flows. Native crash, Android ANR, UI blocking, and device performance monitoring are configurable.
- **Log collection**: Submit custom logs and optionally capture Console output. Configure log level filters, sampling, and cache policies, and correlate logs with the current RUM session to troubleshoot issues alongside user activity.
- **Network monitoring and trace correlation**: Automatically collect basic request and response details and total duration for runtime-provided `fetch` and `XMLHttpRequest`, and inject trace headers. Manual resource tracking and trace header generation support custom network integrations. DNS, TCP, and SSL timing breakdowns require manual instrumentation.
- **Session Replay (experimental)**: Capture Cocos visuals and associate them with RUM sessions. Configure sampling, additional sampling for sessions with errors, capture frequency, and image dimensions. Support masking and hiding nodes; input fields are masked and touch positions are hidden by default.
- **Replay image quality and traffic controls**: Configure image quality presets, per-frame size limits, and a rolling image-data budget. Adaptive capture adjusts capture frequency, image quality, and dimensions as the budget fills, helping balance replay detail and data usage.
- **Native-host Hybrid integration**: Reuse the SDK initialized by a native app that embeds Cocos. Attach through `truewatchSdk.attach()` and manage the Cocos collection lifecycle with `truewatchSdk.enterCocos()` and `truewatchSdk.leaveCocos()`, avoiding duplicate initialization of the host SDK.
- **User and business context**: Bind and unbind users, and add global and per-event custom attributes to filter monitoring data by user, environment, and business context. Send data through DataKit or DataWay.
- **Project installation tools**: Provide an npm package with separate Creator 2 and Creator 3 entry points, an installation command, and build extensions to help configure native Android and iOS bridges and dependencies.

### Integration Requirements

- Supports Cocos Creator 2.4.5–2.4.15 and 3.6.3–3.8.x. Support for 3.0–3.6.2 is best effort.
- Requires Android API 21+ or iOS 12+. Web, mini-game, and desktop targets are not currently supported.
- Initialize standalone Cocos applications with `truewatchSdk.start()`. For Hybrid applications, initialize the SDK in the native host and then call `truewatchSdk.attach()`. These initialization modes are mutually exclusive.
- Configure RUM, logging, tracing, Session Replay, and automatic collection as needed. After generating an iOS native project, run `pod install` to install its dependencies.
