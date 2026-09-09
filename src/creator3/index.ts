import { FTDefaultAutoTracking } from '../core/auto-tracking.js';
import { FTCocosSDK } from '../core/client.js';
import { FTLogger, FTRUM, FTTrace } from '../core/modules.js';
import { FTCreator3TrackingHooks } from './auto.js';
import { FTCreator3CanvasCapture } from './capture.js';
import { FTCreator3Transport } from './transport.js';

const transport = new FTCreator3Transport();
const capture = new FTCreator3CanvasCapture();
const hooks = new FTCreator3TrackingHooks();
const autoTracking = new FTDefaultAutoTracking(
  new FTRUM(transport),
  new FTLogger(transport),
  new FTTrace(transport),
  hooks,
);

/** Shared SDK entry point for Cocos Creator 3.x applications. */
export const truewatchSdk = new FTCocosSDK(transport, capture, autoTracking, hooks);

/**
 * Selects the Cocos Creator 3 camera used to capture Session Replay frames.
 * Call this after the camera is available and before starting Replay.
 *
 * @param camera - Active Cocos `Camera` component.
 */
export function setReplayCamera(camera: unknown): void {
  capture.setCamera(camera);
}

export * from '../core/index.js';
