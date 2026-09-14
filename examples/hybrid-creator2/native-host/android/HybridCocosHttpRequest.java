package org.cocos2dx.lib;

import java.io.IOException;
import java.net.HttpURLConnection;

/** Same package as the engine so the sample can call its package-private HTTP entry points. */
public final class HybridCocosHttpRequest {
    private HybridCocosHttpRequest() {}

    /** Run on a worker thread. Resource collection and Trace headers belong to ft-plugin/Agent. */
    public static Result get(String url) throws IOException {
        HttpURLConnection connection = Cocos2dxHttpURLConnection.createHttpURLConnection(url);
        if (connection == null) throw new IOException("Cocos could not create the connection");
        try {
            Cocos2dxHttpURLConnection.setReadAndConnectTimeout(connection, 12000, 12000);
            Cocos2dxHttpURLConnection.setRequestMethod(connection, "GET");
            if (Cocos2dxHttpURLConnection.connect(connection) != 0) {
                throw new IOException("Cocos connection failed");
            }
            int statusCode = Cocos2dxHttpURLConnection.getResponseCode(connection);
            byte[] body = Cocos2dxHttpURLConnection.getResponseContent(connection);
            if (statusCode <= 0 || body == null) throw new IOException("Cocos response read failed");
            return new Result(statusCode, body.length, connection.getClass().getName());
        } finally {
            Cocos2dxHttpURLConnection.disconnect(connection);
        }
    }

    public static final class Result {
        public final int statusCode;
        public final int responseBytes;
        public final String connectionClass;

        private Result(int statusCode, int responseBytes, String connectionClass) {
            this.statusCode = statusCode;
            this.responseBytes = responseBytes;
            this.connectionClass = connectionClass;
        }
    }
}
