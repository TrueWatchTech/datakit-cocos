import type { FTEngineTrackingHooks } from './auto-tracking.js';
import type { FTCocosConfig, FTCocosHybridConfig } from './types.js';
import type { FTNativeReplayConfig } from './platform-options.js';
import type { FTCocosSDK } from './client.js';
import type { FTCocosWebSDK } from '../web/client.js';
import { FT_COCOS_SDK_VERSION } from './version.js';
import type { FTJsbErrorGlobal } from '../native/jsb-errors.js';

export interface FTPlatformContext {
  engine: 'creator2' | 'creator3';
  platform: 'android' | 'ios' | 'unsupported' | 'web';
  hooks: FTEngineTrackingHooks;
  canvasIsPublic: () => boolean;
  engineApi?: unknown;
  reflection?: { callStaticMethod(...args: string[]): unknown };
}
export type FTPlatformImplementation = FTCocosSDK | FTCocosWebSDK;
export interface FTPlatformFactory {
  protocol: 1;
  version: string;
  create(context: FTPlatformContext, target: FTPlatformGlobal): FTPlatformImplementation;
}
export interface FTNativeReplayFacade {
  start(config: FTCocosConfig & { replay?: FTNativeReplayConfig }): void;
  attach(config: FTCocosHybridConfig & { replay?: FTNativeReplayConfig }): void;
  replay: {
    start(config?: FTNativeReplayConfig): void;
    stop(): void;
    enterHybrid(): void;
    leaveHybrid(): void;
  };
}
export interface FTPlatformGlobal extends FTJsbErrorGlobal {
  __FT_COCOS_CONFIGURATION__?: FTCocosConfig & { replay?: FTNativeReplayConfig };
  __FT_COCOS_REPLAY_FACTORY__?: {
    protocol: 1; version: string; engine: string;
    create(base: FTCocosSDK, context: FTPlatformContext): FTNativeReplayFacade;
  };
  __FT_COCOS_NATIVE_FACTORY__?: FTPlatformFactory;
  __FT_COCOS_WEB_FACTORY__?: FTPlatformFactory;
  __FT_COCOS_INSTANCES__?: Record<string, { version: string; sdk: FTPlatformImplementation; replay?: FTNativeReplayFacade; replayConfig?: FTNativeReplayConfig }>;
}
export function platformGlobal(): FTPlatformGlobal {
  return (typeof window !== 'undefined' ? window : globalThis) as FTPlatformGlobal;
}

export function existingPlatformImplementation(context: FTPlatformContext, target = platformGlobal()): FTPlatformImplementation | undefined {
  const previous = target.__FT_COCOS_INSTANCES__?.[context.engine + ':' + context.platform];
  if (previous && previous.version !== FT_COCOS_SDK_VERSION) throw new Error('Cocos SDK versions must match on the same page');
  return previous?.sdk;
}

/** The engine module graph contains no platform implementation. Build assets supply factories. */
export function platformImplementation(context: FTPlatformContext, target = platformGlobal(), create?: () => FTPlatformImplementation): FTPlatformImplementation {
  const key = context.engine + ':' + context.platform;
  const instances = target.__FT_COCOS_INSTANCES__ || (target.__FT_COCOS_INSTANCES__ = {});
  const previous = existingPlatformImplementation(context, target);
  if (previous) return previous;
  const factory = context.platform === 'web' ? target.__FT_COCOS_WEB_FACTORY__ : target.__FT_COCOS_NATIVE_FACTORY__;
  if (!create && (!factory || factory.protocol !== 1 || factory.version !== FT_COCOS_SDK_VERSION)) {
    throw new Error(context.platform === 'web'
      ? 'Cocos Web runtime is missing or incompatible. Run the installer with --web and rebuild, or load /web/bootstrap before game scripts.'
      : 'Cocos native runtime is missing or incompatible. Rerun the SDK installer and rebuild the project.');
  }
  const sdk = create ? create() : factory!.create(context, target);
  instances[key] = { version: FT_COCOS_SDK_VERSION, sdk };
  return sdk;
}
