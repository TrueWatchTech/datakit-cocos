import { FTLogger, FTMobileAgent, FTRUM, FTSDKOwnership, FTTrace } from './modules.js';
import {
  FTSessionReplay,
  type FTCanvasCapture,
  type FTReplayPointerSource,
} from './replay.js';
import type { FTNativeTransport } from './transport.js';
import type {
  FTAutoTrackingConfig,
  FTCocosConfig,
  FTCocosEnterOptions,
  FTCocosHybridConfig,
} from './types.js';
import { FT_COCOS_SDK_VERSION } from './version.js';

export interface FTAutoTrackingController {
  start(config: FTAutoTrackingConfig, viewName?: string): void;
  stop(): void;
}

type FTCocosSDKState = 'idle' | 'standalone' | 'hybrid-attached' | 'hybrid-entered';

/**
 * Cocos SDK facade exposed through the platform entry point's SDK
 * singleton. Do not construct this class directly.
 */
export class FTCocosSDK {
  /** Base SDK lifecycle and user-binding operations. */
  readonly mobile: FTMobileAgent;
  /** Real User Monitoring operations. */
  readonly rum: FTRUM;
  /** Logging operations. */
  readonly logger: FTLogger;
  /** Distributed-tracing operations. */
  readonly trace: FTTrace;
  /** Session Replay operations. */
  readonly replay: FTSessionReplay;

  private state: FTCocosSDKState = 'idle';
  private hybridAutoTracking: FTAutoTrackingConfig = {};
  private readonly ownership = new FTSDKOwnership();

  constructor(
    private readonly transport: FTNativeTransport,
    capture: FTCanvasCapture,
    private readonly autoTracking?: FTAutoTrackingController,
    pointerSource?: FTReplayPointerSource,
  ) {
    this.mobile = new FTMobileAgent(transport, this.ownership);
    this.rum = new FTRUM(transport, this.ownership);
    this.logger = new FTLogger(transport, this.ownership);
    this.trace = new FTTrace(transport, this.ownership);
    this.replay = new FTSessionReplay(transport, capture, pointerSource);
  }

  /**
   * Initializes the native SDK and the configured modules for a standalone
   * Cocos application.
   *
   * Call this once during application startup. Do not combine it with
   * {@link attach}, which is reserved for Hybrid applications initialized by
   * a native host.
   *
   * @param config - Base SDK settings and optional module configurations.
   * @throws If the SDK is already started or attached.
   */
  start(config: FTCocosConfig): void {
    if (this.state !== 'idle') {
      throw new Error('start() and attach() are mutually exclusive');
    }
    this.mobile.start(config.sdk);
    // Base SDK installation already belongs to this Cocos runtime after the
    // first bridge call succeeds, even if a later optional module fails.
    this.state = 'standalone';
    if (config.rum) this.rum.start(config.rum);
    if (config.logger) this.logger.start(config.logger);
    if (config.trace) this.trace.start(config.trace);
    if (config.replay) this.replay.start(config.replay);
    if (config.autoTrack) this.autoTracking?.start(config.autoTrack);
  }

  /**
   * Attaches Cocos instrumentation to an SDK instance initialized by the
   * native host application.
   *
   * Call this once before the first {@link enterCocos}. This method does not
   * initialize or shut down the native SDK.
   *
   * @param config - Cocos tracking and replay settings owned by the native host.
   * @throws If standalone initialization has already started.
   */
  attach(config: FTCocosHybridConfig = {}): void {
    if (this.state === 'standalone') {
      throw new Error('start() and attach() are mutually exclusive');
    }
    if (this.state === 'hybrid-attached' || this.state === 'hybrid-entered') return;

    this.ownership.claimNativeHost();
    try {
      this.replay.attachHybrid(config.replay);
      this.transport.invoke('hybrid.attach', {
        requiresReplay: config.replay !== undefined,
        sdkVersion: FT_COCOS_SDK_VERSION,
      });
    } catch (error) {
      this.replay.detachHybrid();
      this.ownership.releaseNativeHost();
      throw error;
    }
    this.hybridAutoTracking = { ...(config.autoTrack || {}) };
    this.state = 'hybrid-attached';
  }

  /**
   * Starts Cocos automatic tracking and canvas replay capture in Hybrid mode.
   *
   * @param options - Options for the Cocos view being entered.
   * @throws If {@link attach} has not been called, or if `viewName` is omitted
   * while automatic scene tracking is disabled.
   */
  enterCocos(options: FTCocosEnterOptions = {}): void {
    if (this.state === 'standalone') {
      throw new Error('enterCocos() is only available after attach()');
    }
    if (this.state === 'idle') {
      throw new Error('Call attach() before enterCocos()');
    }
    if (this.state === 'hybrid-entered') return;

    const viewName = nonEmptyText(options.viewName);
    if (!this.hybridAutoTracking.scenes && !viewName) {
      throw new TypeError('enterCocos.viewName is required when scene tracking is disabled');
    }

    try {
      this.replay.enterHybrid();
      this.autoTracking?.start(this.hybridAutoTracking, viewName);
      this.state = 'hybrid-entered';
    } catch (error) {
      this.autoTracking?.stop();
      try {
        this.replay.leaveHybrid();
      } catch {
        // Preserve the error that prevented entering Cocos.
      }
      throw error;
    }
  }

  /**
   * Stops Cocos automatic tracking and canvas replay capture in Hybrid mode.
   * The native host SDK remains running.
   */
  leaveCocos(): void {
    if (this.state === 'standalone') {
      throw new Error('leaveCocos() is only available after attach()');
    }
    if (this.state === 'idle' || this.state === 'hybrid-attached') return;

    this.autoTracking?.stop();
    this.replay.leaveHybrid();
    this.state = 'hybrid-attached';
  }

  /**
   * Stops a standalone SDK instance and releases its Cocos instrumentation.
   *
   * Hybrid applications should call {@link leaveCocos} instead because the
   * native host owns SDK shutdown.
   */
  shutdown(): void {
    if (this.state === 'hybrid-attached' || this.state === 'hybrid-entered') {
      throw new Error('The native host owns the native SDK; call leaveCocos() instead of shutdown()');
    }
    if (this.state === 'idle') return;
    this.autoTracking?.stop();
    this.replay.stop();
    this.mobile.shutdown();
    this.state = 'idle';
  }
}

function nonEmptyText(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
