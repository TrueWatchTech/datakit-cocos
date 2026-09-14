# TrueWatch Cocos Session Replay

Optional Session Replay for native Android and iOS applications built with Cocos Creator 2.4 and 3.x. Install the exact same version of `@truewatchtech/cocos-sdk` and `@truewatchtech/cocos-session-replay`.

```sh
npm install @truewatchtech/cocos-sdk@<version> @truewatchtech/cocos-session-replay@<version>
npx truewatch-cocos install --replay
```

Reopen Creator and rebuild the native project. Use `--creator 2` or `--creator 3` if automatic detection is unavailable. Add `--ios-dependency-manager spm` to select Swift Package Manager; CocoaPods remains the default.

## Standalone application

```ts
import { truewatchSdk as baseSdk } from '@truewatchtech/cocos-sdk/creator3';
import { withSessionReplay } from '@truewatchtech/cocos-session-replay/creator3';

export const sdk = withSessionReplay(baseSdk);
sdk.start({
  sdk: { datakitUrl: 'http://localhost:9529' },
  rum: { androidAppId: 'your-app-id', iosAppId: 'your-app-id' },
  replay: { captureFps: 1, touchPrivacy: 'hide' },
});
```

For Creator 2, use the `/creator2` entry from both packages. Compose before starting or attaching the base SDK. `sdk.setReplayCamera(camera)` selects the capture camera; `sdk.replay.setPrivacy(node, 'mask')` protects a node. The installer places `ReplayPrivacy.ts` under `assets/truewatch-cocos-sdk` for scene/prefab use.

## Hybrid application

The native host owns SDK/RUM/Replay initialization and sampling. Attach the composed SDK to that instance:

```ts
sdk.attach({ replay: { captureFps: 1 }, autoTrack: { scenes: true } });
sdk.enterCocos();
// When returning to the native host:
sdk.leaveCocos();
```

If automatic scene tracking is disabled, pass a `viewName` to `enterCocos`. Use `leaveCocos` instead of `shutdown` in Hybrid mode. Replay uses the native host's existing RUM session, image storage, and uploader.

## Image size and traffic

The per-image behavior below is included in `0.1.0-alpha.7`. The device reference used locally packed development `0.1.0-alpha.6` packages containing commit `ef1137b`; published `0.1.0-alpha.6` packages predate this change.

Set the capture frequency and per-image limits independently:

```ts
const replay = {
  captureFps: 3,
  maxImageDimension: 720,
  imagePolicy: { quality: 'medium' as const, maxFrameBytes: 40 * 1024 },
};
sdk.attach({ replay }); // Or pass replay to sdk.start in standalone mode.
```

`captureFps` accepts integers from 1 to 5 (default 1). `maxImageDimension` accepts 1–2048 and overrides the preset's longest edge. `imagePolicy.maxFrameBytes` accepts 1 KiB–1 MiB and overrides the preset's encoded size limit for **every image**, including new-view and rotation frames. The native encoder reduces quality, then dimensions if needed; a frame that still exceeds the limit is rejected while pending touches can continue to be written.

| Preset | Longest edge | Initial encoding quality | Per-image limit | Full-rate image ceiling at 2 FPS (MiB/min) | Full-rate image ceiling at 3 FPS (MiB/min) |
| --- | ---: | ---: | ---: | ---: | ---: |
| `low` | 480 px | 0.35 | 20 KiB | 2.34 | 3.52 |
| `medium` (default preset) | 720 px | 0.45 | 40 KiB | 4.69 | 7.03 |
| `high` | 960 px | 0.60 | 80 KiB | 9.38 | 14.06 |

These are approximate theoretical image-only ceilings per recorded session at the configured frame rate, calculated as `maxFrameBytes × captureFps × 60 / 1048576`. They are **not measured typical traffic, a traffic range, or a rolling quota**. Configuration does not establish a useful lower bound: actual traffic depends on encoded image size, scene changes, and the number of accepted frames. Report typical ranges only from measurements of representative scenes at each configuration. A static scene may stop producing additional images after its first frame, but that does not make zero a representative minimum for an active recording. Replay segments, touch events, other telemetry, network overhead, and retries are excluded. Session sampling reduces aggregate traffic across users; it does not reduce the per-image limit in a recorded session.

### Battle re-encoding sizing reference

The following **sample-based estimates** provide a numeric lower and upper reference for active gameplay. A local test re-encoded 21 existing 720×405 Battle WebP images with libwebp 1.6.0, using the Android policy's initial quality and size-reduction steps. All 21 images were accepted in each preset. The ranges multiply the smallest and largest encoded sample sizes by 120 or 180 images per minute; they do not discount static frames or missed captures.

