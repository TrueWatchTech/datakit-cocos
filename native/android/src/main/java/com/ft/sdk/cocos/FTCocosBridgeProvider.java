package com.ft.sdk.cocos;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/**
 * App-private bridge that lets a Cocos engine process use the native SDK owned
 * by the application's main process.
 */
public final class FTCocosBridgeProvider extends ContentProvider {
    static final String AUTHORITY_SUFFIX = ".ft.cocos.bridge";
    static final String METHOD_INVOKE = "invoke";
    static final String ARGUMENT_PAYLOAD = "payload";
    static final String RESULT_RESPONSE = "response";

    @Override
    public boolean onCreate() {
        return true;
    }

    @Nullable
    @Override
    public Bundle call(@NonNull String method, @Nullable String argument, @Nullable Bundle extras) {
        if (!METHOD_INVOKE.equals(method) || argument == null) {
            return super.call(method, argument, extras);
        }
        String payload = extras == null ? null : extras.getString(ARGUMENT_PAYLOAD);
        Bundle result = new Bundle();
        result.putString(RESULT_RESPONSE, FTCocosBridge.invokeLocal(argument, payload));
        return result;
    }

    @Nullable
    @Override
    public String getType(@NonNull Uri uri) {
        return null;
    }

    @Nullable
    @Override
    public Cursor query(@NonNull Uri uri, @Nullable String[] projection,
                        @Nullable String selection, @Nullable String[] selectionArgs,
                        @Nullable String sortOrder) {
        return null;
    }

    @Nullable
    @Override
    public Uri insert(@NonNull Uri uri, @Nullable ContentValues values) {
        return null;
    }

    @Override
    public int delete(@NonNull Uri uri, @Nullable String selection,
                      @Nullable String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(@NonNull Uri uri, @Nullable ContentValues values,
                      @Nullable String selection, @Nullable String[] selectionArgs) {
        return 0;
    }
}
