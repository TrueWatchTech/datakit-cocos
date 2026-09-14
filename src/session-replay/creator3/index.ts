import type { FTCocosSDK } from '@truewatchtech/cocos-sdk/plugin-api';
import { composeSessionReplay, type FTCocosReplaySDK } from '../core/client.js';
import { FTCreator3CanvasCapture } from './capture.js';
import { FTCreator3ReplayTransport } from './transport.js';
import { FTCreator3PointerSource } from './pointer.js';

/** Adds Session Replay to the matching Creator SDK before start or attach. */
export function withSessionReplay(sdk: FTCocosSDK): FTCocosReplaySDK {
  return composeSessionReplay(sdk, 'creator3', () => ({
    transport: new FTCreator3ReplayTransport(),
    capture: new FTCreator3CanvasCapture(),
    pointers: new FTCreator3PointerSource(),
  }));
}

export type { FTCocosReplaySDK } from '../core/client.js';
export type { FTCocosReplayConfig, FTCocosHybridReplayConfig, FTSessionReplayConfig,
  FTHybridSessionReplayConfig, FTReplayImagePolicy, FTReplayPrivacyMode,
  FTReplayQuality, FTReplayTouchPrivacy } from '../core/types.js';
export { FT_COCOS_REPLAY_VERSION } from '../core/version.js';
