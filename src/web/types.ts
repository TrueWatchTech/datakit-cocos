import type { FTAttributes, FTAutoTrackingConfig, FTCocosConfig, FTCocosHybridConfig } from '../core/types.js';

/** Public Browser SDK surface consumed by the adapter. Bundles are loaded outside Creator's module graph. */
export interface FTBrowserRum {
  init(config: Record<string, unknown>): void;
  getInitConfiguration(): Record<string, unknown> | undefined;
  startView(options: { name: string; context?: FTAttributes }): void;
  addTypeAction(name: string, type: string, context?: FTAttributes): void;
  addError(error: Error, context?: FTAttributes): void;
  setUser(user: Record<string, unknown>): void;
  clearUser(): void;
  setGlobalContextProperty(key: string, value: unknown): void;
  startSessionReplayRecording(): void;
  stopSessionReplayRecording(): void;
  isRecording(): boolean;
}
export interface FTBrowserLogs {
  init(config: Record<string, unknown>): void;
  getInitConfiguration(): Record<string, unknown> | undefined;
  setUser(user: Record<string, unknown>): void;
  clearUser(): void;
  setGlobalContextProperty(key: string, value: unknown): void;
  logger: { log(message: string, context?: FTAttributes, status?: string): void };
}
export interface FTBrowserGlobals {
  TRUEWATCH_RUM?: FTBrowserRum;
  TRUEWATCH_LOGS?: FTBrowserLogs;
  TRUEWATCH_RUM_WEBGL?: { webglReplayPlugin(): unknown };
  DATAFLUX_RUM?: FTBrowserRum;
  DATAFLUX_LOGS?: FTBrowserLogs;
  DATAFLUX_RUM_WEBGL?: { webglReplayPlugin(): unknown };
}
export interface FTWebReplayConfig {
  /** Explicit opt-in. Requires the full Browser RUM and WebGL bundles before engine boot. */
  enabled: true;
  sessionReplaySamplingRate?: number;
  sessionReplayOnErrorSamplingRate?: number;
  /** Whole-canvas capture is blocked by default. Node masks cannot be rendered by Browser Replay. */
  canvasPrivacy?: 'block' | 'allow';
  /** Only this canvas may be captured. @defaultValue 'GameCanvas' */
  canvasId?: string;
  /** Integer frames per second, from 1 to 5. @defaultValue 1 */
  captureFps?: number;
  /** Maximum frame edge, from 1 to 2048. @defaultValue 720 */
  maxImageDimension?: number;
  /** Browser encoder quality or preset. Presets do not change explicit captureFps. */
  quality?: number | 'low' | 'medium' | 'high';
  /** Maximum encoded image bytes, from 1024 to 1048576. Oversized frames may be reduced or dropped. */
  maxFrameBytes?: number;
}
export interface FTWebConfig {
  /** Separate Web RUM application ID. Never inferred from Android/iOS IDs. */
  applicationId?: string;
  /** Explicit Browser reporting origin. Native endpoint settings are not reused. */
  datakitOrigin?: string;
  /** Public Browser reporting site, used together with clientToken. */
  site?: string;
  clientToken?: string;
  /** View started by stopView/leaveCocos/detach. @defaultValue 'CocosInactive' */
  outsideViewName?: string;
  allowedTracingUrls?: string[];
  trackLongTasks?: boolean;
  replay?: FTWebReplayConfig;
}
export interface FTCocosWebConfig extends Omit<FTCocosConfig, 'sdk'> {
  sdk?: FTCocosConfig['sdk'];
  web: FTWebConfig;
}
export interface FTCocosWebAttachConfig extends FTCocosHybridConfig {
  /** Optional assertion when attaching to a page bootstrapped by this adapter. */
  applicationId?: string;
}
export interface FTWebPageRuntime {
  readonly protocol: 1;
  readonly config: FTCocosWebConfig;
  invoke<T>(method: string, payload?: unknown): T | undefined;
  claim(owner: object): void;
  release(owner: object): void;
  setPrivacyCheck(owner: object, check: (() => boolean) | undefined): void;
  startReplay(): void;
  stopReplay(): void;
  isRecording(): boolean;
}
export interface FTWebWindow extends FTBrowserGlobals {
  __FT_COCOS_WEB__?: FTWebPageRuntime;
}
export type FTWebTrackingConfig = FTAutoTrackingConfig;
