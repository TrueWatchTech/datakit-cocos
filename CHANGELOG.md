# Changelog

## Unreleased

### Fixes

- **TrueWatch npm publishing**: Enable publication of `@truewatchtech/cocos-sdk` from matching version tags in `TrueWatchTech/datakit-cocos`. Verify package versions, run tests, and build the package before publication. Handle first publication, skip an already-published version from the same commit, and reject conflicting release identities.

## 0.1.0-alpha.3

### Improvements

- **Android SDK dependencies**: Upgrade the Android agent SDK from `1.7.6-alpha01` to `1.7.6-alpha02` and Session Replay from `0.1.9-alpha01` to `0.1.9-alpha02` in the native dependency installer for Creator 2 and Creator 3.
- **Hybrid integration samples**: Keep one minimal Hybrid integration project for each Creator generation. Remove legacy diagnostic projects, copied SDK installations, and Replay traffic benchmark tools from the maintained examples.
- **SDK and sample messages**: Simplify SDK error messages and sample text for clarity.

### Fixes

- **Release validation**: Keep the TrueWatch package metadata, runtime version, iOS bridge version, and lockfiles aligned at `0.1.0-alpha.3`. npm publication remains disabled on this branch.

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
