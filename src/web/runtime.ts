import type { FTAttributes, FTUserData } from '../core/types.js';
import { samplingPercentage, samplingRate } from '../core/validation.js';
import { FT_COCOS_SDK_BRIDGE_INFO_KEY } from '../core/version.js';
import type { FTBrowserLogs, FTBrowserRum, FTCocosWebConfig, FTWebPageRuntime, FTWebWindow } from './types.js';

const TRACE_TYPES = {
  ddTrace: 'ddtrace', zipkinMultiHeader: 'zipkin', zipkinSingleHeader: 'zipkin_single_header',
  traceparent: 'w3c_traceparent', skywalking: 'skywalking_v3', jaeger: 'jaeger',
};

/** Owns page initialization once. Browser collectors live until the page is unloaded. */
export class FTWebRuntime implements FTWebPageRuntime {
  readonly protocol = 1 as const;
  private owner: object | undefined;
  private privacyCheck: (() => boolean) | undefined;
  private replayStarted = false;
  private readonly rum: FTBrowserRum | undefined;
  private readonly logs: FTBrowserLogs | undefined;

  constructor(readonly config: FTCocosWebConfig, target: FTWebWindow, beforeEngine = false) {
    // Keep later caller mutations from changing filtering or privacy after init.
    config = JSON.parse(JSON.stringify(config)) as FTCocosWebConfig;
    this.config = config;
    const web = config.web;
    if (!web) throw new Error('Configure web explicitly before starting the Web SDK');
    const connection = reportingConnection(web);
    const replay = web.replay;
    if (replay) {
      const keys = ['enabled', 'sessionReplaySamplingRate', 'sessionReplayOnErrorSamplingRate', 'canvasPrivacy', 'canvasId', 'captureFps', 'maxImageDimension', 'quality', 'maxFrameBytes'];
      for (const key of Object.keys(replay)) if (!keys.includes(key)) throw new Error(`Unsupported web.replay.${key}`);
    }
    if (!config.rum && !config.logger) throw new Error('Enable rum or logger for Web collection');
    if (!config.rum && (config.autoTrack?.scenes || config.autoTrack?.actions || config.autoTrack?.errors || config.autoTrack?.network)) throw new Error('Cocos RUM tracking requires rum configuration');
    if (config.trace && !config.rum) throw new Error('Web tracing requires RUM');
    if (config.autoTrack?.console && !config.logger) throw new Error('Console tracking requires logger');
    if (replay && (!beforeEngine || !config.rum)) throw new Error('Web Replay must be configured before engine boot with RUM enabled');
    if (replay && replay.enabled !== true) throw new Error('Web Replay requires enabled: true');
    if (replay?.canvasPrivacy !== undefined && !['block', 'allow'].includes(replay.canvasPrivacy)) {
      throw new Error('web.replay.canvasPrivacy must be block or allow');
    }
    const fps = integer(replay?.captureFps, 1, 5, 1, 'captureFps');
    const dimension = integer(replay?.maxImageDimension, 1, 2048, 720, 'maxImageDimension');
    if (web.outsideViewName !== undefined && !web.outsideViewName.trim()) throw new Error('outsideViewName must not be empty');
    if (web.allowedTracingUrls?.some(url => typeof url !== 'string' || !/^https?:\/\//.test(url))) {
      throw new Error('allowedTracingUrls must contain absolute HTTP(S) URL prefixes');
    }
    if (replay?.quality !== undefined && !(typeof replay.quality === 'number'
      ? Number.isFinite(replay.quality) && replay.quality >= 0 && replay.quality <= 1
      : ['low', 'medium', 'high'].includes(replay.quality))) throw new Error('web.replay.quality must be low, medium, high, or a number between 0 and 1');
    const quality = replay?.quality === 'low' ? 0.25 : replay?.quality === 'medium' ? 0.4 : replay?.quality === 'high' ? 0.5 : replay?.quality ?? 0.4;
    const maxBytes = integer(replay?.maxFrameBytes, 1024, 1048576, 40000, 'web.replay.maxFrameBytes');
    const common = { ...connection, service: config.sdk?.serviceName, env: config.sdk?.env, telemetrySampleRate: 0 };
    const rumConfig = config.rum ? {
      ...common,
      applicationId: required(web.applicationId, 'web.applicationId'),
      sessionSampleRate: percentage(config.rum.sessionSamplingRate, config.rum.sampleRate, 100, 'sessionSamplingRate'),
      sessionOnErrorSampleRate: percentage(config.rum.sessionOnErrorSamplingRate, config.rum.sessionOnErrorSampleRate, 0, 'sessionOnErrorSamplingRate'),
      trackViewsManually: true,
      trackUserInteractions: false,
      sessionReplaySampleRate: percentage(replay?.sessionReplaySamplingRate, undefined, replay ? 100 : 0, 'sessionReplaySamplingRate'),
      sessionReplayOnErrorSampleRate: percentage(replay?.sessionReplayOnErrorSamplingRate, undefined, 0, 'sessionReplayOnErrorSamplingRate'),
      allowedTracingUrls: config.trace ? web.allowedTracingUrls || [] : [],
      tracingSampleRate: percentage(config.trace?.traceSamplingRate, config.trace?.sampleRate, 100, 'traceSamplingRate'),
      traceType: TRACE_TYPES[config.trace?.traceType || 'ddTrace'],
      replayCanvasEnabled: !!replay,
      replayCanvasMode: 'auto',
      replayCanvasSampling: fps,
      replayCanvasAutoInterval: 1000 / fps,
      // The WebGL plugin otherwise retains a 1000ms cooldown, overriding higher target FPS.
      // One in-flight encode and the capture interval bound load; 1ms is the minimum accepted cooldown.
      replayCanvasAutoCooldown: 1,
      replayCanvasQuality: quality,
      replayCanvasMaxEncodedBytes: maxBytes,
      replayCanvasMaxCanvasSize: dimension,
      replayCanvasMaxConcurrentEncodes: 1,
      replayCanvasAutoMaxPerRun: 1,
      defaultPrivacyLevel: 'mask',
      shouldRecordCanvas: (canvas: HTMLCanvasElement) => {
        if (!this.replayStarted || replay?.canvasPrivacy !== 'allow' || canvas.id !== (replay.canvasId || 'GameCanvas')) return false;
        // Fail closed until the engine has registered a fresh scene privacy check.
        try { return this.privacyCheck?.() === true; } catch { return false; }
      },
      beforeSend: (event: { type?: string; context?: FTAttributes }) => {
        const manual = !!event.context?.[FT_COCOS_SDK_BRIDGE_INFO_KEY];
        if (event.type === 'resource') return config.autoTrack?.network === true;
        if (event.type === 'error') return manual || config.autoTrack?.errors === true;
        if (event.type === 'long_task') return web.trackLongTasks === true;
        return true;
      },
    } : undefined;
    const logsConfig = config.logger ? {
      ...common,
      sessionSampleRate: percentage(config.logger.logSamplingRate, config.logger.sampleRate, 100, 'logSamplingRate'),
      forwardErrorsToLogs: false,
      forwardConsoleLogs: [],
      forwardReports: [],
    } : undefined;
    this.rum = rumConfig ? target.TRUEWATCH_RUM || target.DATAFLUX_RUM : undefined;
    this.logs = logsConfig ? target.TRUEWATCH_LOGS || target.DATAFLUX_LOGS : undefined;
    const webgl = target.TRUEWATCH_RUM_WEBGL || target.DATAFLUX_RUM_WEBGL;
    // Preflight every dependency before the first irreversible Browser init.
    if (rumConfig && (!this.rum || typeof this.rum.getInitConfiguration !== 'function')) throw new Error('Load the Browser RUM bundle before Cocos');
    if (logsConfig && (!this.logs || typeof this.logs.getInitConfiguration !== 'function')) throw new Error('Load the Browser Logs bundle before Cocos');
    if (this.rum?.getInitConfiguration() || this.logs?.getInitConfiguration()) throw new Error('Browser SDK already initialized; use the page bootstrap and attach()');
    if (replay && !webgl?.webglReplayPlugin) throw new Error('Load the Browser WebGL bundle before Cocos');
    if (rumConfig && this.rum) {
      let accepted = false;
      const ownershipPlugin = { name: 'cocos-adapter', onInit: (): void => { accepted = true; } };
      this.rum.init({
        ...rumConfig,
        plugins: [ownershipPlugin, ...(replay ? [webgl!.webglReplayPlugin()] : [])],
      });
      // A host awaiting its first manual view can still return undefined from getInitConfiguration().
      if (!accepted) throw new Error('Browser RUM is already initialized or did not accept Cocos initialization');
      this.setContext(this.rum, { ...config.sdk?.globalContext, ...config.rum?.globalContext });
      // Browser 3.3 exposes its public init configuration only after the first manual view.
      this.rum.startView({ name: web.outsideViewName || 'CocosInactive' });
      if (!this.rum.getInitConfiguration()) throw new Error('Browser RUM rejected its configuration');
      this.rum.stopSessionReplayRecording();
    }
    if (logsConfig && this.logs) {
      this.logs.init(logsConfig);
      if (!this.logs.getInitConfiguration()) throw new Error('Browser Logs rejected its configuration');
      this.setContext(this.logs, { ...config.sdk?.globalContext, ...config.logger?.globalContext });
    }
  }

  claim(owner: object): void {
    if (this.owner && this.owner !== owner) throw new Error('Another Cocos facade already owns this page attachment');
    this.owner = owner;
  }
  release(owner: object): void {
    if (this.owner !== owner) return;
    this.stopReplay();
    this.privacyCheck = undefined;
    this.owner = undefined;
  }
  setPrivacyCheck(owner: object, check: (() => boolean) | undefined): void {
    if (this.owner !== owner) throw new Error('Attach the Web SDK before configuring privacy');
    this.privacyCheck = check;
  }
  startReplay(): void {
    if (!this.config.web.replay) throw new Error('Configure Web Replay in the pre-engine bootstrap');
    this.replayStarted = true;
    this.rum!.startSessionReplayRecording();
  }
  stopReplay(): void {
    if (!this.replayStarted) return;
    this.replayStarted = false;
    this.rum?.stopSessionReplayRecording();
  }
  isRecording(): boolean { return this.replayStarted && !!this.rum?.isRecording(); }

  invoke<T>(method: string, input?: unknown): T | undefined {
    const data = (input || {}) as Record<string, any>;
    switch (method) {
      case 'sdk.bindUser': {
        const user = data as FTUserData;
        const identity = { ...user.extra, id: required(user.userId, 'userId'), name: user.userName, email: user.userEmail };
        this.rum?.setUser(identity); this.logs?.setUser(identity); break;
      }
      case 'sdk.unbindUser': this.rum?.clearUser(); this.logs?.clearUser(); break;
      case 'rum.startView': this.requireRum().startView({ name: data.name, context: data.attributes }); break;
      case 'rum.stopView': this.requireRum().startView({ name: this.config.web.outsideViewName || 'CocosInactive', context: data.attributes }); break;
      case 'rum.addAction': this.requireRum().addTypeAction(data.name, data.type, data.attributes); break;
      case 'rum.addError': {
        const error = new Error(data.message); error.name = data.type; error.stack = data.stack;
        this.requireRum().addError(error, { ...data.attributes, cocos_error_state: data.state }); break;
      }
      case 'logger.log': {
        if (!this.logs) throw new Error('Web logging was not enabled');
        const config = this.config.logger!;
        if (config.enableCustomLog === false || (config.logLevelFilters && config.logLevelFilters.indexOf(data.level) < 0)) break;
        const status = data.level === 'warning' ? 'warn' : data.level;
        if (['ok', 'debug', 'info', 'notice', 'warn', 'error', 'critical', 'alert', 'emerg'].indexOf(status) < 0) {
          throw new Error(`Unsupported Browser log level: ${data.level}`);
        }
        this.logs.logger.log(data.content, data.attributes, status); break;
      }
      default: throw new Error(`${method} is not supported on Web. Configure collectors at page bootstrap; use Browser automatic network/trace collection and detach() for Cocos cleanup.`);
    }
    return undefined;
  }
  private requireRum(): FTBrowserRum {
    if (!this.rum) throw new Error('Web RUM was not enabled');
    return this.rum;
  }
  private setContext(api: FTBrowserRum | FTBrowserLogs, context: Record<string, unknown>): void {
    Object.keys(context).forEach(key => api.setGlobalContextProperty(key, context[key]));
  }
}

export function bootstrapWeb(config: FTCocosWebConfig, target: FTWebWindow = window as FTWebWindow): FTWebPageRuntime {
  if (target.__FT_COCOS_WEB__) throw new Error('Cocos Web bootstrap already initialized');
  const runtime = new FTWebRuntime(config, target, true);
  target.__FT_COCOS_WEB__ = runtime;
  return runtime;
}
function required(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}
function reportingConnection(web: FTCocosWebConfig['web']): Record<string, string> {
  if (web.datakitOrigin && (web.site || web.clientToken)) throw new Error('Choose datakitOrigin or site with clientToken');
  const origin = required(web.datakitOrigin || web.site, 'web.datakitOrigin or web.site');
  if (!/^https?:\/\/[^/?#@]+\/?$/.test(origin)) throw new Error('Browser reporting endpoint must be an HTTP(S) origin without a path, credentials, query or fragment');
  return web.datakitOrigin ? { datakitOrigin: origin } : { site: origin, clientToken: required(web.clientToken, 'web.clientToken') };
}
function percentage(value: number | undefined, legacy: number | undefined, fallback: number, name: string): number {
  return value !== undefined ? samplingPercentage(value, name)! : legacy !== undefined ? samplingRate(legacy, name)! * 100 : fallback;
}
function integer(value: number | undefined, min: number, max: number, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  return value;
}
