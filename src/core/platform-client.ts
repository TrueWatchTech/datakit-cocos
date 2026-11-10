import type { FTCocosSDK, FTSDKExtension } from './client.js';
import type { FTCocosConfig, FTCocosEnterOptions } from './types.js';
import type { FTCocosWebAttachConfig, FTCocosWebConfig } from '../web/types.js';
import type { FTCocosWebSDK } from '../web/client.js';
import type { FTNativeReplayConfig } from './platform-options.js';
import { FT_COCOS_SDK_VERSION } from './version.js';
import { existingPlatformImplementation, platformGlobal, platformImplementation, type FTNativeReplayFacade, type FTPlatformContext, type FTPlatformGlobal } from './platform-runtime.js';

export type FTCocosPlatformConfig = (FTCocosConfig & { replay?: FTNativeReplayConfig }) | FTCocosWebConfig;

/** Stable engine entry. Build assets select implementations and install project configuration. */
export class FTCocosPlatformSDK {
  readonly extensionProtocol = 1;
  private get mode() { return existingPlatformImplementation(this.context(), this.target)?.lifecycleMode || 'idle'; }
  private record() {
    this.implementation();
    return (this.target || platformGlobal()).__FT_COCOS_INSTANCES__![this.engine + ':' + this.platform]!;
  }
  private get nativeReplay() { return this.record().replay; }
  private set nativeReplay(value: FTNativeReplayFacade | undefined) { this.record().replay = value; }
  private get replayConfig() { return this.record().replayConfig; }
  private set replayConfig(value: FTNativeReplayConfig | undefined) { this.record().replayConfig = value; }
  readonly replay = {
    /** Starts recording using the settings selected at initialization. */
    start: (): void => {
      if (this.mode === 'idle') throw new Error('Start or attach the Cocos SDK before starting Replay');
      if (!this.implementation().isCocosEntered) throw new Error('Call enterCocos() before starting Hybrid Replay');
      if (this.platform === 'web') { (this.implementation() as FTCocosWebSDK).replay.start(); return; }
      if (!this.nativeReplay || !this.replayConfig) throw new Error('Enable Replay in cocos-sdk.config.json before starting the SDK');
      if (this.mode === 'hybrid') this.nativeReplay.replay.enterHybrid();
      else this.nativeReplay.replay.start(this.replayConfig);
    },
    /** Stops recording while leaving base tracking active. */
    stop: (): void => {
      if (this.mode === 'idle') return;
      if (this.platform === 'web') { (this.implementation() as FTCocosWebSDK).replay.stop(); return; }
      if (this.mode === 'hybrid') this.nativeReplay?.replay.leaveHybrid();
      else this.nativeReplay?.replay.stop();
    },
  };
  constructor(
    readonly engine: 'creator2' | 'creator3',
    private readonly context: () => FTPlatformContext,
    private readonly target?: FTPlatformGlobal,
  ) {}
  get platform(): FTPlatformContext['platform'] { return this.context().platform; }
  get mobile(): FTCocosSDK['mobile'] { return this.implementation().mobile; }
  get rum(): FTCocosSDK['rum'] { return this.implementation().rum; }
  get logger(): FTCocosSDK['logger'] { return this.implementation().logger; }
  get trace(): FTCocosSDK['trace'] { return this.implementation().trace; }

  /** Uses installed project settings when no explicit configuration is supplied. */
  start(config?: FTCocosPlatformConfig): void {
    if (this.mode !== 'idle') throw new Error('Cocos SDK already started or attached');
    if (this.platform === 'web') {
      (this.implementation() as FTCocosWebSDK).start(config);
      return;
    }
    const settings = config || (this.target || platformGlobal()).__FT_COCOS_CONFIGURATION__;
    if (!settings?.sdk) throw new Error('Native start() requires sdk configuration; configure configuration.sdk in cocos-sdk.config.json');
    const replay = 'replay' in settings ? settings.replay : undefined;
    const sdk = this.implementation() as FTCocosSDK;
    const facade = replay ? this.composeReplay(sdk) : undefined;
    this.replayConfig = replay;
    // Native initialization may partially succeed. Keep stop() available for cleanup.
    try {
      if (facade) facade.start(settings as FTCocosConfig & { replay?: FTNativeReplayConfig });
      else sdk.start(settings as FTCocosConfig);
    } catch (error) {
      try { sdk.shutdown(); } catch { /* Preserve startup error; stop() can retry cleanup. */ }
      throw error;
    }
  }
  attach(config?: FTCocosWebAttachConfig): void {
    if (this.mode === 'standalone') throw new Error('start() and attach() are mutually exclusive');
    if (this.mode === 'hybrid') return;
    // Explicit attach settings preserve legacy withSessionReplay() ownership of its configuration.
    const settings = config === undefined ? (this.target || platformGlobal()).__FT_COCOS_CONFIGURATION__ : undefined;
    if (this.platform !== 'web' && settings?.replay) {
      const { sessionReplaySamplingRate: _rate, sessionReplayOnErrorSamplingRate: _errorRate, ...capture } = settings.replay;
      this.composeReplay(this.implementation() as FTCocosSDK).attach({ autoTrack: settings.autoTrack, ...config, replay: capture });
      this.replayConfig = settings.replay;
    } else this.implementation().attach(config || (this.platform !== 'web' && settings ? { autoTrack: settings.autoTrack } : undefined));
  }
  enterCocos(options?: FTCocosEnterOptions): void { this.implementation().enterCocos(options); }
  leaveCocos(): void { existingPlatformImplementation(this.context(), this.target)?.leaveCocos(); }
  detach(): void { existingPlatformImplementation(this.context(), this.target)?.detach(); }
  shutdown(): void { existingPlatformImplementation(this.context(), this.target)?.shutdown(); }
  /** Stops this Cocos instance. Web page collectors and native host-owned SDKs retain their lifecycle. */
  stop(): void {
    if (this.mode === 'idle') return;
    if (this.platform === 'web' || this.mode === 'hybrid') this.detach();
    else this.shutdown();
    this.replayConfig = undefined;
  }
  registerExtension<T>(id: string, version: string, engine: string, factory: () => FTSDKExtension<T>): T {
    if (engine !== this.engine) throw new Error('SDK extension Creator engine does not match the base SDK');
    if (this.platform === 'web') throw new Error('Native SDK extensions are unavailable on Web; configure Web Replay at page bootstrap.');
    return (this.implementation() as FTCocosSDK).registerExtension(id, version, engine, factory);
  }
  private composeReplay(sdk: FTCocosSDK): FTNativeReplayFacade {
    if (this.nativeReplay) return this.nativeReplay;
    const factory = (this.target || platformGlobal()).__FT_COCOS_REPLAY_FACTORY__;
    if (!factory || factory.protocol !== 1 || factory.version !== FT_COCOS_SDK_VERSION || factory.engine !== this.engine) {
      throw new Error('Native Replay runtime is missing or incompatible. Install the matching Replay package and rerun the installer with --replay');
    }
    return this.nativeReplay = factory.create(sdk, this.context());
  }
  private implementation() { return platformImplementation(this.context(), this.target); }
}
