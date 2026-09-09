import { FTDefaultAutoTracking } from '../core/auto-tracking.js';
import { FTCocosSDK } from '../core/client.js';
import { FTLogger, FTRUM, FTTrace } from '../core/modules.js';
import { FTCreator2TrackingHooks } from './auto.js';
import { FTCreator2CanvasCapture } from './capture.js';
import { FTCreator2Transport } from './transport.js';

const transport = new FTCreator2Transport();
const capture = new FTCreator2CanvasCapture();
const hooks = new FTCreator2TrackingHooks();
const autoTracking = new FTDefaultAutoTracking(
  new FTRUM(transport),
  new FTLogger(transport),
  new FTTrace(transport),
  hooks,
);

/** Shared SDK entry point for Cocos Creator 2.4 applications. */
export const truewatchSdk = new FTCocosSDK(transport, capture, autoTracking, hooks);

/**
 * Selects the Cocos Creator 2 camera used to capture Session Replay frames.
 * Call this after the camera is available and before starting Replay.
 *
 * @param camera - Active `cc.Camera` instance.
 */
export function setReplayCamera(camera: unknown): void {
  capture.setCamera(camera);
}

export * from '../core/index.js';
