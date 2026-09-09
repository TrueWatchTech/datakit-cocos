package com.truewatch.cocos.sample;

import android.app.ActivityManager;
import android.app.Application;
import android.content.Context;
import android.os.Build;
import android.os.Process;

import com.ft.sdk.FTAutoTrack;
import com.ft.sdk.garble.annotation.IgnoreAOP;

/** Installs the native SDK before ft-plugin instruments the first Activity lifecycle callback. */
@IgnoreAOP
public final class HybridSampleApplication extends Application {
    private static volatile boolean mainProcess;

    @Override
    public void onCreate() {
        super.onCreate();
        mainProcess = getPackageName().equals(currentProcessName(this));
        if (!mainProcess) return;
        HybridSampleSdk.start();
        // ft-plugin normally injects this call at method entry. This sample defers it
        // until after SDK installation so the first native Activity has a valid View.
        FTAutoTrack.startApp(this);
    }

    static boolean isMainProcess() {
        return mainProcess;
    }

    private static String currentProcessName(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return Application.getProcessName();
        }
        ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (manager == null || manager.getRunningAppProcesses() == null) return "";
        int currentPid = Process.myPid();
        for (ActivityManager.RunningAppProcessInfo process : manager.getRunningAppProcesses()) {
            if (process.pid == currentPid) return process.processName;
        }
        return "";
    }
}
