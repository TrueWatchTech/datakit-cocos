package com.truewatch.cocos.sample;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.IOException;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Native landing page used to verify native and Cocos telemetry in one app. */
public final class HybridSampleNativeActivity extends Activity {
    private static final String COCOS_ACTIVITY = "org.cocos2dx.javascript.AppActivity";
    private static final String AUTO_REQUEST_URL =
            "https://httpbin.org/get?sample=cocos-hybrid-creator2&layer=native-auto";
    private static volatile boolean visible;

    // Keep Builder.build() in app code so ft-plugin can inject Resource and Trace interceptors.
    private final OkHttpClient httpClient = new OkHttpClient.Builder().build();
    private TextView status;

    public static boolean isVisible() {
        return visible;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        HybridSampleSdk.start();
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        setContentView(createContent());
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        if (status != null) status.setText("Native page active · ft-plugin tracks this Activity and its OkHttp request");
    }

    @Override
    protected void onPause() {
        visible = false;
        super.onPause();
    }

    private LinearLayout createContent() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(48), dp(36), dp(48), dp(36));
        root.setBackgroundColor(Color.rgb(12, 18, 34));

        TextView title = text("Cocos Hybrid · Native Android Page", 30, Color.WHITE);
        root.addView(title, matchWrap(dp(16)));

        TextView subtitle = text(
                "Native SDK owns initialization. Open Cocos to transfer RUM View and Replay ownership.",
                17,
                Color.rgb(151, 164, 190));
        root.addView(subtitle, matchWrap(dp(28)));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);

        Button nativeRequest = button("Native Auto Network");
        nativeRequest.setOnClickListener(view -> requestWithOkHttp());
        actions.addView(nativeRequest, weighted(dp(12)));

        Button openCocos = button("Open Cocos Page");
        openCocos.setOnClickListener(view -> openCocos());
        actions.addView(openCocos, weighted(0));
        root.addView(actions, matchWrap(dp(34)));

        status = text("Preparing native telemetry…", 17, Color.rgb(44, 202, 178));
        status.setBackgroundColor(Color.rgb(27, 39, 64));
        status.setPadding(dp(20), dp(16), dp(20), dp(16));
        root.addView(status, matchWrap(0));
        return root;
    }

    private void openCocos() {
        status.setText("Opening Cocos page…");
        Intent intent = new Intent();
        intent.setClassName(getPackageName(), COCOS_ACTIVITY);
        // Creator 2's Cocos2dxActivity requires itself to be the task root.
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
    }

    private void requestWithOkHttp() {
        status.setText("Native OkHttp request in progress…");
        Request request = new Request.Builder()
                .url(AUTO_REQUEST_URL + "&request_id=" + System.currentTimeMillis())
                .build();
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException error) {
                runOnUiThread(() -> status.setText("Native auto request failed: " + error.getMessage()));
            }

            @Override
            public void onResponse(Call call, Response response) {
                int statusCode = response.code();
                response.close();
                runOnUiThread(() -> status.setText(
                        "Native auto Resource + Trace completed (" + statusCode + ")"));
            }
        });
    }

    private TextView text(String value, int sizeSp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER);
        return view;
    }

    private Button button(String value) {
        Button button = new Button(this);
        button.setText(value);
        button.setTextSize(17);
        button.setAllCaps(false);
        return button;
    }

    private LinearLayout.LayoutParams matchWrap(int bottomMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.bottomMargin = bottomMargin;
        return params;
    }

    private LinearLayout.LayoutParams weighted(int endMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(58), 1f);
        params.setMarginEnd(endMargin);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
