package com.ft.sdk.cocos;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.Application;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Process;
import java.util.List;

/** Shared process routing. Optional modules are selected by the generated allowlist. */
public final class FTBridgeTransport {
    private FTBridgeTransport() {}
    public static String invoke(String endpoint, String method, String payload) {
        String forwarded = forwardToMainProcess(endpoint, method, payload);
        return forwarded != null ? forwarded : FTCocosBridgeModules.invokeLocal(endpoint, method, payload);
    }

    private static String forwardToMainProcess(String endpoint, String method, String payload) {
        Activity activity = resolveActivity();
        if (activity == null || !isSecondaryProcess(activity)) return null;

        try {
            Bundle arguments = new Bundle();
            arguments.putString("endpoint", endpoint);
            arguments.putString(FTCocosBridgeProvider.ARGUMENT_PAYLOAD, payload);
            Uri uri = Uri.parse("content://" + activity.getPackageName()
                    + FTCocosBridgeProvider.AUTHORITY_SUFFIX);
            Bundle result = activity.getContentResolver().call(
                    uri,
                    FTCocosBridgeProvider.METHOD_INVOKE,
                    method,
                    arguments);
            return result == null
                    ? null
                    : result.getString(FTCocosBridgeProvider.RESULT_RESPONSE);
        } catch (IllegalArgumentException providerUnavailable) {
            // Existing integrations may not have registered the optional bridge
            // provider yet. Preserve their same-process behavior.
            return null;
        }
    }

    private static boolean isSecondaryProcess(Context context) {
        String currentProcess = currentProcessName(context);
        String mainProcess = context.getApplicationInfo().processName;
        return currentProcess != null && mainProcess != null && !mainProcess.equals(currentProcess);
    }

    private static String currentProcessName(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return Application.getProcessName();
        }
        ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (manager == null) return null;
        List<ActivityManager.RunningAppProcessInfo> processes = manager.getRunningAppProcesses();
        if (processes == null) return null;
        int currentPid = Process.myPid();
        for (ActivityManager.RunningAppProcessInfo process : processes) {
            if (process.pid == currentPid) return process.processName;
        }
        return null;
    }

    public static Activity resolveActivity() {
        String[] classNames = {"com.cocos.lib.CocosActivity", "org.cocos2dx.lib.Cocos2dxActivity"};
        String[] methodNames = {"getContext", "getActivity"};
        for (String className : classNames) {
            for (String methodName : methodNames) {
                try {
                    Object value = Class.forName(className).getMethod(methodName).invoke(null);
                    if (value instanceof Activity) return (Activity) value;
                    if (value instanceof Context && ((Context) value).getApplicationContext() instanceof Activity) {
                        return (Activity) ((Context) value).getApplicationContext();
                    }
                } catch (Throwable ignored) {
                }
            }
        }
        return null;
    }

}