| Preset | Encoded sample size (bytes/image) | Estimated images at 2 FPS (MiB/min) | Estimated images at 3 FPS (MiB/min) |
| --- | ---: | ---: | ---: |
| `low` | 5,482–6,054 | 0.63–0.69 | 0.94–1.04 |
| `medium` | 10,168–11,282 | 1.16–1.29 | 1.75–1.94 |
| `high` | 10,776–12,100 | 1.23–1.38 | 1.85–2.08 |

This is a local re-encoding estimate using already-compressed images, **not a continuous 2/3 FPS device recording, an iOS JPEG measurement, or guaranteed bounds for other scenes**. Low was resized to 480×270; medium and high used the source 720×405 without upscaling, so the high row does not characterize a 960 px capture. Textures, particles, camera motion, alpha, and native encoder differences can change the range. Only image data is included; the separate full-rate ceilings above still describe the configured per-image limits.

### Android device reference

A September 13, 2026 Creator 2.4.9 Android Battle recording configured for 3 FPS, medium, 720 px and 40 KiB/image produced 83 available WebP images totaling 1,008,030 bytes over 28.516 seconds between its first and last image. Each image was 720×405, with an encoded size of 11,280–13,098 bytes (mean 12,144.94 bytes). Image traffic was **2.02 MiB/min**. The full view averaged 2.88 FPS, including an initial 1.017-second interval; the subsequent 81 intervals averaged **2.95 FPS**.

At a full 3 FPS, the measured smallest and largest Battle images imply **1.94–2.25 MiB/min**, with **2.08 MiB/min** at the mean size. This is a sample-based planning reference, not guaranteed bounds for other scenes. It is more representative of this Android Battle scene than the earlier medium re-encoding estimate of 1.75–1.94 MiB/min. The low/high rows above remain re-encoding estimates; no device measurements for those presets are claimed.

For measurements, use `unique image payload bytes / recorded seconds × 60 / 1048576`. Deduplicate repeated playback downloads by resource ID and use the duration of the same records whose bytes are counted. Across this recording, the raw record span was 68.953 seconds while the console session header showed 48.15 seconds; mixing those durations would distort the result. Two images outside Battle were unavailable from the server, so the whole-session download total is incomplete. The Battle images were all available.

For planning, use `average encoded bytes × expected saved images per minute / 1048576`; at a full rate the expected count is `captureFps × 60`. Add Replay segments, touch metadata, transport overhead and retries separately. Downloaded image payload is not a measurement of all device upload traffic. Session sampling scales aggregate recorded minutes, while error-session sampling adds further recordings; neither changes the size limit of an accepted image.

There is no rolling minute budget, budget-triggered throttling, or 100 KiB first-frame allowance. Remove the old `maxBytesPerMinute` and `adaptiveCapture` options; they are no longer part of the API, and extra legacy JavaScript properties do not enable a limit. Capture processing time is included in the target frame interval. Identical/approximately static frames, native encoding rejection, and device processing delays can still reduce actual output; missed time slots are skipped without concurrent image jobs.

Supplying `imagePolicy` enables the native V2 image encoder (Android WebP, iOS JPEG) and its size limits, even when using `{}` to select the medium preset. Update the native Replay SDK and rebuild the native application. An unavailable V2 encoder produces an explicit error and does not fall back to unbounded storage. Omitting `imagePolicy` preserves legacy image storage: it still uses `captureFps` and `maxImageDimension`, but has **no encoded-byte limit**, and the table above does not apply. Legacy image bytes are reported as unavailable in diagnostics rather than estimated as the per-frame limit.

## Migration from the combined package

Add this package and compose the existing SDK with `withSessionReplay`. Move the old `setReplayCamera(camera)` call to `sdk.setReplayCamera(camera)`. Import Replay configuration types from this package. Existing `start({ replay })`, `attach({ replay })`, and `sdk.replay` operations are available on the composed SDK.

The base package alone does not accept Replay configuration. Missing or incompatible native Replay integration reports an error when enabling Replay, with instructions to rerun installation and rebuild.

Run `npx truewatch-cocos install --no-replay` and rebuild to remove SDK-managed native Replay integration. Existing ReplayPrivacy scripts and their `.meta` identifiers are preserved because scenes may reference them. Native Replay independently used by a Hybrid host must remain installed by that host.

## Native dependencies

This package carries the optional Replay bridge, asynchronous image workers, C++ frame-file bindings, and privacy components. Its integration descriptor adds Android `ft-session-replay`, or iOS `TrueWatchSDK/FTSessionReplay` / `TrueWatchSessionReplay`. Base SDK dependencies are shared rather than duplicated.

Licensed under Apache-2.0; see `LICENSE` and `THIRD_PARTY_NOTICES`.
