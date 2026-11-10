import type { FTCocosConfig } from './types.js';
import type { FTCocosWebConfig, FTWebReplayConfig } from '../web/types.js';

/** Native Replay options; Web encoding and privacy settings use FTWebReplayConfig. */
export interface FTNativeReplayConfig {
  sessionReplaySamplingRate?: number;
  sessionReplayOnErrorSamplingRate?: number;
  captureFps?: number;
  maxImageDimension?: number;
  imagePolicy?: { quality?: 'low' | 'medium' | 'high'; maxFrameBytes?: number };
  touchPrivacy?: 'show' | 'hide';
}

/** SDK-owned sections of cocos-sdk.config.json; build-tool sections may coexist. */
export interface FTCocosProjectConfiguration {
  configuration?: FTCocosConfig;
  replay?: {
    enabled?: boolean;
    sessionReplaySamplingRate?: number;
    sessionReplayOnErrorSamplingRate?: number;
    native?: Omit<FTNativeReplayConfig, 'sessionReplaySamplingRate' | 'sessionReplayOnErrorSamplingRate'> | false;
    web?: Omit<FTWebReplayConfig, 'enabled' | 'sessionReplaySamplingRate' | 'sessionReplayOnErrorSamplingRate'> | false;
  };
  web?: { enabled?: boolean; configuration?: Partial<FTCocosWebConfig> };
}
