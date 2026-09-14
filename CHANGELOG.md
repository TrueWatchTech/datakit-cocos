# Changelog

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
