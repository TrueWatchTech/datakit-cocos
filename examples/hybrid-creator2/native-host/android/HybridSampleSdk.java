package com.truewatch.cocos.sample;

import android.app.Activity;
import android.content.Intent;

import com.ft.sdk.FTLoggerConfig;
import com.ft.sdk.FTRUMConfig;
import com.ft.sdk.FTSDKConfig;
import com.ft.sdk.FTSdk;
import com.ft.sdk.FTTraceConfig;
import com.ft.sdk.HandlerView;
import com.ft.sdk.TraceType;
import com.ft.sdk.sessionreplay.FTSessionReplayConfig;
import com.ft.sdk.sessionreplay.ImagePrivacy;
import com.ft.sdk.sessionreplay.TextAndInputPrivacy;
import com.ft.sdk.sessionreplay.TouchPrivacy;

import org.cocos2dx.lib.Cocos2dxHelper;

/** Native SDK owner for the Cocos Hybrid sample. Call before Cocos starts JavaScript. */
public final class HybridSampleSdk {
    private static boolean started;

    private HybridSampleSdk() {}

    public static synchronized void start() {
        if (!HybridSampleApplication.isMainProcess()) return;
        if (started) return;
        if (HybridSampleEnvironment.ANDROID_RUM_APP_ID == null) {
            throw new IllegalStateException("Set SAMPLE_ANDROID_APP_ID before building the Android sample");
        }

        FTSDKConfig sdkConfig = HybridSampleEnvironment.DATAKIT_URL != null
                ? FTSDKConfig.builder(HybridSampleEnvironment.DATAKIT_URL)
                : FTSDKConfig.builder(
                        HybridSampleEnvironment.DATAWAY_URL,
                        HybridSampleEnvironment.CLIENT_TOKEN);
        sdkConfig
                .setDebug(HybridSampleEnvironment.DEBUG)
                .setServiceName(HybridSampleEnvironment.SERVICE_NAME)
                .setEnv(HybridSampleEnvironment.ENV)
                .setOnlySupportMainProcess(false)
                .setEnableOkhttpRequestTag(true)
                .addGlobalContext("sample_name", "cocos-hybrid-creator2");
        FTSdk.install(sdkConfig);

        FTSdk.initRUMWithConfig(new FTRUMConfig()
                .setRumAppId(HybridSampleEnvironment.ANDROID_RUM_APP_ID)
                .setSamplingRate(1f)
                .setSessionErrorSampleRate(1f)
                .setEnableTraceUserAction(true)
                .setEnableTraceUserView(true)
                .setEnableTraceUserResource(true)
                .setViewActivityTrackingHandler(activity -> nativeView(activity))
                .setEnableTrackAppANR(true)
                .setEnableTrackAppCrash(true)
                .setEnableTrackAppUIBlock(true, 100));
        FTSdk.initLogWithConfig(new FTLoggerConfig()
                .setSamplingRate(1f)
                .setEnableCustomLog(true)
                .setEnableLinkRumData(true)
                .setPrintCustomLogToConsole(true));
        FTSdk.initTraceWithConfig(new FTTraceConfig()
                .setSamplingRate(1f)
                .setTraceType(TraceType.DDTRACE)
                .setEnableAutoTrace(true)
                .setEnableLinkRUMData(true));

        // Keep native recording enabled by default. enterCocos()/leaveCocos() switch
        // recorder ownership between native UI and the Cocos canvas at runtime.
        FTSdk.initSessionReplayConfig(new FTSessionReplayConfig()
                .setSampleRate(1f)
                .setSessionReplayOnErrorSampleRate(1f)
                .setTouchPrivacy(TouchPrivacy.SHOW)
                .setTextAndInputPrivacy(TextAndInputPrivacy.MASK_SENSITIVE_INPUTS)
                .setImagePrivacy(ImagePrivacy.MASK_NONE));
        started = true;
    }

    /** Returns from the generated Cocos Activity to the native landing Activity. */
    public static void returnToNative() {
        Activity activity = Cocos2dxHelper.getActivity();
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            Intent intent = new Intent(activity, HybridSampleNativeActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            activity.startActivity(intent);
        });
    }

    /** Read by the Cocos page before it claims RUM View and Replay ownership. */
    public static boolean isNativePageVisible() {
        return HybridSampleNativeActivity.isVisible();
    }

    private static HandlerView nativeView(Activity activity) {
        if ("org.cocos2dx.javascript.AppActivity".equals(activity.getClass().getName())) {
            // The Cocos SDK owns this View between enterCocos() and leaveCocos().
            return null;
        }
        if (activity instanceof HybridSampleNativeActivity) {
            return new HandlerView("HybridNativeAndroidHome");
        }
        return new HandlerView(activity.getClass().getSimpleName());
    }
}
