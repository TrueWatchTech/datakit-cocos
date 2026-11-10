import { FTDefaultAutoTracking } from '../core/auto-tracking.js';
import { FTCocosSDK } from '../core/client.js';
import { FTLogger, FTRUM, FTTrace } from '../core/modules.js';
import { parseTransportResponse, type FTNativeTransport } from '../core/transport.js';
import { platformGlobal, type FTPlatformContext } from '../core/platform-runtime.js';
import { FT_COCOS_SDK_VERSION } from '../core/version.js';

/** Installed as a native/Editor plugin script; never imported by the game's module graph. */
platformGlobal().__FT_COCOS_NATIVE_FACTORY__ = {
  protocol: 1,
  version: FT_COCOS_SDK_VERSION,
  create(context: FTPlatformContext, target = platformGlobal()): FTCocosSDK {
    if (context.platform === 'web') throw new Error('Native runtime cannot serve a Web application');
    const transport: FTNativeTransport = {
      platform: context.platform,
      invoke<T>(method: string, payload?: unknown): T | undefined {
        if (context.platform === 'unsupported') return undefined;
        if (!context.reflection) throw new Error('Cocos native reflection is unavailable');
        const json = payload === undefined ? '{}' : JSON.stringify(payload);
        const raw = context.platform === 'android'
          ? context.reflection.callStaticMethod('com/ft/sdk/cocos/FTCocosBridge', 'invoke', '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;', method, json)
          : context.reflection.callStaticMethod('FTCocosBridge', 'invoke:payload:', method, json);
        return parseTransportResponse<T>(raw);
      },
    };
    const tracking = new FTDefaultAutoTracking(new FTRUM(transport), new FTLogger(transport), new FTTrace(transport), context.hooks, target);
    return new FTCocosSDK(transport, tracking, context.engine);
  },
};
