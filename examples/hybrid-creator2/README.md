# Cocos Creator 2 Hybrid integration sample

This is a complete Cocos Creator 2.4.15 project that consumes the SDK from the
local repository with `file:../../packages/cocos`. It demonstrates Hybrid mode:
Android/iOS owns native SDK startup, while Cocos attaches automatic tracking,
enters one Cocos RUM View, and supplies the camera used by Session Replay.
The app starts on a native page, opens Cocos, and can return to native UI so
both ownership sides are visible in one verification flow.

The sample reports:

- RUM View, Action, Error, and Resource data
- custom Logs with RUM correlation enabled
- Cocos canvas Session Replay at 2 FPS
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
export SAMPLE_SERVICE_NAME='cocos-hybrid-creator2-sample'
export SAMPLE_ENV='verification'
npm run configure
```

`configure` writes two ignored files under `native-host/`; credentials are not
stored in tracked source.

## 2. Build in Creator 2

1. Open this directory with Cocos Creator 2.4.15.
2. In Extension Manager, enable the project package `truewatch-cocos-sdk`.
3. Open `assets/Scene/HybridTelemetry.fire`.
4. Build Android or iOS in **Project > Build**, using **Link** template mode and
   the default `build/jsb-link` output.

Creator 2.4's native generator requires Python 2.7. Configure **Python 2.7**,
Android SDK, and a Creator-compatible NDK in Creator Preferences before an
Android/iOS native build. Python 3 is not accepted by the bundled `cocos.py`.

The SDK package injects the native Cocos bridge and native SDK dependencies. The
sample's native owner is installed separately after each native rebuild:

```bash
npm run native:install -- --build-root build/jsb-link
```

The command is idempotent. On Android it registers `HybridSampleApplication`,
which installs the SDK before the first Activity and then enables lifecycle
tracking. It also keeps an idempotent `HybridSampleSdk.start()` fallback in
`AppActivity.onCreate`, makes `HybridSampleNativeActivity` the launcher,
applies `ft-plugin:1.3.8`, and adds OkHttp for the native automatic request.
Because Creator 2 terminates its process when `Cocos2dxActivity` is destroyed,
the installer runs that Activity in the app-local `:cocos` process and enables
SDK collection outside the main process. The native main process remains alive
and owns data upload, so switching pages can rebuild the engine without losing
queued RUM, Log, Trace, or Replay data.
On iOS it adds `[HybridSampleSDK start]` to
`didFinishLaunchingWithOptions` and presents the native sample page.

For Android, open the generated `proj.android-studio` directory in Android
Studio and run it. For iOS, run `pod install` in the generated `proj.ios_mac`
directory, then open the resulting `.xcworkspace` and run the `-mobile` target.

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
- `Mask: toggle 2D/3D`: switches the capture camera between 2D and 3D mode; verify the private token stays fully gray in Replay after each change, while nearby public content remains visible
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
View becomes `CocosHybridCreator2Sample`. Every event also includes
`sample_name=cocos-hybrid-creator2` to make filtering unambiguous.

The built-in trace request targets `https://httpbin.org/get`, which echoes the
propagation headers and proves Cocos-side injection. A Trace record itself must
be produced by an APM-instrumented server. To verify an end-to-end Trace-to-RUM
link, change `TRACE_TEST_URL` in `assets/Script/HybridTelemetrySample.ts` to an
endpoint served by your instrumented backend; keep the existing
`getHeaders(url, resourceKey)` and RUM Resource calls unchanged.

Call the exported `leaveHybridCocos()` only when a real Hybrid host removes the
Cocos container and returns to native UI. Do not call it during ordinary Cocos
scene changes.
