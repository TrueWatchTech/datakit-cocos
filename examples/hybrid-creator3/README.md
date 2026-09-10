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
`ft-plugin:1.3.8`, and adds the OkHttp dependency used by the native automatic
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

With Xcode 26, Cocos 3.8.8's bundled Enoki source may fail with
`invalid-specialization`. Add `-Wno-invalid-specialization` to **Other C++
Flags** for the generated Cocos targets (or use the equivalent command-line
override). This compatibility flag concerns the Creator engine, not the monitoring
SDK; the sample's iOS host and complete app were validated with it enabled.

## 3. Generate verification data

The app first shows a native page. Tap `Native Auto Network`, then `Open Cocos
Page`. After the Cocos screen becomes active, keep it open for at least ten
seconds and tap each button:

- `Auto Network`: one automatically tracked XHR Resource with Trace headers
- `Manual Trace`: explicit Trace headers plus a manually managed RUM Resource
- `RUM + Log`: one Action and one RUM-linked custom Log
- `RUM Error`: one Error and one error-level linked Log
- `Replay change`: a visible color delta for Session Replay; tap several times
- `COMPONENT-3141`: a node with `ReplayPrivacy` in its default Mask mode; gray in Replay
- `HIDE-ME-2718`: a node with `ReplayPrivacy` in Hide mode; black in Replay
- `MASK-ME-8391`: a node protected through `setPrivacy(node, 'mask')`; gray in Replay
- `Mask: move + scale`: translates the probe group and scales it to 85%; tap again to restore
- `Mask: toggle fit`: switches between `SHOW_ALL` and `FIXED_HEIGHT`; verify the private token stays fully gray in Replay after each change, while nearby public content remains visible
- `Native page`: leaves Cocos and returns RUM View/Replay ownership to native UI

### Privacy visual acceptance

`npm run setup` installs the `ReplayPrivacy` component script used by this sample. The two component probes attach that script at runtime, demonstrating the same component rules used by scene and prefab nodes; the third probe uses the code API.

Compare the live page with its Replay at each layout/camera setting:

1. The three red rectangular targets and their synthetic tokens are visible on the live page.
2. Only those targets become gray / black / gray in Replay. All token text must disappear.
3. All twelve green guard strips, the two **KEEP ME** labels, the public caption, and surrounding buttons remain visible and unchanged. Each guard is a sibling, separated from the target by a two-unit gap.
4. Repeat after **Mask: move + scale**, then after the camera/fit toggle, and with both changes combined. Check all four edges of each target for leakage or spill. Capture resolution can round a projected boundary outward by less than one pixel.

The targets deliberately have square corners and labels inside their bounds. Replay currently masks projected rectangles; this example verifies rectangular control bounds, not a per-pixel silhouette for rounded or rotated graphics, or independent visibility of overlapping controls.

The native View is `HybridNativeAndroidHome`; after opening Cocos, the active
View becomes `CocosHybridCreator3Sample`. Every event also includes
`sample_name=cocos-hybrid-creator3` to make filtering unambiguous.

Both network samples target `https://httpbin.org/get`, which echoes propagation
headers and proves Cocos-side injection. A Trace record itself must be produced
by an APM-instrumented server. To verify an end-to-end Trace-to-RUM link, change
`AUTO_TEST_URL` and `TRACE_TEST_URL` in `assets/HybridTelemetrySample.ts` to
endpoints served by your instrumented backend. Keep the automatic request free
of manual RUM calls, and keep the manual request on the saved untracked XHR
methods to avoid duplicate Resource collection.

Call the exported `leaveHybridCocos()` only when a real Hybrid host removes the
Cocos container and returns to native UI. Do not call it during ordinary Cocos
scene changes.
