package com.ft.sdk.cocos;

/** SDK-managed endpoint allowlist, regenerated when optional modules change. */
final class FTCocosBridgeModules {
    static String invokeLocal(String endpoint, String method, String payload) {
        if ("sdk".equals(endpoint)) return FTCocosBridge.invokeLocal(method, payload);
        return "{\"ok\":false,\"error\":\"Native SDK extension is not installed; rerun the integration installer\"}";
    }
}
