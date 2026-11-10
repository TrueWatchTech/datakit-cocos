import { FTCreator2TrackingHooks } from '../creator2/auto.js';
import { FTCocosWebSDK } from './client.js';
import { platformImplementation } from '../core/platform-runtime.js';
import { isScenePublic } from './privacy.js';

/** Web-only entry; no native bridge or native Replay dependencies. */
const hooks = new FTCreator2TrackingHooks();
const canvasIsPublic = () => isScenePublic(cc.director.getScene(), false);
export const truewatchSdk = platformImplementation({ engine: 'creator2', platform: 'web', hooks, canvasIsPublic }, undefined,
  () => new FTCocosWebSDK(hooks, canvasIsPublic)) as FTCocosWebSDK;
export type * from './types.js';
export * from '../core/index.js';
