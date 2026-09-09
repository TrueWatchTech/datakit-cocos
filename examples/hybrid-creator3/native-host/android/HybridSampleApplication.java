package com.truewatch.cocos.sample;

import android.app.Application;

import com.ft.sdk.FTAutoTrack;
import com.ft.sdk.garble.annotation.IgnoreAOP;

/** Installs the native SDK before ft-plugin instruments the first Activity lifecycle callback. */
@IgnoreAOP
public final class HybridSampleApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        HybridSampleSdk.start();
        // ft-plugin normally injects this call at method entry. This sample defers it
        // until after SDK installation so the first native Activity has a valid View.
        FTAutoTrack.startApp(this);
    }
}
