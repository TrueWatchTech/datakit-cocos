# TrueWatch SDK Cocos Creator

[![npm package](https://img.shields.io/npm/v/@truewatchtech/cocos-sdk?color=orange)](https://www.npmjs.com/package/@truewatchtech/cocos-sdk)
[![scope](https://img.shields.io/badge/scope-TrueWatch-lightgrey)](https://github.com/TrueWatchTech/datakit-cocos)
[![Cocos Creator](https://img.shields.io/badge/Cocos%20Creator-2.4%20%7C%203.x-brightgreen)](https://github.com/TrueWatchTech/datakit-cocos)
[![license](https://img.shields.io/badge/license-Apache%202.0-brightgreen)](LICENSE)

## Introduction

TrueWatch Application Monitoring collects and analyzes RUM, Log, and Trace data from Cocos Creator applications. The SDK supports native Android and iOS builds, plus Web Mobile and Web Desktop builds, for Cocos Creator 2.4 and 3.x.

## Supported Scope

| Package entry | Supported Cocos Creator | Supported targets |
| --- | --- | --- |
| `@truewatchtech/cocos-sdk/creator2` | 2.4.5–2.4.15 | Android API 21+, iOS 15+, Web Mobile / Web Desktop |
| `@truewatchtech/cocos-sdk/creator3` | 3.6.3–3.8.x | Android API 21+, iOS 15+, Web Mobile / Web Desktop |

Cocos Creator 3.0–3.6.2 is supported on a best-effort basis because the stable native build extension API starts at 3.6.3. Mini-game and native desktop targets are not currently supported.

## Web integration

Configure Web reporting separately in `cocos-sdk.config.json`; native Android/iOS
application IDs and reporting endpoints are not reused. See the
[unified configuration example](https://github.com/TrueWatchTech/datakit-cocos/blob/dev/examples/unified/cocos-sdk.config.example.json).
Install Browser RUM `3.3.22` and/or Browser Logs `3.3.22` according to the enabled
collectors; Web Replay also requires Browser WebGL `3.3.8`. Then run
`npx truewatch-cocos install --web`, reopen Creator, and rebuild the Web project.

Use the same `/creator2` or `/creator3` base SDK entry and call `truewatchSdk.start()`
to apply project settings. The build extension initializes Browser collectors
before the engine. Configure Replay through `replay.enabled`, shared sampling,
and `replay.web`; set `replay.native: false` for Web-only Replay to avoid requiring
the native Replay package. Native `withSessionReplay(...)` composition is not
supported on Web.

Web canvas recording requires explicit `canvasPrivacy: "allow"`. Protected nodes
and input fields block the whole canvas; native node-level masking is unavailable.
Web also does not support timed Actions, manual Resource timing, manual Long Tasks,
manual trace-header generation, or shutting down page-wide Browser collectors.

Without Web configuration, importing the base SDK does not start collection.
Calling initialization or instrumentation APIs without the Web runtime throws an
error. Native-only integrations must guard SDK calls and native Replay composition
with a platform check when building for Web.

After upgrading, rerun the installer and rebuild native projects as well,
including base-only integrations, to install the matching platform runtime.

## Sampling configuration

Use the percentage-based sampling fields for new integrations. They accept finite values from
`0` to `100`, including decimals such as `0.1` for 0.1%:

```ts
truewatchSdk.start({
  sdk: { datakitUrl: 'http://localhost:9529' },
  rum: {
    androidAppId: 'your-app-id',
    iosAppId: 'your-app-id',
    sessionSamplingRate: 20,
    sessionOnErrorSamplingRate: 100,
  },
  logger: { logSamplingRate: 50 },
  trace: { traceSamplingRate: 25 },
});
```

`sessionSamplingRate`, `logSamplingRate`, and `traceSamplingRate` default to 100 in the
native SDK. `sessionOnErrorSamplingRate` defaults to 0. The deprecated `sampleRate` and
`sessionOnErrorSampleRate` fields remain available with their original `0` to `1` unit.
When both forms are supplied for the same setting, the percentage field wins, including
an explicit value of `0`. Fractional percentages require a native SDK with floating-point
sampling support; an older integer-only iOS SDK is rejected instead of rounding the value.

## Optional Session Replay

Session Replay is distributed separately as `@truewatchtech/cocos-session-replay`.
Install both packages at the exact same version and run `npx truewatch-cocos install --replay`.
Compose the SDK with `withSessionReplay` from the matching `/creator2` or `/creator3` entry
before using Replay configuration. Camera selection moves to `sdk.setReplayCamera(camera)`.

Base-only applications continue using this package and its normal initialization API.
Run `npx truewatch-cocos install --no-replay` and rebuild to remove an existing SDK-managed
Replay native integration. Existing scene component scripts and metadata are preserved.
See the [Replay package guide](https://github.com/TrueWatchTech/datakit-cocos/tree/main/packages/cocos-session-replay).

## iOS dependency manager

CocoaPods remains the default. To use Swift Package Manager, add
`cocos-sdk.config.json` to your **Cocos project root** (beside `assets`):

```json
{
  "ios": {
    "dependencyManager": "spm"
  }
}
```

Alternatively, save this setting when installing the extension:

```sh
npx @truewatchtech/cocos-sdk install --ios-dependency-manager spm
```

Rebuild the native iOS project in Creator after changing the configuration. The
extension links the local `FTCocosBridge` package and Xcode resolves the pinned
iOS SDK from Git. Fresh SPM projects do not require `pod install`; open the
`.xcodeproj`. If the host uses CocoaPods for other libraries, continue opening
its `.xcworkspace`.

When switching an existing installation, the extension removes its managed SDK
Pod entries and runs `pod install` if Pods were previously installed. Other Pods
are preserved. Manually declared SDK Pods or other Pods that depend on the same
native SDK must be migrated first to avoid duplicate linking. Set the value to
`cocoapods` to switch back, then run `pod install` as usual.

Creator 3 CMake regeneration restores the package integration automatically during
Xcode builds. If you regenerate the project by running CMake separately, rerun
Creator's native build integration before opening Xcode. Hybrid examples use the
same configuration with their existing `native:install` command.

## Examples

[TrueWatch SDK Cocos Creator Demo](https://github.com/TrueWatchTech/datakit-cocos/tree/main/examples)

## Documentation

For installation, configuration, and usage, see the [official documentation](https://docs.truewatch.com/real-user-monitoring/cocos/app-access/).

## License

Copyright 2020 TRUEWATCH TECHNOLOGY INC PTE. LTD. Licensed under the [Apache License 2.0](LICENSE).
