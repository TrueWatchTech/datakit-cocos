import { FTLogger, FTMobileAgent, FTRUM, FTTrace } from '../core/modules.js';
import type { FTEngineTrackingHooks } from '../core/auto-tracking.js';
import type { FTNativeTransport } from '../core/transport.js';
import type { FTAutoTrackingConfig, FTCocosConfig, FTCocosEnterOptions, FTValue } from '../core/types.js';
import { FTWebRuntime } from './runtime.js';
import type { FTCocosWebAttachConfig, FTCocosWebConfig, FTWebPageRuntime, FTWebWindow } from './types.js';

/** Web facade. Browser owns page-wide collectors; detach only removes Cocos instrumentation. */
export class FTCocosWebSDK {
  readonly platform = 'web' as const;
  readonly capabilities = {
    timedActions: false, manualResourceTiming: false, manualLongTasks: false,
    manualTraceHeaders: false, shutdown: false, nodeReplayMasks: false,
  } as const;
  readonly mobile: FTMobileAgent;
  readonly rum: FTRUM;
  readonly logger: FTLogger;
  readonly trace: FTTrace;
  private runtime: FTWebPageRuntime | undefined;
  private tracking: FTAutoTrackingConfig = {};
  private state: 'idle' | 'attached' | 'entered' | 'standalone' = 'idle';
  private stops: Array<() => void> = [];
  private activeView = false;
  private readonly privateNodes = new Map<unknown, string>();
  get lifecycleMode(): 'idle' | 'standalone' | 'hybrid' {
    return this.state === 'idle' ? 'idle' : this.state === 'standalone' ? 'standalone' : 'hybrid';
  }
  get isCocosEntered(): boolean { return this.state === 'standalone' || this.state === 'entered'; }
  readonly replay = {
    /** Recording settings belong to the pre-engine Web bootstrap. */
    start: (): void => { this.requireRuntime().startReplay(); },
    stop: (): void => { this.requireRuntime().stopReplay(); },
    isRecording: (): boolean => this.runtime?.isRecording() || false,
    /** Any protected node blocks the entire Cocos canvas; Browser Replay cannot render node masks. */
    setPrivacy: (node: unknown, mode: 'mask' | 'hide' | 'unmask'): void => {
      if (!node) throw new Error('A Cocos node is required');
      if (mode === 'unmask') this.privateNodes.delete(node);
      else if (mode === 'mask' || mode === 'hide') this.privateNodes.set(node, mode);
      else throw new Error('Unknown Replay privacy mode');
    },
  };

  constructor(
    private readonly hooks: FTEngineTrackingHooks,
    private readonly canvasIsPublic: () => boolean,
    private readonly target: FTWebWindow = window as FTWebWindow,
    private readonly consoleObject: Console = console,
  ) {
    const transport: FTNativeTransport = {
      platform: 'web',
      invoke: <T = FTValue>(method: string, payload?: unknown): T | undefined => this.requireRuntime().invoke<T>(method, payload),
    };
    this.mobile = new FTMobileAgent(transport);
    this.rum = new FTRUM(transport);
    this.logger = new FTLogger(transport);
    this.trace = new FTTrace(transport);
  }

  /** Starts standalone Cocos tracking, reusing pre-engine configuration when installed. */
  start(config?: FTCocosWebConfig | FTCocosConfig): void {
    if (this.state !== 'idle') throw new Error('Web SDK already started or attached');
    if (config && 'replay' in config) throw new Error('Configure Web Replay at web.replay before engine boot');
    let runtime = this.target.__FT_COCOS_WEB__;
    if (runtime) {
      if (config) assertBootstrapConfiguration(config, runtime.config);
      this.attach({ autoTrack: config?.autoTrack });
    } else {
      if (!config || !('web' in config)) throw new Error('Configure web explicitly or install the pre-engine Web bootstrap');
      runtime = new FTWebRuntime(config, this.target);
      this.target.__FT_COCOS_WEB__ = runtime;
      this.bind(runtime, config.autoTrack || {});
    }
    this.state = 'standalone';
    try { this.startPage(); } catch (error) {
      try { this.detach(); } catch { /* Preserve the startup error. */ }
      throw error;
    }
  }

  /** Attaches to bootstrapWeb(), without initializing Browser collectors a second time. */
  attach(config: FTCocosWebAttachConfig = {}): void {
    if (this.state === 'standalone') throw new Error('start() and attach() are mutually exclusive');
    if (this.state !== 'idle') return;
    if ('replay' in config) throw new Error('Configure Web Replay at web.replay in the page bootstrap');
    const runtime = this.target.__FT_COCOS_WEB__;
    if (!runtime || runtime.protocol !== 1) throw new Error('Run the Cocos Web bootstrap before attach()');
    if (config.applicationId && config.applicationId !== runtime.config.web.applicationId) throw new Error('Web applicationId does not match page bootstrap');
    const tracking = { ...runtime.config.autoTrack, ...config.autoTrack };
    for (const key of ['network', 'errors'] as const) {
      if (!!tracking[key] !== !!runtime.config.autoTrack?.[key]) throw new Error(`Configure autoTrack.${key} at page bootstrap`);
    }
    this.bind(runtime, tracking);
    this.state = 'attached';
  }

