package com.ft.sdk.cocos;

import android.app.Activity;
import com.ft.sdk.FTSdk;
import com.ft.sdk.SessionReplayManager;
import com.ft.sdk.sessionreplay.FTSessionReplayConfig;
import com.ft.sdk.sessionreplay.SessionReplayInternalCallback;
import com.ft.sdk.sessionreplay.TouchPrivacy;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/** Optional native Session Replay entry point. */
public final class FTCocosReplayBridge {
    private FTCocosReplayBridge() {}
    public static String invoke(String method, String payload) {
        return FTBridgeTransport.invoke("session-replay", method, payload);
    }

    static String invokeLocal(String method, String payload) {
        try {
            Object value = dispatch(method, payload == null || payload.isEmpty()
                    ? new JSONObject() : new JSONObject(payload));
            JSONObject response = new JSONObject();
            response.put("ok", true);
            if (value != null) response.put("value", JSONObject.wrap(value));
            return response.toString();
        } catch (Throwable error) {
            JSONObject response = new JSONObject();
            try {
                response.put("ok", false);
                response.put("error", error.getClass().getSimpleName() + ": " + error.getMessage());
            } catch (Throwable ignored) {
                return "{\"ok\":false,\"error\":\"Native bridge failure\"}";
            }
            return response.toString();
        }
    }

    private static Object dispatch(String method, JSONObject payload) throws Exception {
        switch (method) {
            case "replay.capabilities":
                FTSessionReplayConfig.class.getDeclaredMethod("setExternalRecorderMode", boolean.class);
                if (payload.optBoolean("hybrid")) { ensureNativeHostInitialized(); hybridRecorderSwitchMethod(); }
                return new JSONObject().put("protocol", 1);
            case "replay.beginSaveImage":
                return FTCocosReplayImageJobs.begin(payload);
            case "replay.pollSaveImage":
                return FTCocosReplayImageJobs.poll(payload.getString("job"));
            case "hybrid.setExternalRecorderActive":
                setExternalRecorderActive(payload.getBoolean("active"));
                return null;
            case "replay.configure":
                configureReplay(payload);
                return null;
            case "replay.getContext":
                return SessionReplayManager.get().getCurrentFlutterRumContext();
            case "replay.saveImage":
                return saveReplayImage(payload);
            case "replay.saveImageV2":
                return saveReplayImageV2(payload);
            case "replay.writeSegment":
                SessionReplayManager.get().writeExternalSegment(
                        payload.getString("segment"), payload.getString("viewId"));
                return null;
            case "replay.setRecordCount":
                SessionReplayManager.get().setExternalRecordCount(
                        payload.getString("viewId"), payload.getLong("count"));
                return null;
            case "replay.stop":
                return null;
            default:
                throw new IllegalArgumentException("Unknown bridge method: " + method);
        }
    }

    private static void ensureNativeHostInitialized() {
        if (FTSdk.get() == null) {
            throw new IllegalStateException(
                    "The native host must install the native SDK before FTCocosSDK.attach()");
        }
    }

    private static Method hybridRecorderSwitchMethod() {
        try {
            return SessionReplayManager.class.getMethod(
                    "setExternalRecorderActive", boolean.class);
        } catch (NoSuchMethodException error) {
            throw new IllegalStateException(
                    "Android Session Replay does not support Hybrid recorder switching; "
                            + "upgrade the Native SDK");
        }
    }

    private static void setExternalRecorderActive(boolean active) throws Exception {
        ensureNativeHostInitialized();
        try {
            hybridRecorderSwitchMethod().invoke(SessionReplayManager.get(), active);
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw error;
        }
    }

    private static void configureReplay(JSONObject json) throws Exception {
        FTSessionReplayConfig config = new FTSessionReplayConfig();
        if (json.has("sampleRate")) config.setSampleRate((float) json.getDouble("sampleRate"));
        if (json.has("sessionOnErrorSampleRate")) config.setSessionReplayOnErrorSampleRate((float) json.getDouble("sessionOnErrorSampleRate"));
        if ("show".equals(json.optString("touchPrivacy"))) config.setTouchPrivacy(TouchPrivacy.SHOW);
        config.setInternalCallback(new SessionReplayInternalCallback() {
            @Override public Activity getCurrentActivity() { return FTBridgeTransport.resolveActivity(); }
        });
        Method externalMode = FTSessionReplayConfig.class.getDeclaredMethod("setExternalRecorderMode", boolean.class);
        externalMode.setAccessible(true);
        externalMode.invoke(config, true);
        FTSdk.initSessionReplayConfig(config);
    }

    private static String saveReplayImage(JSONObject json) throws Exception {
        byte[] bytes = readFile(new File(json.getString("path")));
        return SessionReplayManager.get().saveFlutterImageResource(bytes, json.getInt("width"), json.getInt("height"));
    }

    private static Object saveReplayImageV2(JSONObject json) throws Exception {
        byte[] bytes = readFile(new File(json.getString("path")));
        Method method;
        try {
            method = SessionReplayManager.class.getMethod(
                    "saveExternalImageResourceV2",
                    byte[].class,
                    int.class,
                    int.class,
                    float.class,
                    int.class);
        } catch (NoSuchMethodException unavailable) {
            throw new IllegalArgumentException("Unknown bridge method: replay.saveImageV2");
        }
        try {
            return method.invoke(
                    SessionReplayManager.get(),
                    bytes,
                    json.getInt("width"),
                    json.getInt("height"),
                    (float) json.optDouble("quality", 0.45),
                    json.optInt("maxFrameBytes", 40 * 1024));
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw error;
        }
    }

    private static byte[] readFile(File file) throws Exception {
        FileInputStream input = new FileInputStream(file);
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream((int) Math.min(file.length(), Integer.MAX_VALUE));
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
            return output.toByteArray();
        } finally {
            input.close();
        }
    }}
