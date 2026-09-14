import { FTDefaultAutoTracking } from '../core/auto-tracking.js';
import { FTCocosSDK } from '../core/client.js';
import { FTLogger, FTRUM, FTTrace } from '../core/modules.js';
import { FTCreator2TrackingHooks } from './auto.js';
import { FTCreator2Transport } from './transport.js';

const transport = new FTCreator2Transport();
const hooks = new FTCreator2TrackingHooks();
const autoTracking = new FTDefaultAutoTracking(
  new FTRUM(transport),
  new FTLogger(transport),
  new FTTrace(transport),
  hooks,
);

/** Shared SDK entry point for Cocos Creator 2.4 applications. */
export const truewatchSdk = new FTCocosSDK(transport, autoTracking, 'creator2');

export * from '../core/index.js';
