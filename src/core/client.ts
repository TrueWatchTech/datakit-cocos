import { FTLogger, FTMobileAgent, FTRUM, FTSDKOwnership, FTTrace } from './modules.js';
import type { FTNativeTransport } from './transport.js';
import type {
  FTAutoTrackingConfig,
  FTCocosConfig,
  FTCocosEnterOptions,
  FTCocosHybridConfig,
} from './types.js';
import { FT_COCOS_SDK_VERSION } from './version.js';

export type FTAutoTrackingScope = 'all' | 'page' | 'network';

export interface FTAutoTrackingController {
  start(config: FTAutoTrackingConfig, viewName?: string, scope?: FTAutoTrackingScope): void;
  stop(scope?: FTAutoTrackingScope): void;
}

export interface FTSDKLifecycle {
  /**
   * Validates or prepares the extension before standalone native SDK initialization.
   * Throwing aborts startup before the base SDK is initialized.
   */
  beforeStart?(): void;
  /**
   * Starts the extension after the base SDK and configured modules initialize,
   * but before Cocos automatic tracking starts. If this hook throws, the native
   * SDK remains initialized; startup is not automatically rolled back.
   */
  afterStart?(): void;
  /**
   * Prepares the extension before the native Hybrid attachment call.
   * The native host already owns SDK initialization at this point.
   */
  beforeAttach?(): void;
  /**
   * Undoes extension preparation if beforeAttach or the native attachment call
   * fails. Must tolerate partial preparation; errors from this hook are ignored
   * so the original attachment error can be rethrown.
   */
  rollbackAttach?(): void;
  /**
   * Starts extension activity when entering Cocos in Hybrid mode, before Cocos
   * automatic tracking starts. A failure triggers the leave hook for cleanup.
   */
  enter?(): void;
  /**
   * Stops extension activity when leaving Cocos in Hybrid mode, after automatic
   * tracking cleanup is attempted. Also runs if entering Cocos fails, so it must
   * tolerate partial startup. The native host SDK must remain running.
   */
  leave?(): void;
  /** Releases Hybrid extension bindings without shutting down the native host SDK. */
  detach?(): void;
  /**
   * Releases standalone extension resources after automatic tracking cleanup is
   * attempted and before the base native SDK shuts down. Base SDK shutdown is
   * still attempted if this hook throws. Not called for Hybrid applications.
   */
  shutdown?(): void;
}

export interface FTSDKExtension<T> {
  value: T;
  lifecycle: FTSDKLifecycle;
}

