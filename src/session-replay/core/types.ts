import type { FTAttributes, FTCocosConfig, FTCocosHybridConfig } from '@truewatchtech/cocos-sdk/plugin-api';

/** Visual treatment applied to a Session Replay node. */
export type FTReplayPrivacyMode = 'mask' | 'hide' | 'unmask';

/** Whether Session Replay records touch positions. */
export type FTReplayTouchPrivacy = 'show' | 'hide';

/** Image quality preset used by Cocos Session Replay. */
export type FTReplayQuality = 'low' | 'medium' | 'high';

/** Per-image encoding controls for Cocos Session Replay. */
export interface FTReplayImagePolicy {
  /** Compression, dimension, and per-image size preset. @defaultValue `'medium'` */
  quality?: FTReplayQuality;
  /** Maximum encoded bytes for every image, including the first frame of a view. Accepts 1024 to 1048576. Requires the native V2 image encoder. */
  maxFrameBytes?: number;
}

/** Session Replay configuration for standalone Cocos applications. */
export interface FTSessionReplayConfig {
  /** Replay sampling rate from `0` to `1`. */
  sampleRate?: number;
  /** Additional replay sampling rate from `0` to `1` for sessions that contain errors. */
  sessionOnErrorSampleRate?: number;
  /** Canvas capture rate in frames per second. Accepts integers from `1` to `5`. @defaultValue `1` */
  captureFps?: number;
  /** Maximum width or height of a captured frame. Accepts `1` to `2048`. @defaultValue `720` */
  maxImageDimension?: number;
  /** Enables per-image compression and size limits. Requires the native V2 image encoder; no rolling traffic limit is applied. */
  imagePolicy?: FTReplayImagePolicy;
  /** Whether captured replays include touch positions. @defaultValue `'hide'` */
  touchPrivacy?: FTReplayTouchPrivacy;
}

/** Cocos-side Session Replay settings when the native host owns SDK initialization. */
export interface FTHybridSessionReplayConfig {
  /** Canvas capture rate in frames per second. Accepts integers from `1` to `5`. @defaultValue `1` */
  captureFps?: number;
  /** Maximum width or height of a captured frame. Accepts `1` to `2048`. @defaultValue `720` */
  maxImageDimension?: number;
  /** Enables per-image compression and size limits. Requires the native V2 image encoder; no rolling traffic limit is applied. */
  imagePolicy?: FTReplayImagePolicy;
  /** Whether captured replays include touch positions. @defaultValue `'hide'` */
  touchPrivacy?: FTReplayTouchPrivacy;
}

/** Internal native RUM context used by Session Replay encoding. */
export interface FTRUMContext {
  applicationId: string;
  sessionId: string;
  viewId: string;
  globalContext?: FTAttributes;
}

/** Internal privacy rectangle projected into a captured frame. */
export interface FTPrivacyRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  mode: Exclude<FTReplayPrivacyMode, 'unmask'>;
}

/** Internal in-memory representation of a captured Cocos frame. */
export interface FTCapturedFrame {
  rgba: Uint8Array;
  width: number;
  height: number;
  timestamp: number;
  privacyRegions?: FTPrivacyRegion[];
}

/** Internal persisted representation of a captured Cocos frame. */
export interface FTStoredFrame {
  path: string;
  width: number;
  height: number;
  timestamp: number;
  fingerprint: string;
}

export interface FTCocosReplayConfig extends FTCocosConfig { replay?: FTSessionReplayConfig; }
export interface FTCocosHybridReplayConfig extends FTCocosHybridConfig { replay?: FTHybridSessionReplayConfig; }
