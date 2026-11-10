import { describe, expect, it } from 'vitest';
import { FTCocosSDK } from '../src/core/client';
import type { FTNativeTransport } from '../src/core/transport';
import type { FTSDKConfig } from '../src/core/types';

class RecordingTransport implements FTNativeTransport {
  readonly platform = 'android' as const;
  readonly calls: Array<{ method: string; payload: Record<string, unknown> }> = [];

  invoke<T>(method: string, payload?: unknown): T | undefined {
    this.calls.push({ method, payload: JSON.parse(JSON.stringify(payload ?? {})) });
    return undefined;
  }

  payload(method: string): Record<string, unknown> {
    const call = this.calls.find(candidate => candidate.method === method);
    if (!call) throw new Error(`Missing ${method} bridge call`);
    return call.payload;
  }
}

describe('WebView native configuration', () => {
  it.each([undefined, null, [], ['example.com', 'checkout.example.net']].map(hosts => ({ hosts })))(
    'preserves the host configuration across JSON transport: $hosts', ({ hosts }) => {
      const transport = new RecordingTransport();
      const sdk = new FTCocosSDK(transport);
      sdk.start({ sdk: { datakitUrl: 'https://datakit.example', allowWebViewHost: hosts } });

      const payload = transport.payload('sdk.configure');
      if (hosts === undefined) expect(payload).not.toHaveProperty('allowWebViewHost');
      else expect(payload.allowWebViewHost).toEqual(hosts);
    },
  );

  it.each([true, false])('forwards the RUM switch %s independently of WebView logs', (enabled) => {
    const transport = new RecordingTransport();
    const sdk = new FTCocosSDK(transport);
    sdk.start({
      sdk: { datakitUrl: 'https://datakit.example' },
      rum: { androidAppId: 'android-app', iosAppId: 'ios-app', enableTraceWebView: enabled },
      logger: { enableCustomLog: false, enableWebViewLog: !enabled },
    });

    expect(transport.payload('rum.configure')).toMatchObject({ enableTraceWebView: enabled });
    expect(transport.payload('logger.configure')).toMatchObject({
      enableCustomLog: false, enableWebViewLog: !enabled,
    });
  });

  it('leaves native WebView defaults untouched when options are omitted', () => {
    const transport = new RecordingTransport();
    new FTCocosSDK(transport).start({
      sdk: { datakitUrl: 'https://datakit.example' },
      rum: { androidAppId: 'app' },
      logger: {},
    });

    expect(transport.payload('sdk.configure')).not.toHaveProperty('allowWebViewHost');
    expect(transport.payload('rum.configure')).not.toHaveProperty('enableTraceWebView');
    expect(transport.payload('logger.configure')).not.toHaveProperty('enableWebViewLog');
  });

  it.each(['example.com', {}, [null], [1], new Array(1)].map(hosts => ({ hosts })))(
    'rejects malformed host configuration before native initialization: $hosts', ({ hosts }) => {
      const transport = new RecordingTransport();
      const sdk = new FTCocosSDK(transport);
      expect(() => sdk.start({ sdk: {
        datakitUrl: 'https://datakit.example', allowWebViewHost: hosts,
      } as FTSDKConfig })).toThrow('sdk.allowWebViewHost');
      expect(transport.calls).toEqual([]);
      expect(() => sdk.attach()).not.toThrow();
    },
  );
});
