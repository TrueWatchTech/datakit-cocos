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
applies `ft-plugin:1.3.9-alpha01`, and adds OkHttp for the native automatic request.
The Agent dependency is `1.7.6-alpha03`; the native owner enables both
`setEnableTraceUserResource(true)` and `setEnableHttpURLConnectionResource(true)`.
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

### Creator 2 camera-node check

In addition to common privacy case A05, use **Extra: camera 2D/3D** to toggle
`is3DNode`, then repeat A05. This is a Creator 2 API-specific case. The common
**Mask: toggle fit** button is available in both generations.

### Android Cocos HTTP automatic collection

`Cocos HTTP 200` and `Cocos HTTP 404` call the engine's real
`Cocos2dxHttpURLConnection` creation, connection, response-reading, and disconnect
methods through `HybridCocosHttpRequest`. The helper shares the engine package
to access these package-private methods; it does not wrap connections, inject
Trace headers, or call manual Resource APIs. `ft-plugin` instruments the
`URL.openConnection()` inside the engine class.

Filter RUM Resources by `collection=cocos-urlconnection` in the URL and match the
unique `request_id` shown on the page or in `adb logcat -s CocosHttpSample`. Each
click should produce one Resource with method GET, the returned HTTP status,
response size, duration, and the linked Trace identifiers. The log also shows
the connection class (`com.ft.sdk.FTHttpsURLConnection` for the default HTTPS
endpoints). HTTP completion on the page alone does not prove collection; check
the Resource payload and ensure there is no duplicate for the request ID.

These buttons intentionally run in the native main process, where this sample
initializes the Android SDK. They verify the Cocos engine HTTP class and bypass
JS automatic tracking. They do not establish automatic collection for XHR in
the separate `:cocos` process, which currently forwards JS telemetry to the main
process through the bridge and does not initialize its own Android SDK.

### Shared iOS checks

Follow [iOS network collection](../README.md#ios-nsurlconnection-automatic-collection)
and [Swift Package Manager](../README.md#using-swift-package-manager-on-ios)
in the common instructions. These procedures apply to both generations.
