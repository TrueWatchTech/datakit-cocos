import { director } from 'cc';
import { FTCreator3TrackingHooks } from '../creator3/auto.js';
import { FTCocosWebSDK } from './client.js';
import { platformImplementation } from '../core/platform-runtime.js';
import { isScenePublic } from './privacy.js';

/** Web-only entry; no native bridge or native Replay dependencies. */
const hooks = new FTCreator3TrackingHooks();
const canvasIsPublic = () => isScenePublic(director.getScene());
export const truewatchSdk = platformImplementation({ engine: 'creator3', platform: 'web', hooks, canvasIsPublic }, undefined,
  () => new FTCocosWebSDK(hooks, canvasIsPublic)) as FTCocosWebSDK;
export type * from './types.js';
export * from '../core/index.js';
