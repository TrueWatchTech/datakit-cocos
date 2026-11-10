import { Camera, Director, EditBox, Input, Node, RenderTexture, UITransform, Vec3, director, input, isValid, native, screen, sys, view } from 'cc';
import { EDITOR, NATIVE } from 'cc/env';
import { FTCocosPlatformSDK } from '../core/platform-client.js';
import { FTCreator3TrackingHooks } from './auto.js';
import { isScenePublic } from '../web/privacy.js';

const hooks = new FTCreator3TrackingHooks();
/** Shared native and Web entry point for Cocos Creator 3.x applications. */
export const truewatchSdk = new FTCocosPlatformSDK('creator3', () => ({
  engine: 'creator3',
  platform: EDITOR ? 'unsupported' : !NATIVE ? 'web' : sys.os === sys.OS.ANDROID ? 'android' : sys.os === sys.OS.IOS ? 'ios' : 'unsupported',
  reflection: NATIVE ? native.reflection : undefined,
  hooks,
  engineApi: { Camera, Director, EditBox, Input, Node, RenderTexture, UITransform, Vec3, director, input, isValid, native, screen, sys, view },
  canvasIsPublic: () => isScenePublic(director.getScene()),
}));
export * from '../core/index.js';
export type { FTCocosPlatformConfig } from '../core/platform-client.js';
export type { FTCocosWebConfig, FTWebConfig, FTWebReplayConfig } from '../web/types.js';
export type { FTNativeReplayConfig, FTCocosProjectConfiguration } from '../core/platform-options.js';
