import type { FTCocosSDK as SDK } from './client.js';
export type { FTSDKLifecycle, FTSDKExtension } from './client.js';
export type { FTNativeTransport } from './transport.js';
export type { FTAttributes, FTCocosConfig, FTCocosHybridConfig, FTCocosEnterOptions, FTValue } from './types.js';

type Public<T> = { [K in keyof T]: T[K] };

/** Structural contract shared by the CommonJS and ES module engine builds. */
export type FTCocosSDK = Omit<Public<SDK>, 'mobile' | 'rum' | 'logger' | 'trace'> & {
  mobile: Public<SDK['mobile']>;
  rum: Public<SDK['rum']>;
  logger: Public<SDK['logger']>;
  trace: Public<SDK['trace']>;
};