  enterCocos(options: FTCocosEnterOptions = {}): void {
    if (this.state === 'idle') throw new Error('Call attach() before enterCocos()');
    if (this.state === 'standalone') throw new Error('enterCocos() requires attach()');
    if (this.state === 'entered') return;
    if (!this.tracking.scenes && !options.viewName?.trim()) throw new Error('enterCocos.viewName is required when scene tracking is disabled');
    try { this.startPage(options.viewName); this.state = 'entered'; }
    catch (error) {
      try { this.stopPage(); } catch { /* Preserve the entry error. */ }
      throw error;
    }
  }
  /** Transitions to web.outsideViewName (CocosInactive by default). Browser session/network collection continues. */
  leaveCocos(): void {
    if (this.state === 'standalone') throw new Error('Use detach() to stop standalone Cocos instrumentation on Web');
    if (this.state !== 'entered') return;
    try { this.stopPage(); } finally { this.state = 'attached'; }
  }
  /** Releases Cocos hooks and Replay. Browser page collectors remain initialized until navigation/unload. */
  detach(): void {
    if (this.state === 'idle') return;
    try { this.stopPage(); }
    finally {
      this.runtime!.release(this);
      this.runtime = undefined; this.state = 'idle'; this.privateNodes.clear();
    }
  }
  /** Stops this Cocos instance while retaining the page runtime. */
  stop(): void { this.detach(); }
  shutdown(): never {
    throw new Error('Browser SDK has no public shutdown API. Use detach() to release Cocos hooks; page collectors continue until unload.');
  }
  setReplayCamera(_camera: unknown): never {
    throw new Error('Browser Replay captures the configured canvas, not a Cocos camera');
  }

  private bind(runtime: FTWebPageRuntime, tracking: FTAutoTrackingConfig): void {
    if ((tracking.scenes || tracking.actions || tracking.errors || tracking.network) && !runtime.config.rum) throw new Error('Cocos RUM tracking requires rum configuration');
    if (tracking.console && !runtime.config.logger) throw new Error('Console tracking requires logger');
    runtime.claim(this);
    this.runtime = runtime; this.tracking = tracking;
    runtime.setPrivacyCheck(this, () => this.privateNodes.size === 0 && this.canvasIsPublic());
  }
  private startPage(viewName?: string): void {
    const view = (name: string): void => { this.rum.startView(name); this.activeView = true; };
    if (viewName) view(viewName);
    if (this.tracking.scenes) this.stops.push(this.hooks.onSceneChanged(view, !viewName));
    if (this.tracking.actions) this.stops.push(this.hooks.onAction((name, attributes) => this.rum.addAction(name, 'click', attributes)));
    if (this.tracking.console) this.trackConsole();
    if (this.runtime!.config.web.replay) this.runtime!.startReplay();
  }
  private stopPage(): void {
    let failure: unknown;
    const clean = (fn: () => void): void => { try { fn(); } catch (error) { if (!failure) failure = error; } };
    clean(() => this.runtime?.stopReplay());
    this.stops.splice(0).reverse().forEach(clean);
    if (this.activeView) { clean(() => this.rum.stopView()); this.activeView = false; }
    if (failure) throw failure;
  }
  private requireRuntime(): FTWebPageRuntime {
    if (!this.runtime) throw new Error('Start or attach the Cocos Web SDK first');
    return this.runtime;
  }
  private trackConsole(): void {
    (['log', 'info', 'warn', 'error'] as const).forEach(method => {
      const original = this.consoleObject[method];
      const wrapped = (...values: unknown[]): void => {
        original.apply(this.consoleObject, values);
        this.logger.log(values.map(value => {
          if (typeof value === 'string') return value;
          try { return JSON.stringify(value); } catch { return String(value); }
        }).join(' '), method === 'warn' ? 'warning' : method === 'error' ? 'error' : 'info');
      };
      this.consoleObject[method] = wrapped;
      this.stops.push(() => { if (this.consoleObject[method] === wrapped) this.consoleObject[method] = original; });
    });
  }
}

/** Native-only options may coexist, but settings used by Browser cannot change after bootstrap. */
function assertBootstrapConfiguration(config: FTCocosConfig | FTCocosWebConfig, installed: FTCocosWebConfig): void {
  const shared: Record<string, string[]> = {
    sdk: ['serviceName', 'env', 'globalContext'],
    rum: ['sessionSamplingRate', 'sampleRate', 'sessionOnErrorSamplingRate', 'sessionOnErrorSampleRate', 'globalContext'],
    logger: ['logSamplingRate', 'sampleRate', 'enableCustomLog', 'logLevelFilters', 'globalContext'],
    trace: ['traceType', 'traceSamplingRate', 'sampleRate'],
    web: Object.keys(('web' in config && config.web) || {}),
  };
  Object.keys(shared).forEach(group => {
    const requested = (config as any)[group];
    if (requested === undefined) return;
    const actual = (installed as any)[group];
    if (actual === undefined) throw new Error(`Configure ${group} in the pre-engine Web bootstrap`);
    shared[group]!.forEach(key => {
      if (requested[key] !== undefined && stableValue(requested[key]) !== stableValue(actual[key])) {
        throw new Error(`Configure ${group}.${key} in the pre-engine Web bootstrap; collectors are already initialized`);
      }
    });
  });
}
function stableValue(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.keys(item).sort().reduce((result: Record<string, unknown>, key) => { result[key] = item[key]; return result; }, {}) : item);
}
