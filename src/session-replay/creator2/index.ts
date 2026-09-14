import type { FTCocosSDK } from '@truewatchtech/cocos-sdk/plugin-api';
import { composeSessionReplay, type FTCocosReplaySDK } from '../core/client.js';
import { FTCreator2CanvasCapture } from './capture.js';
import { FTCreator2ReplayTransport } from './transport.js';
import { FTCreator2PointerSource } from './pointer.js';

/** Adds Session Replay to the matching Creator SDK before start or attach. */
export function withSessionReplay(sdk: FTCocosSDK): FTCocosReplaySDK {
  return composeSessionReplay(sdk, 'creator2', () => ({
    transport: new FTCreator2ReplayTransport(),
    capture: new FTCreator2CanvasCapture(),
    pointers: new FTCreator2PointerSource(),
  }));
}

export type { FTCocosReplaySDK } from '../core/client.js';
export type { FTCocosReplayConfig, FTCocosHybridReplayConfig, FTSessionReplayConfig,
  FTHybridSessionReplayConfig, FTReplayImagePolicy, FTReplayPrivacyMode,
  FTReplayQuality, FTReplayTouchPrivacy } from '../core/types.js';
export { FT_COCOS_REPLAY_VERSION } from '../core/version.js';
