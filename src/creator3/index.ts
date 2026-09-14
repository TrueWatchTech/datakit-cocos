import { FTDefaultAutoTracking } from '../core/auto-tracking.js';
import { FTCocosSDK } from '../core/client.js';
import { FTLogger, FTRUM, FTTrace } from '../core/modules.js';
import { FTCreator3TrackingHooks } from './auto.js';
import { FTCreator3Transport } from './transport.js';

const transport = new FTCreator3Transport();
const hooks = new FTCreator3TrackingHooks();
const autoTracking = new FTDefaultAutoTracking(
  new FTRUM(transport),
  new FTLogger(transport),
  new FTTrace(transport),
  hooks,
);

/** Shared SDK entry point for Cocos Creator 3.x applications. */
export const truewatchSdk = new FTCocosSDK(transport, autoTracking, 'creator3');

export * from '../core/index.js';
