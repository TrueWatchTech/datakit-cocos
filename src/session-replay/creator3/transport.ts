import { invokeReplayAsync } from '../core/replay-async-transport.js';
import { native, sys } from 'cc';
import { NATIVE } from 'cc/env';
import { parseTransportResponse, type FTNativeTransport } from '../core/transport.js';
import type { FTValue } from '@truewatchtech/cocos-sdk/plugin-api';

export class FTCreator3ReplayTransport implements FTNativeTransport {
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

  invokeAsync<T = FTValue>(method: string, payload?: unknown): Promise<T | undefined> {
    return invokeReplayAsync<T>(this, method, payload);
  }

  invoke<T = FTValue>(method: string, payload?: unknown): T | undefined {
    if (this.platform === 'unsupported') return undefined;
    const json = payload === undefined ? '{}' : JSON.stringify(payload);
    const raw = this.platform === 'android'
      ? native.reflection.callStaticMethod(
          'com/ft/sdk/cocos/FTCocosReplayBridge',
          'invoke',
          '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;',
          method,
          json,
        )
      : native.reflection.callStaticMethod('FTCocosReplayBridge', 'invoke:payload:', method, json);
    return parseTransportResponse<T>(raw);
  }
}