type FTCocosSDKState = 'idle' | 'standalone' | 'hybrid-attached' | 'hybrid-entered' | 'hybrid-detached';

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
  readonly extensionProtocol = 1;
  private extension: FTSDKExtension<unknown> | undefined;
  private extensionId: string | undefined;

  private state: FTCocosSDKState = 'idle';
  private hybridAutoTracking: FTAutoTrackingConfig = {};
  private readonly ownership = new FTSDKOwnership();

  constructor(
    private readonly transport: FTNativeTransport,
    private readonly autoTracking?: FTAutoTrackingController,
    readonly engine: 'creator2' | 'creator3' = 'creator3',
  ) {
    this.mobile = new FTMobileAgent(transport, this.ownership);
    this.rum = new FTRUM(transport, this.ownership);
    this.logger = new FTLogger(transport, this.ownership);
    this.trace = new FTTrace(transport, this.ownership);
  }

  /** @internal Ownership state used by the platform facade. */
  get lifecycleMode(): 'idle' | 'standalone' | 'hybrid' {
    return this.state === 'standalone' ? 'standalone' : this.state === 'hybrid-attached' || this.state === 'hybrid-entered' ? 'hybrid' : 'idle';
  }
  get isCocosEntered(): boolean { return this.state === 'standalone' || this.state === 'hybrid-entered'; }

  /** Attaches an optional package before SDK initialization. */
  registerExtension<T>(id: string, version: string, engine: string, factory: () => FTSDKExtension<T>): T {
    if (version !== FT_COCOS_SDK_VERSION || engine !== this.engine) {
      throw new Error('SDK extension version or Creator engine does not match the base SDK');
    }
    if (this.extension) {
      if (id !== this.extensionId) throw new Error('A different SDK extension is already installed');
      return this.extension.value as T;
    }
    if (this.state !== 'idle') throw new Error('Install SDK extensions before start() or attach()');
    const extension = factory();
    this.extension = extension;
    this.extensionId = id;
    return extension.value;
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
    rejectReplayConfig(config);
    if (this.state !== 'idle') {
      throw new Error('start() and attach() are mutually exclusive');
    }
    this.extension?.lifecycle.beforeStart?.();
    this.mobile.start(config.sdk);
    // Base SDK installation already belongs to this Cocos runtime after the
    // first bridge call succeeds, even if a later optional module fails.
    this.state = 'standalone';
    if (config.rum) this.rum.start(config.rum);
    if (config.logger) this.logger.start(config.logger);
    if (config.trace) this.trace.start(config.trace);
    this.extension?.lifecycle.afterStart?.();
    if (config.autoTrack) this.autoTracking?.start(config.autoTrack);
  }

  /**
   * Attaches Cocos instrumentation to an SDK instance initialized by the
   * native host application.
   *
   * Call this once before the first {@link enterCocos}. This method does not
   * initialize or shut down the native SDK. Network tracking starts here and
   * remains active across page transitions until {@link detach}. Repeated calls
   * while attached do not update configuration.
   *
   * @param config - Cocos tracking settings for the SDK owned by the native host.
   * @throws If standalone initialization has already started.
   */
  attach(config: FTCocosHybridConfig = {}): void {
    rejectReplayConfig(config);
    if (this.state === 'standalone') {
      throw new Error('start() and attach() are mutually exclusive');
    }
    if (this.state === 'hybrid-attached' || this.state === 'hybrid-entered') return;

    this.ownership.claimNativeHost();
    try {
      this.extension?.lifecycle.beforeAttach?.();
      this.transport.invoke('hybrid.attach');
      if (config.autoTrack?.network) {
        this.autoTracking?.start({ network: true }, undefined, 'network');
      }
    } catch (error) {
      try { this.autoTracking?.stop('network'); } catch { /* Preserve attachment error. */ }
      try { this.extension?.lifecycle.rollbackAttach?.(); } catch { /* Preserve attachment error. */ }
      if (this.state === 'hybrid-detached') {
        try { this.extension?.lifecycle.detach?.(); } catch { /* Preserve attachment error. */ }
      } else {
        this.ownership.releaseNativeHost();
      }
      throw error;
    }
    this.hybridAutoTracking = { ...(config.autoTrack || {}) };
    this.state = 'hybrid-attached';
  }

  /**
   * Starts page automatic tracking and registered extensions in Hybrid mode.
   * Network tracking remains active independently of page visibility.
   *
   * @param options - Options for the Cocos view being entered.
   * @throws If {@link attach} has not been called, or if `viewName` is omitted
   * while automatic scene tracking is disabled.
   */
  enterCocos(options: FTCocosEnterOptions = {}): void {
    if (this.state === 'standalone') {
      throw new Error('enterCocos() is only available after attach()');
    }
    if (this.state === 'idle' || this.state === 'hybrid-detached') {
      throw new Error('Call attach() before enterCocos()');
    }
    if (this.state === 'hybrid-entered') return;

    const viewName = nonEmptyText(options.viewName);
    if (!this.hybridAutoTracking.scenes && !viewName) {
      throw new TypeError('enterCocos.viewName is required when scene tracking is disabled');
    }

    try {
      this.extension?.lifecycle.enter?.();
      this.autoTracking?.start(this.hybridAutoTracking, viewName, 'page');
      this.state = 'hybrid-entered';
    } catch (error) {
      try { this.autoTracking?.stop('page'); } catch { /* Preserve the entry error. */ }
      try {
        this.extension?.lifecycle.leave?.();
      } catch {
        // Preserve the error that prevented entering Cocos.
      }
      throw error;
    }
  }

  /**
   * Stops page automatic tracking and registered extensions in Hybrid mode.
   * Network tracking and the native host SDK remain running.
   */
  leaveCocos(): void {
    if (this.state === 'standalone') {
      throw new Error('leaveCocos() is only available after attach()');
    }
    if (this.state !== 'hybrid-entered') return;

    try {
      this.autoTracking?.stop('page');
    } finally {
      this.extension?.lifecycle.leave?.();
      this.state = 'hybrid-attached';
    }
  }

  /**
   * Removes Hybrid page and network instrumentation without shutting down the
   * native SDK. Requests already tracked may still finish reporting. Call attach()
   * again to resume with new configuration; native SDK ownership stays with the host.
   */
  detach(): void {
    if (this.state === 'standalone') throw new Error('detach() is only available after attach()');
    if (this.state === 'idle' || this.state === 'hybrid-detached') return;
    let failure: unknown;
    const cleanup = (operation: () => void): void => {
      try { operation(); } catch (error) { if (failure === undefined) failure = error; }
    };
    cleanup(() => this.leaveCocos());
    cleanup(() => this.autoTracking?.stop());
    // Keep the binding retryable if leaving failed (for example recorder restoration).
    if (failure !== undefined) throw failure;
    this.extension?.lifecycle.detach?.();
    this.hybridAutoTracking = {};
    this.state = 'hybrid-detached';
  }

  /**
   * Stops a standalone SDK instance and releases its Cocos instrumentation.
   *
   * Hybrid applications should call {@link leaveCocos} instead because the
   * native host owns SDK shutdown.
   */
  shutdown(): void {
    if (this.state === 'hybrid-attached' || this.state === 'hybrid-entered' || this.state === 'hybrid-detached') {
      throw new Error('The native host owns the native SDK; call leaveCocos() instead of shutdown()');
    }
    if (this.state === 'idle') return;
    let failure: unknown;
    const cleanup = (operation: () => void): void => {
      try { operation(); } catch (error) { if (failure === undefined) failure = error; }
    };
    cleanup(() => this.autoTracking?.stop());
    cleanup(() => this.extension?.lifecycle.shutdown?.());
    cleanup(() => { this.mobile.shutdown(); this.state = 'idle'; });
    if (failure !== undefined) throw failure;
  }
}

function nonEmptyText(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function rejectReplayConfig(config: object): void {
  if ('replay' in config) {
    throw new Error('Session Replay requires @truewatchtech/cocos-session-replay. Install the package and use withSessionReplay() before passing replay configuration.');
  }
}
