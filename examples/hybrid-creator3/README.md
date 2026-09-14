# Cocos Creator 3 Hybrid integration sample

This is a complete Cocos Creator 3.8.8 project that consumes the SDK from the
local repository with `file:../../packages/cocos`. It demonstrates Hybrid mode:
Android/iOS owns native SDK startup, while Cocos attaches automatic tracking,
enters one Cocos RUM View, and supplies the camera used by Session Replay. The
app starts on a native page, opens Cocos, and can return to native UI so both
ownership sides are visible in one verification flow.

The sample reports:

- RUM View, Action, Error, and Resource data
- custom Logs with RUM correlation enabled
- Cocos canvas Session Replay at 2 FPS
- three privacy probes: component Mask, component Hide, and code Mask, with public boundary guards
- automatic Cocos XHR Resource/Trace collection
- manual DDTrace headers linked to an explicitly managed RUM Resource key
- native Android Activity/OkHttp collection instrumented by `ft-plugin`

## 1. Prepare the local SDK and credentials

Run from this directory:

```bash
npm run setup

export SAMPLE_DATAWAY_URL='https://rum-openway.truewatch.com'
export SAMPLE_CLIENT_TOKEN='<client-token>'
export SAMPLE_ANDROID_APP_ID='android_cocos'
export SAMPLE_IOS_APP_ID='ios_cocos'
export SAMPLE_SERVICE_NAME='cocos-hybrid-creator3-sample'
export SAMPLE_ENV='verification'
npm run configure
```

`configure` writes two ignored files under `native-host/`; credentials are not
stored in tracked source.

## 2. Build in Creator 3

1. Open this directory with Cocos Creator 3.8.8.
2. In Extension Manager, enable the project extension `truewatch-cocos-sdk`.
3. Open `assets/HybridTelemetry.scene`.
4. Build Android or iOS from the Build panel. For native targets, also complete
   the Creator **Make** step before installing the host. Keep the default output
   under this project's `build/` directory.

The reproducible CLI build inputs used to validate this project are in
`build-config/android.json` and `build-config/ios.json`; they also document the
package IDs and physical-device iOS target that should appear in the Build
panel.

The SDK extension injects the native Cocos bridge and native SDK dependencies. The
sample's native owner is installed separately after each native rebuild:

```bash
# Android build output
npm run native:install -- --build-root build/android

# iOS build output
npm run native:install -- --build-root build/ios
```

The command is idempotent. On Android it registers `HybridSampleApplication`,
which installs the SDK before the first Activity and then enables the lifecycle
tracking normally inserted by `ft-plugin`. It also keeps an idempotent
`HybridSampleSdk.start()` fallback in `AppActivity.onCreate`. On iOS it adds
`[HybridSampleSDK start]` to `didFinishLaunchingWithOptions`. For Creator 3
Android it makes `HybridSampleNativeActivity` the launcher, applies
`ft-plugin:1.3.9-alpha01`, and adds the OkHttp dependency used by the native automatic
network button. The native client deliberately uses
`OkHttpClient.Builder().build()` so the plugin can inject Resource and Trace
interceptors.

For Android, open the generated Gradle project (normally `build/android/proj`)
in Android Studio and run it. For iOS, run `pod install` in the directory that
contains the generated `Podfile`, then open the resulting `.xcworkspace` and run
on a physical iPhone. If Xcode's first build regenerates the CMake Xcode project,
run `pod install` once more before rebuilding; CMake regeneration overwrites
CocoaPods' project integration. A physical device avoids Cocos 3.8.8
engine-library architecture limitations that can affect arm64 simulators.

For Android 16 KB page-size support, `native:install` also adds
`-Wl,-z,max-page-size=16384` and `-Wl,-z,common-page-size=16384` to the
`libcocos.so` CMake target. Rebuild the native library after installation; replacing
only the exported game assets does not update ELF alignment. This does not change
the SDK initialization API. Check the finished APK from the workspace root:

```bash
python3 scripts/check-android-page-alignment.py /path/to/app-debug.apk
```

The check covers every packaged `.so`, LOAD alignment, GNU_RELRO boundaries, and
16 KB ZIP alignment for uncompressed libraries. Keep the sample's compressed
native-library packaging enabled, or use AGP 8.5.1+ for uncompressed packaging.
Any additional prebuilt `.so` must independently pass this check. Also run the app
on a 16 KB device/emulator (`adb shell getconf PAGE_SIZE` must print `16384`);
static alignment alone cannot verify runtime page-size assumptions. See the
[Android page-size guide](https://developer.android.com/guide/practices/page-sizes).

With Xcode 26, Cocos 3.8.8's bundled Enoki source may fail with
`invalid-specialization`. Add `-Wno-invalid-specialization` to **Other C++
Flags** for the generated Cocos targets (or use the equivalent command-line
override). This compatibility flag concerns the Creator engine, not the monitoring
SDK; the sample's iOS host and complete app were validated with it enabled.

## 3. Shared acceptance

Run the [unified acceptance flow](../README.md#统一验收creator-2x--3x) for both
Creator generations and both native platforms. It covers network, RUM, Logs,
Replay, privacy, and the interactive **Starport Game**. Open it through
**Open Cocos Page → Open Starport Game**. The game supports deployment, weapons,
movement, shooting, dash, repair, pause, victory/defeat, and results.

`npm run setup` installs the common game source and audio from `../acceptance-game`.
After changing that source, run `npm run game:sync` before exporting again.
Common steps and expected results are maintained only in the shared checklist;
the sections below describe engine/platform-specific checks.

### 3D capture verification

`Extra: 3D Replay scene` switches to actual `MeshRenderer` geometry: a rotating
orange cube, an orbiting cyan sphere, a magenta occluder, a blue tower, and a
ground grid. A perspective camera and a directional light make depth,
occlusion, and changing geometry visible. `assets/resources/Replay3D.mtl`
explicitly includes the PBR material dependency in native builds.

Tap the left third of the screen to return to the existing 2D sample, the
middle third to toggle the HUD, or the right third to pause/resume movement.
These gestures still work with the HUD hidden. Returning restores the 2D
Replay camera and the code privacy probe.

Verify both cases against the live application:

1. **HUD hidden:** compare the 3D model positions, orientation, colors, depth
   occlusion, and ground grid with SDK Replay frames. Keep it running to check
   that motion produces changing frames.
2. **HUD visible:** the caption is rendered by an independent UI camera.
   The sample deliberately keeps `setReplayCamera()` on the 3D camera. The
   current SDK captures the 3D scene but omits this caption. This case exposes
   the single-camera limitation; it is not full-screen composition support.

Native capture was exercised on Creator 3.8.8 with Android 12 / GLES3 and
iOS 26.5 / Metal simulators, using fixed model poses and a moved camera for
screen-to-capture comparisons. This validates the SDK's native frame capture;
it does not establish physical-device coverage, Creator 2 3D coverage, or an
end-to-end upload/player result.

### Shared iOS checks

Follow [iOS network collection](../README.md#ios-nsurlconnection-automatic-collection)
and [Swift Package Manager](../README.md#using-swift-package-manager-on-ios)
in the common instructions. These procedures apply to both generations.
