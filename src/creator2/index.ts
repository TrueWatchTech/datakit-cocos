import { FTCocosPlatformSDK } from '../core/platform-client.js';
import { FTCreator2TrackingHooks } from './auto.js';
import { isScenePublic } from '../web/privacy.js';

const hooks = new FTCreator2TrackingHooks();
/** Shared native and Web entry point for Cocos Creator 2.4 applications. */
export const truewatchSdk = new FTCocosPlatformSDK('creator2', () => {
  const isNative = (typeof CC_JSB !== 'undefined' && CC_JSB) || typeof jsb !== 'undefined';
  const platform = typeof CC_EDITOR !== 'undefined' && CC_EDITOR ? 'unsupported' : !isNative ? 'web'
    : (typeof CC_ANDROID !== 'undefined' && CC_ANDROID) || cc.sys.os === cc.sys.OS_ANDROID ? 'android'
      : (typeof CC_IOS !== 'undefined' && CC_IOS) || cc.sys.os === cc.sys.OS_IOS ? 'ios' : 'unsupported';
  return { engine: 'creator2', platform, hooks, engineApi: cc,
    reflection: isNative && typeof jsb !== 'undefined' ? jsb.reflection : undefined,
    canvasIsPublic: () => isScenePublic(cc.director.getScene(), false) };
});
export * from '../core/index.js';
export type { FTCocosPlatformConfig } from '../core/platform-client.js';
export type { FTCocosWebConfig, FTWebConfig, FTWebReplayConfig } from '../web/types.js';
export type { FTNativeReplayConfig, FTCocosProjectConfiguration } from '../core/platform-options.js';
