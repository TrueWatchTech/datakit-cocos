# TrueWatch SDK Cocos Creator

[![npm package](https://img.shields.io/npm/v/@truewatchtech/cocos-sdk?color=orange)](https://www.npmjs.com/package/@truewatchtech/cocos-sdk)
[![scope](https://img.shields.io/badge/scope-TrueWatch-lightgrey)](https://github.com/TrueWatchTech/datakit-cocos)
[![Cocos Creator](https://img.shields.io/badge/Cocos%20Creator-2.4%20%7C%203.x-brightgreen)](https://github.com/TrueWatchTech/datakit-cocos)
[![license](https://img.shields.io/badge/license-Apache%202.0-brightgreen)](LICENSE)

## Introduction

TrueWatch Application Monitoring collects and analyzes RUM, Log, and Trace data from Cocos Creator applications. The SDK supports native Android and iOS builds for Cocos Creator 2.4 and 3.x.

## Supported Scope

| Package entry | Supported Cocos Creator | Native targets |
| --- | --- | --- |
| `@truewatchtech/cocos-sdk/creator2` | 2.4.5–2.4.15 | Android API 21+, iOS 12+ |
| `@truewatchtech/cocos-sdk/creator3` | 3.6.3–3.8.x | Android API 21+, iOS 12+ |

Cocos Creator 3.0–3.6.2 is supported on a best-effort basis because the stable native build extension API starts at 3.6.3. Web, mini-game, and desktop targets are not currently supported.

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
