package com.ft.sdk.cocos;

import org.json.JSONObject;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** One image in flight across JS runtimes; the caller polls without waiting on disk/encoding. */
final class FTCocosReplayImageJobs {
    private static final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "cocos-replay-image");
        thread.setDaemon(true);
        return thread;
    });
    private static Job current;

    private static final class Job {
        final String id = UUID.randomUUID().toString();
        String response;
    }

    static synchronized String begin(JSONObject arguments) throws Exception {
        final String method = arguments.getString("method");
        if (!"replay.saveImage".equals(method) && !"replay.saveImageV2".equals(method)) {
            throw new IllegalArgumentException("Unsupported asynchronous Replay method");
        }
        final String payload = arguments.getJSONObject("arguments").toString();
        if (current != null && current.response == null) throw new IllegalStateException("Replay encoder is busy");
        final Job job = new Job();
        current = job;
        try {
            worker.execute(() -> {
                String response = FTCocosBridge.invokeLocal(method, payload);
                synchronized (FTCocosReplayImageJobs.class) {
                    job.response = response;
                }
            });
        } catch (RuntimeException error) {
            current = null;
            throw error;
        }
        return job.id;
    }

    static synchronized JSONObject poll(String id) throws Exception {
        if (current == null || !current.id.equals(id)) throw new IllegalArgumentException("Replay encoding job is unavailable");
        JSONObject result = new JSONObject();
        result.put("pending", current.response == null);
        if (current.response != null) {
            result.put("response", current.response);
            current = null;
        }
        return result;
    }
}
