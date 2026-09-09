import { native, sys } from 'cc';
import { NATIVE } from 'cc/env';
import { parseTransportResponse, type FTNativeTransport } from '../core/transport.js';
import type { FTValue } from '../core/types.js';

export class FTCreator3Transport implements FTNativeTransport {
  readonly platform: 'android' | 'ios' | 'unsupported';

  constructor() {
    this.platform = !NATIVE
      ? 'unsupported'
      : sys.os === sys.OS.ANDROID
        ? 'android'
        : sys.os === sys.OS.IOS
          ? 'ios'
          : 'unsupported';
  }

  invoke<T = FTValue>(method: string, payload?: unknown): T | undefined {
    if (this.platform === 'unsupported') return undefined;
    const json = payload === undefined ? '{}' : JSON.stringify(payload);
    const raw = this.platform === 'android'
      ? native.reflection.callStaticMethod(
          'com/ft/sdk/cocos/FTCocosBridge',
          'invoke',
          '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;',
          method,
          json,
        )
      : native.reflection.callStaticMethod('FTCocosBridge', 'invoke:payload:', method, json);
    return parseTransportResponse<T>(raw);
  }
}
