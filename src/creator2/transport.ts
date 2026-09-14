import { parseTransportResponse, type FTNativeTransport } from '../core/transport.js';
import type { FTValue } from '../core/types.js';

export class FTCreator2Transport implements FTNativeTransport {
  readonly platform: 'android' | 'ios' | 'unsupported' = resolveCreator2Platform();

  invoke<T = FTValue>(method: string, payload?: unknown): T | undefined {
    if (this.platform === 'unsupported') return undefined;
    const json = payload === undefined ? '{}' : JSON.stringify(payload);
    const raw = this.platform === 'android'
      ? jsb.reflection.callStaticMethod(
          'com/ft/sdk/cocos/FTCocosBridge',
          'invoke',
          '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;',
          method,
          json,
        )
      : jsb.reflection.callStaticMethod('FTCocosBridge', 'invoke:payload:', method, json);
    return parseTransportResponse<T>(raw);
  }
}

function resolveCreator2Platform(): 'android' | 'ios' | 'unsupported' {
  const isNative = (typeof CC_JSB !== 'undefined' && CC_JSB) || typeof jsb !== 'undefined';
  if (!isNative) return 'unsupported';
  if (
    (typeof CC_ANDROID !== 'undefined' && CC_ANDROID)
    || (typeof cc !== 'undefined' && cc.sys?.os === cc.sys.OS_ANDROID)
  ) return 'android';
  if (
    (typeof CC_IOS !== 'undefined' && CC_IOS)
    || (typeof cc !== 'undefined' && cc.sys?.os === cc.sys.OS_IOS)
  ) return 'ios';
  return 'unsupported';
}
