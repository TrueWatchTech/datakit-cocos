package com.ft.sdk.cocos;


import com.ft.sdk.DetectFrequency;
import com.ft.sdk.FTLogger;
import com.ft.sdk.FTLoggerConfig;
import com.ft.sdk.FTRUMConfig;
import com.ft.sdk.FTRUMGlobalManager;
import com.ft.sdk.FTSDKConfig;
import com.ft.sdk.FTSdk;
import com.ft.sdk.FTTraceConfig;
import com.ft.sdk.FTTraceManager;
import com.ft.sdk.LogCacheDiscard;
import com.ft.sdk.TraceType;
import com.ft.sdk.garble.bean.AppState;
import com.ft.sdk.garble.bean.NetStatusBean;
import com.ft.sdk.garble.bean.ResourceParams;
import com.ft.sdk.garble.bean.UserData;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Cocos reflection entry point. All calls and responses are JSON envelopes. */
public final class FTCocosBridge {
    private static final String COCOS_SDK_VERSION_KEY = "sdk_package_cocos";

    private FTCocosBridge() {
    }

    public static String invoke(String method, String payload) {
        return FTBridgeTransport.invoke("sdk", method, payload);
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
            case "hybrid.attach":
                attachHybrid(payload);
                return null;
            case "sdk.configure":
                configureSdk(payload);
                return null;
            case "sdk.bindUser":
                bindUser(payload);
                return null;
            case "sdk.unbindUser":
                FTSdk.unbindRumUserData();
                return null;
            case "sdk.shutdown":
                FTSdk.shutDown();
                return null;
            case "rum.configure":
                configureRum(payload);
                return null;
            case "rum.startView":
                FTRUMGlobalManager.get().startView(payload.getString("name"), map(payload.optJSONObject("attributes")));
                return null;
            case "rum.stopView":
                FTRUMGlobalManager.get().stopView(map(payload.optJSONObject("attributes")));
                return null;
            case "rum.addAction":
                FTRUMGlobalManager.get().addAction(payload.getString("name"), payload.optString("type", "click"), map(payload.optJSONObject("attributes")));
                return null;
            case "rum.startAction":
                FTRUMGlobalManager.get().startAction(payload.getString("name"), payload.optString("type", "click"), map(payload.optJSONObject("attributes")));
                return null;
            case "rum.addError":
                FTRUMGlobalManager.get().addError(
                        payload.optString("stack", ""),
                        payload.optString("message", ""),
                        payload.optString("type", "cocos_error"),
                        AppState.getValueFrom(payload.optString("state", "run")),
                        map(payload.optJSONObject("attributes")));
                return null;
            case "rum.addLongTask":
                FTRUMGlobalManager.get().addLongTask(payload.optString("stack", ""), payload.optLong("durationNs"), map(payload.optJSONObject("attributes")));
                return null;
            case "rum.startResource":
                FTRUMGlobalManager.get().startResource(payload.getString("key"), map(payload.optJSONObject("attributes")));
                return null;
            case "rum.stopResource":
                FTRUMGlobalManager.get().stopResource(payload.getString("key"), map(payload.optJSONObject("attributes")));
                return null;
            case "rum.addResource":
                addResource(payload);
                return null;
            case "logger.configure":
                configureLogger(payload);
                return null;
            case "logger.log":
                FTLogger.getInstance().logBackground(
                        payload.optString("content", ""),
                        payload.optString("level", "info"),
                        map(payload.optJSONObject("attributes")));
                return null;
            case "trace.configure":
                configureTrace(payload);
                return null;
            case "trace.getHeaders":
                return FTTraceManager.get().getTraceHeader(
                        payload.optString("resourceKey", ""), payload.getString("url"));
            default:
                throw new IllegalArgumentException("Unknown bridge method: " + method);
        }
    }

    private static void attachHybrid(JSONObject json) throws Exception {
        ensureNativeHostInitialized();
        if (hasText(json, "sdkVersion")) {
            FTSdk.appendGlobalContext(COCOS_SDK_VERSION_KEY, json.getString("sdkVersion"));
        }
    }

    private static void ensureNativeHostInitialized() {
        if (FTSdk.get() == null) {
            throw new IllegalStateException(
                    "The native host must install the native SDK before FTCocosSDK.attach()");
        }
    }

    private static void configureSdk(JSONObject json) throws Exception {
        FTSDKConfig config;
        if (hasText(json, "datakitUrl")) {
            config = FTSDKConfig.builder(json.getString("datakitUrl"));
        } else if (hasText(json, "datawayUrl") && hasText(json, "clientToken")) {
            config = FTSDKConfig.builder(json.getString("datawayUrl"), json.getString("clientToken"));
        } else {
            throw new IllegalArgumentException("datakitUrl or datawayUrl/clientToken is required");
        }
        if (json.has("debug")) config.setDebug(json.getBoolean("debug"));
        if (hasText(json, "env")) config.setEnv(json.getString("env"));
        if (hasText(json, "serviceName")) config.setServiceName(json.getString("serviceName"));
        addStringContext(json.optJSONObject("globalContext"), new StringContextSetter() {
            @Override public void set(String key, String value) { config.addGlobalContext(key, value); }
        });
        FTSdk.install(config);
    }

    private static void bindUser(JSONObject json) throws Exception {
        if (!json.has("userName") && !json.has("userEmail") && !json.has("extra")) {
            FTSdk.bindRumUserData(json.getString("userId"));
            return;
        }
        UserData data = new UserData();
        data.setId(json.getString("userId"));
        if (hasText(json, "userName")) data.setName(json.getString("userName"));
        if (hasText(json, "userEmail")) data.setEmail(json.getString("userEmail"));
        JSONObject extra = json.optJSONObject("extra");
        if (extra != null) data.setExts(stringMap(extra));
        FTSdk.bindRumUserData(data);
    }

    private static void configureRum(JSONObject json) throws Exception {
        String appId = json.optString("androidAppId", "");
        if (appId.isEmpty()) throw new IllegalArgumentException("rum.androidAppId is required on Android");
        final FTRUMConfig config = new FTRUMConfig().setRumAppId(appId);
        if (json.has("sampleRate")) config.setSamplingRate((float) json.getDouble("sampleRate"));
        if (json.has("sessionOnErrorSampleRate")) config.setSessionErrorSampleRate((float) json.getDouble("sessionOnErrorSampleRate"));
        if (json.has("enableNativeUserAction")) config.setEnableTraceUserAction(json.getBoolean("enableNativeUserAction"));
        if (json.has("enableNativeUserView")) config.setEnableTraceUserView(json.getBoolean("enableNativeUserView"));
        if (json.has("enableNativeUserResource")) config.setEnableTraceUserResource(json.getBoolean("enableNativeUserResource"));
        if (json.has("enableNativeCrash")) config.setEnableTrackAppCrash(json.getBoolean("enableNativeCrash"));
        if (json.has("enableNativeAnr")) config.setEnableTrackAppANR(json.getBoolean("enableNativeAnr"));
        if (json.has("enableNativeUiBlock")) {
            boolean enabled = json.getBoolean("enableNativeUiBlock");
            if (json.has("nativeUiBlockDurationMs")) config.setEnableTrackAppUIBlock(enabled, json.getLong("nativeUiBlockDurationMs"));
            else config.setEnableTrackAppUIBlock(enabled);
        }
        if (json.has("errorMonitorType")) config.setExtraMonitorTypeWithError(json.getInt("errorMonitorType"));
        if (json.has("deviceMetricsMonitorType")) {
            config.setDeviceMetricsMonitorType(json.getInt("deviceMetricsMonitorType"), detectFrequency(json.optString("detectFrequency", "normal")));
        }
        addStringContext(json.optJSONObject("globalContext"), new StringContextSetter() {
            @Override public void set(String key, String value) { config.addGlobalContext(key, value); }
        });
        FTSdk.initRUMWithConfig(config);
    }

    private static void configureLogger(JSONObject json) throws Exception {
        final FTLoggerConfig config = new FTLoggerConfig();
        if (json.has("sampleRate")) config.setSamplingRate((float) json.getDouble("sampleRate"));
        if (json.has("enableLinkRumData")) config.setEnableLinkRumData(json.getBoolean("enableLinkRumData"));
        if (json.has("enableCustomLog")) config.setEnableCustomLog(json.getBoolean("enableCustomLog"));
        if (json.has("printCustomLogToConsole")) config.setPrintCustomLogToConsole(json.getBoolean("printCustomLogToConsole"));
        if (json.has("logCacheLimitCount")) config.setLogCacheLimitCount(json.getInt("logCacheLimitCount"));
        if ("discardOldest".equals(json.optString("discardStrategy"))) config.setLogCacheDiscardStrategy(LogCacheDiscard.DISCARD_OLDEST);
        JSONArray levels = json.optJSONArray("logLevelFilters");
        if (levels != null) config.setLogLevelFilters(stringArray(levels));
        addStringContext(json.optJSONObject("globalContext"), new StringContextSetter() {
            @Override public void set(String key, String value) { config.addGlobalContext(key, value); }
        });
        FTSdk.initLogWithConfig(config);
    }

    private static void configureTrace(JSONObject json) throws Exception {
        FTTraceConfig config = new FTTraceConfig();
        if (json.has("sampleRate")) config.setSamplingRate((float) json.getDouble("sampleRate"));
        if (json.has("enableLinkRumData")) config.setEnableLinkRUMData(json.getBoolean("enableLinkRumData"));
        if (json.has("enableNativeAutoTrace")) config.setEnableAutoTrace(json.getBoolean("enableNativeAutoTrace"));
        if (hasText(json, "traceType")) config.setTraceType(traceType(json.getString("traceType")));
        FTSdk.initTraceWithConfig(config);
    }

    private static void addResource(JSONObject payload) throws Exception {
        JSONObject content = payload.getJSONObject("content");
        ResourceParams params = new ResourceParams();
        params.url = content.optString("url", "");
        params.resourceMethod = content.optString("httpMethod", "GET");
        params.responseBody = content.optString("responseBody", "");
        params.resourceStatus = content.optInt("statusCode", 0);
        params.responseContentType = content.optString("responseContentType", "");
        params.responseContentEncoding = content.optString("responseContentEncoding", "");
        params.requestHeaderMap = headerMap(content.optJSONObject("requestHeaders"));
        params.responseHeaderMap = headerMap(content.optJSONObject("responseHeaders"));

        JSONObject metrics = payload.optJSONObject("metrics");
        NetStatusBean status = new NetStatusBean();
        if (metrics != null) {
            status.callStartTime = metric(metrics, "fetchStartTime");
            status.tcpStartTime = metric(metrics, "tcpStartTime");
            status.tcpEndTime = metric(metrics, "tcpEndTime");
            status.dnsStartTime = metric(metrics, "dnsStartTime");
            status.dnsEndTime = metric(metrics, "dnsEndTime");
            status.headerStartTime = metric(metrics, "responseStartTime");
            status.bodyStartTime = metric(metrics, "responseStartTime");
            status.bodyEndTime = metric(metrics, "responseEndTime");
            status.sslStartTime = metric(metrics, "sslStartTime");
            status.sslEndTime = metric(metrics, "sslEndTime");
        }
        FTRUMGlobalManager.get().addResource(payload.getString("key"), params, status);
    }

    private static TraceType traceType(String value) {
        if ("zipkinMultiHeader".equals(value)) return TraceType.ZIPKIN_MULTI_HEADER;
        if ("zipkinSingleHeader".equals(value)) return TraceType.ZIPKIN_SINGLE_HEADER;
        if ("traceparent".equals(value)) return TraceType.TRACEPARENT;
        if ("skywalking".equals(value)) return TraceType.SKYWALKING;
        if ("jaeger".equals(value)) return TraceType.JAEGER;
        return TraceType.DDTRACE;
    }

    private static DetectFrequency detectFrequency(String value) {
        if ("frequent".equals(value)) return DetectFrequency.FREQUENT;
        if ("rare".equals(value)) return DetectFrequency.RARE;
        return DetectFrequency.DEFAULT;
    }

    private static boolean hasText(JSONObject json, String key) {
        return json.has(key) && !json.optString(key, "").isEmpty();
    }

    private interface StringContextSetter { void set(String key, String value); }

    private static void addStringContext(JSONObject json, StringContextSetter setter) throws Exception {
        if (json == null) return;
        Iterator<String> keys = json.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            setter.set(key, json.optString(key, ""));
        }
    }

    private static HashMap<String, String> stringMap(JSONObject json) throws Exception {
        HashMap<String, String> result = new HashMap<>();
        Iterator<String> keys = json.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            result.put(key, json.optString(key, ""));
        }
        return result;
    }

    private static HashMap<String, Object> map(JSONObject json) throws Exception {
        HashMap<String, Object> result = new HashMap<>();
        if (json == null) return result;
        Iterator<String> keys = json.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            result.put(key, jsonValue(json.get(key)));
        }
        return result;
    }

    private static Object jsonValue(Object value) throws Exception {
        if (value == JSONObject.NULL) return null;
        if (value instanceof JSONObject) return map((JSONObject) value);
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            ArrayList<Object> result = new ArrayList<>();
            for (int i = 0; i < array.length(); i++) result.add(jsonValue(array.get(i)));
            return result;
        }
        return value;
    }

    private static HashMap<String, List<String>> headerMap(JSONObject json) throws Exception {
        HashMap<String, List<String>> result = new HashMap<>();
        if (json == null) return result;
        Iterator<String> keys = json.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            ArrayList<String> values = new ArrayList<>();
            values.add(json.optString(key, ""));
            result.put(key, values);
        }
        return result;
    }

    private static String[] stringArray(JSONArray array) throws Exception {
        String[] result = new String[array.length()];
        for (int i = 0; i < array.length(); i++) result[i] = array.getString(i);
        return result;
    }

    private static long metric(JSONObject json, String name) {
        return json.has(name) ? json.optLong(name, -1) : -1;
    }


}
