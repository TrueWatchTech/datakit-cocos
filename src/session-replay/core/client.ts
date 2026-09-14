import type { FTCocosSDK, FTNativeTransport, FTCocosEnterOptions } from '@truewatchtech/cocos-sdk/plugin-api';
import { FTSessionReplay, type FTCanvasCapture, type FTReplayPointerSource } from './replay.js';
import type { FTCocosReplayConfig, FTCocosHybridReplayConfig, FTSessionReplayConfig, FTHybridSessionReplayConfig } from './types.js';
import { FT_COCOS_REPLAY_VERSION } from './version.js';
import { replayImagePolicy, captureFps, samplingRate } from './validation.js';

export interface FTReplayCapture extends FTCanvasCapture { setCamera(camera: unknown): void; }

/** Typed Replay facade; the supplied base SDK continues to own lifecycle state. */
export class FTCocosReplaySDK {
  readonly mobile: FTCocosSDK['mobile'];
  readonly rum: FTCocosSDK['rum'];
  readonly logger: FTCocosSDK['logger'];
  readonly trace: FTCocosSDK['trace'];

  constructor(
    private readonly base: FTCocosSDK,
    readonly replay: FTSessionReplay,
    private readonly capture: FTReplayCapture,
    private readonly configure: (config: FTSessionReplayConfig | undefined) => void,
  ) {
    this.mobile = base.mobile;
    this.rum = base.rum;
    this.logger = base.logger;
    this.trace = base.trace;
  }

  /**
   * Initializes the base SDK and configured modules for a standalone Cocos app.
   * Supplying `config.replay` also enables native Session Replay and starts
   * canvas capture. Omitting it does not start Replay.
   *
   * Call once during application startup, after composing with withSessionReplay.
   * Do not combine with {@link attach}, which requires a native host-owned SDK.
   *
   * @param config - Base SDK settings, optional modules, and Replay settings.
   * @throws If the SDK is already started or attached, Replay settings are
   * invalid, or the required native Replay integration is unavailable.
   */
  start(config: FTCocosReplayConfig): void {
    const { replay, ...base } = config;
    this.configure(replay);
    try { this.base.start(base); } finally { this.configure(undefined); }
  }

  /**
   * Attaches Cocos tracking to an SDK initialized by the native Hybrid host.
   * Supplying `config.replay` prepares canvas capture for {@link enterCocos};
   * capture does not start until that method is called. The native host owns
   * native SDK and Replay initialization, including sampling settings.
   *
   * Call before the first {@link enterCocos}. Repeated calls after attachment
   * have no effect and do not update the configuration.
   *
   * @param config - Optional Cocos automatic tracking and Hybrid Replay settings.
   * @throws If standalone initialization has already started, Replay settings
   * are invalid, or the required native Replay integration is unavailable.
   */
  attach(config: FTCocosHybridReplayConfig = {}): void {
    const { replay, ...base } = config;
    this.configure(replay);
    try { this.base.attach(base); } finally { this.configure(undefined); }
  }

  /**
   * Selects the Cocos camera used for subsequent Session Replay captures.
   * Update it when changing scenes if the selected camera belongs to the old
   * scene. Selecting a camera does not start Replay capture.
   *
   * @param camera - A Camera component from the matching Creator engine in the
   * active scene, or null/undefined to restore automatic camera selection.
   */
  setReplayCamera(camera: unknown): void { this.capture.setCamera(camera); }

  /**
   * Starts Cocos automatic tracking and any Replay capture enabled by
   * {@link attach} in Hybrid mode. Repeated calls while entered have no effect.
   *
   * @param options - Options for the Cocos view being entered. Supply `viewName`
   * when automatic scene tracking is disabled.
   * @throws If the SDK is not attached in Hybrid mode, the required view name
   * is missing, or tracking or Replay startup fails.
   */
  enterCocos(options?: FTCocosEnterOptions): void { this.base.enterCocos(options); }

  /**
   * Stops Cocos automatic tracking and Hybrid Replay capture while keeping the
   * native host SDK running. Call {@link enterCocos} to resume Cocos tracking.
   * Has no effect before attachment or when Cocos has already been left.
   *
   * @throws If the SDK was started in standalone mode, or tracking or Replay
   * cleanup fails.
   */
  leaveCocos(): void { this.base.leaveCocos(); }

  /**
   * Stops standalone Cocos tracking, Session Replay, and the base native SDK.
   * Has no effect if the base SDK is idle. Hybrid applications must use
   * {@link leaveCocos} because the native host owns SDK shutdown.
   *
   * @throws If the SDK is attached in Hybrid mode or shutdown cleanup fails.
   */
  shutdown(): void { this.base.shutdown(); }
}

export function composeSessionReplay(
  base: FTCocosSDK,
  engine: 'creator2' | 'creator3',
  create: () => { transport: FTNativeTransport; capture: FTReplayCapture; pointers: FTReplayPointerSource },
): FTCocosReplaySDK {
  if (!base || base.extensionProtocol !== 1 || typeof base.registerExtension !== 'function') {
    throw new Error('Upgrade @truewatchtech/cocos-sdk to the matching Session Replay package version');
  }
  return base.registerExtension('session-replay', FT_COCOS_REPLAY_VERSION, engine, () => {
    const { transport, capture, pointers } = create();
    const replay = new FTSessionReplay(transport, capture, pointers, () => validateNativeReplay(transport, false));
    let pending: FTSessionReplayConfig | undefined;
    const facade = new FTCocosReplaySDK(base, replay, capture, config => { pending = config; });
    return {
      value: facade,
      lifecycle: {
        beforeStart: () => {
          if (pending === undefined) return;
          validateConfig(pending);
          samplingRate(pending.sampleRate, 'replay.sampleRate');
          samplingRate(pending.sessionOnErrorSampleRate, 'replay.sessionOnErrorSampleRate');
          validateNativeReplay(transport, false);
        },
        afterStart: () => { if (pending !== undefined) replay.start(pending); },
        beforeAttach: () => {
          if (pending !== undefined) {
            validateConfig(pending);
            validateNativeReplay(transport, true);
          }
          replay.attachHybrid(pending);
        },
        rollbackAttach: () => replay.detachHybrid(),
        enter: () => replay.enterHybrid(),
        leave: () => replay.leaveHybrid(),
        shutdown: () => replay.stop(),
      },
    };
  });
}

function validateConfig(config: FTHybridSessionReplayConfig): void {
  captureFps(config.captureFps);
  replayImagePolicy(config);
  if (config.touchPrivacy !== undefined && config.touchPrivacy !== 'hide' && config.touchPrivacy !== 'show') {
    throw new TypeError("touchPrivacy must be either 'show' or 'hide'");
  }
}

function validateNativeReplay(transport: FTNativeTransport, hybrid: boolean): void {
  if (transport.platform === 'unsupported') return;
  try {
    const result = transport.invoke<{ protocol: number }>('replay.capabilities', { hybrid });
    if (result?.protocol !== 1) throw new Error('Native Replay bridge protocol does not match');
  } catch (error) {
    throw new Error(`Session Replay native integration is unavailable. Run the SDK installer with --replay and rebuild the native application. ${String(error)}`);
  }
}
