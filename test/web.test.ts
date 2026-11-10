import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTCocosPlatformSDK } from '../src/core/platform-client';
import { platformImplementation, type FTPlatformGlobal } from '../src/core/platform-runtime';
import { FTCocosWebSDK } from '../src/web/client';
import { bootstrapWeb, FTWebRuntime } from '../src/web/runtime';
import { isScenePublic } from '../src/web/privacy';
import type { FTCocosWebConfig, FTWebWindow } from '../src/web/types';
import type { FTEngineTrackingHooks } from '../src/core/auto-tracking';
import { FT_COCOS_SDK_BRIDGE_INFO_KEY, FT_COCOS_SDK_VERSION } from '../src/core/version';
import { replayError } from '../src/session-replay/core/internal-errors';

function setup(configure: Partial<FTCocosWebConfig> = {}) {
  let rumConfig: Record<string, any> | undefined;
  let logsConfig: Record<string, any> | undefined;
  const target: FTWebWindow = {
    TRUEWATCH_RUM: {
      init: vi.fn(value => { rumConfig = value; (value.plugins as Array<{ onInit?: () => void }> | undefined)?.forEach(plugin => plugin.onInit?.()); }), getInitConfiguration: () => rumConfig,
      startView: vi.fn(), addTypeAction: vi.fn(), addError: vi.fn(), setUser: vi.fn(), clearUser: vi.fn(),
      setGlobalContextProperty: vi.fn(), startSessionReplayRecording: vi.fn(), stopSessionReplayRecording: vi.fn(), isRecording: () => true,
    },
    TRUEWATCH_LOGS: {
      init: vi.fn(value => { logsConfig = value; }), getInitConfiguration: () => logsConfig,
      setUser: vi.fn(), clearUser: vi.fn(), setGlobalContextProperty: vi.fn(), logger: { log: vi.fn() },
    },
    TRUEWATCH_RUM_WEBGL: { webglReplayPlugin: vi.fn(() => ({ name: 'session-replay-webgl' })) },
  };
  let scene: ((name: string) => void) | undefined;
  let action: ((name: string) => void) | undefined;
  const stopScene = vi.fn(); const stopAction = vi.fn();
  const hooks: FTEngineTrackingHooks = {
    onSceneChanged: vi.fn((callback, current) => { scene = callback; if (current) callback('SceneOne'); return stopScene; }),
    onAction: vi.fn(callback => { action = callback; return stopAction; }),
  };
  const config: FTCocosWebConfig = {
    web: { applicationId: 'web-app', datakitOrigin: 'http://127.0.0.1:8080', outsideViewName: 'HostPage' },
    sdk: { serviceName: 'game', env: 'local' },
    rum: {}, logger: {}, autoTrack: { scenes: true, actions: true, network: true, errors: true }, ...configure,
  };
  const sdk = new FTCocosWebSDK(hooks, () => true, target);
  return { sdk, target, config, hooks, stopScene, stopAction, scene: (name: string) => scene!(name), action: (name: string) => action!(name),
    rum: target.TRUEWATCH_RUM!, logs: target.TRUEWATCH_LOGS!, rumConfig: () => rumConfig!, logsConfig: () => logsConfig! };
}
afterEach(() => vi.restoreAllMocks());

describe('Cocos Web facade', () => {
  it('uses TrueWatch globals when compatibility aliases are also present', () => {
    const f = setup(); f.config.web.replay = { enabled: true };
    const legacyInit = vi.fn(); const legacyWebgl = vi.fn();
    f.target.DATAFLUX_RUM = { ...f.rum, init: legacyInit };
    f.target.DATAFLUX_LOGS = { ...f.logs, init: legacyInit };
    f.target.DATAFLUX_RUM_WEBGL = { webglReplayPlugin: legacyWebgl };
    bootstrapWeb(f.config, f.target);
    expect(f.rum.init).toHaveBeenCalledOnce();
    expect(f.logs.init).toHaveBeenCalledOnce();
    expect(f.target.TRUEWATCH_RUM_WEBGL!.webglReplayPlugin).toHaveBeenCalledOnce();
    expect(legacyInit).not.toHaveBeenCalled(); expect(legacyWebgl).not.toHaveBeenCalled();
  });

  it('accepts Browser compatibility globals when primary globals are absent', () => {
    const f = setup(); f.config.web.replay = { enabled: true };
    f.target.DATAFLUX_RUM = f.target.TRUEWATCH_RUM; delete f.target.TRUEWATCH_RUM;
    f.target.DATAFLUX_LOGS = f.target.TRUEWATCH_LOGS; delete f.target.TRUEWATCH_LOGS;
    f.target.DATAFLUX_RUM_WEBGL = f.target.TRUEWATCH_RUM_WEBGL; delete f.target.TRUEWATCH_RUM_WEBGL;
    bootstrapWeb(f.config, f.target);
    expect(f.rum.init).toHaveBeenCalledOnce(); expect(f.logs.init).toHaveBeenCalledOnce();
    expect(f.target.DATAFLUX_RUM_WEBGL!.webglReplayPlugin).toHaveBeenCalledOnce();
  });

  it('keeps internal SDK diagnostics on the console while collecting business and manual logs', () => {
    const f = setup({ autoTrack: { console: true } });
    const original = vi.fn();
    const consoleObject = { log: original, info: original, warn: original, error: original } as unknown as Console;
    const sdk = new FTCocosWebSDK(f.hooks, () => true, f.target, consoleObject);
    sdk.start(f.config);
    try {
      const error = new Error('Missing Replay privacy perspective projection');
      for (const method of ['log', 'info', 'warn', 'error'] as const) {
        consoleObject[method]('[cocos-sdk] Session Replay frame dropped:', error);
        expect(original).toHaveBeenLastCalledWith('[cocos-sdk] Session Replay frame dropped:', error);
      }
      expect(original).toHaveBeenCalledTimes(4);
      expect(f.logs.logger.log).not.toHaveBeenCalled();
      consoleObject.error('business mentions [cocos-sdk]');
      consoleObject.warn('Missing Replay privacy skinned bounds');
      sdk.logger.log('[cocos-sdk] explicitly requested log', 'error');
      expect(f.logs.logger.log).toHaveBeenCalledTimes(3);
      expect(f.logs.logger.log).toHaveBeenCalledWith('business mentions [cocos-sdk]', expect.any(Object), 'error');
      expect(f.logs.logger.log).toHaveBeenCalledWith('Missing Replay privacy skinned bounds', expect.any(Object), 'warn');
      expect(f.logs.logger.log).toHaveBeenCalledWith('[cocos-sdk] explicitly requested log', expect.any(Object), 'error');
    } finally {
      sdk.detach();
    }
    expect(consoleObject.error).toBe(original);
  });

  it('shares Replay controls and stop/restart state between common and explicit Web entrypoints', () => {
    const f = setup(); f.config.web.replay = { enabled: true, captureFps: 5, quality: 'high', maxFrameBytes: 65536 };
    bootstrapWeb(f.config, f.target);
    const target = f.target as FTWebWindow & FTPlatformGlobal;
    target.__FT_COCOS_WEB_FACTORY__ = { protocol: 1, version: FT_COCOS_SDK_VERSION, create: () => f.sdk };
    const context = { engine: 'creator3' as const, platform: 'web' as const, hooks: f.hooks, canvasIsPublic: () => true };
    const sdk = new FTCocosPlatformSDK('creator3', () => context, target);
    platformImplementation(context, target);
    f.sdk.start(); sdk.replay.stop(); sdk.replay.start(); sdk.stop(); sdk.stop();
    expect(f.sdk.lifecycleMode).toBe('idle');
    sdk.start(); f.sdk.stop();
    expect(f.rum.init).toHaveBeenCalledOnce();
    expect(f.rumConfig()).toMatchObject({ replayCanvasAutoInterval: 200, replayCanvasAutoCooldown: 1,
      replayCanvasQuality: 0.5, replayCanvasMaxEncodedBytes: 65536 });
  });
  it.each([{ quality: 1.1 }, { quality: 'unknown' }, { maxFrameBytes: 0 }, { imagePolicy: {} }])('rejects invalid Web encoding settings %j before Browser initialization', options => {
    const f = setup(); f.config.web.replay = { enabled: true, ...options } as any;
    expect(() => bootstrapWeb(f.config, f.target)).toThrow(); expect(f.rum.init).not.toHaveBeenCalled();
  });

  it('maps shared units, identity, errors, views, actions and log parameter order', () => {
    const f = setup({
      sdk: { globalContext: { feature: 'checkout' } },
      rum: { sampleRate: .3, globalContext: { scope: 'rum' } },
      logger: { logSamplingRate: 12.5, globalContext: { scope: 'logs' } },
      trace: { traceType: 'traceparent', sampleRate: .25 },
    });
    f.sdk.start(f.config);
    expect(f.rumConfig()).toMatchObject({ applicationId: 'web-app', sessionSampleRate: 30, tracingSampleRate: 25, traceType: 'w3c_traceparent', trackViewsManually: true, trackUserInteractions: false, sessionReplaySampleRate: 0 });
    expect(f.logsConfig()).toMatchObject({ sessionSampleRate: 12.5, forwardErrorsToLogs: false, forwardConsoleLogs: [] });
    expect(vi.mocked(f.rum.setGlobalContextProperty).mock.calls).toEqual([['feature', 'checkout'], ['scope', 'rum']]);
    expect(vi.mocked(f.logs.setGlobalContextProperty).mock.calls).toEqual([['feature', 'checkout'], ['scope', 'logs']]);
    f.sdk.mobile.bindUser({ userId: '42', userName: 'Ada', userEmail: 'ada@example.invalid', extra: { role: 'tester' } });
    expect(f.rum.setUser).toHaveBeenCalledWith({ id: '42', name: 'Ada', email: 'ada@example.invalid', role: 'tester' });
    expect(f.logs.setUser).toHaveBeenCalledWith({ id: '42', name: 'Ada', email: 'ada@example.invalid', role: 'tester' });
    f.sdk.rum.addError('oops', 'stack', 'CustomError', 'startup', { stage: 1 });
    const error = vi.mocked(f.rum.addError).mock.calls[0]![0];
    expect(error).toMatchObject({ name: 'CustomError', message: 'oops', stack: 'stack' });
    expect(vi.mocked(f.rum.addError).mock.calls[0]![1]).toMatchObject({ stage: 1, cocos_error_state: 'startup' });
    f.action('Button'); f.scene('SceneTwo');
    expect(f.rum.addTypeAction).toHaveBeenCalledWith('Button', 'click', expect.any(Object));
    expect(f.rum.startView).toHaveBeenLastCalledWith({ name: 'SceneTwo', context: expect.any(Object) });
    f.sdk.logger.log('warning', 'warning', { count: 1 });
    expect(f.logs.logger.log).toHaveBeenCalledWith('warning', expect.objectContaining({ count: 1 }), 'warn');
    f.sdk.mobile.unbindUser(); expect(f.rum.clearUser).toHaveBeenCalledOnce(); expect(f.logs.clearUser).toHaveBeenCalledOnce();
    f.sdk.detach(); expect(f.stopScene).toHaveBeenCalledOnce(); expect(f.stopAction).toHaveBeenCalledOnce();
  });

  it('attaches without reinitializing and leaves the page session and network hooks owned by Browser', () => {
    const f = setup(); const originalFetch = globalThis.fetch;
    bootstrapWeb(f.config, f.target); f.sdk.attach(); f.sdk.enterCocos();
    f.sdk.enterCocos(); f.sdk.leaveCocos();
    expect(f.rum.startView).toHaveBeenLastCalledWith({ name: 'HostPage', context: expect.any(Object) });
    expect(f.rum.init).toHaveBeenCalledOnce(); expect(globalThis.fetch).toBe(originalFetch);
    f.sdk.detach(); f.sdk.attach(); f.sdk.enterCocos({ viewName: 'Back' });
    expect(f.rum.init).toHaveBeenCalledOnce(); f.sdk.detach();
  });

  it('supports standalone start through the default entry without a second Browser init', () => {
    const f = setup(); bootstrapWeb(f.config, f.target);
    const target = f.target as FTWebWindow & FTPlatformGlobal;
    target.__FT_COCOS_WEB_FACTORY__ = { protocol: 1, version: FT_COCOS_SDK_VERSION, create: () => f.sdk };
    const context = { engine: 'creator3' as const, platform: 'web' as const, hooks: f.hooks, canvasIsPublic: () => true };
    const sdk = new FTCocosPlatformSDK('creator3', () => context, target);
    sdk.start({ sdk: { datakitUrl: 'http://native-only' }, rum: { androidAppId: 'native-only' } });
    sdk.rum.addAction('common-event');
    expect(f.rum.addTypeAction).toHaveBeenCalledWith('common-event', 'click', expect.any(Object));
    expect(f.rum.init).toHaveBeenCalledOnce();
    expect(platformImplementation(context, target, () => { throw new Error('duplicate instance'); })).toBe(f.sdk);
    sdk.detach();
    sdk.start(); expect(f.rum.init).toHaveBeenCalledOnce(); sdk.detach();
  });

  it('rejects settings that conflict with pre-engine initialization before claiming ownership', () => {
    const f = setup(); bootstrapWeb(f.config, f.target);
    expect(() => f.sdk.start({ web: { ...f.config.web, applicationId: 'other' } })).toThrow('web.applicationId');
    expect(() => f.sdk.start({ sdk: { serviceName: 'other' } })).toThrow('sdk.serviceName');
    expect(() => f.sdk.start({ sdk: {}, autoTrack: { network: false } })).toThrow('page bootstrap');
    f.sdk.start(f.config); expect(f.rum.init).toHaveBeenCalledOnce(); f.sdk.detach();
  });

  it('preflights all dependencies and sample rates before initialization', () => {
    const f = setup(); delete f.target.TRUEWATCH_LOGS;
    expect(() => bootstrapWeb(f.config, f.target)).toThrow('Browser Logs'); expect(f.rum.init).not.toHaveBeenCalled();
    const g = setup({ logger: { logSamplingRate: -1 } });
    expect(() => bootstrapWeb(g.config, g.target)).toThrow('between 0 and 100'); expect(g.rum.init).not.toHaveBeenCalled();
    const h = setup({ rum: { sampleRate: .2, sessionSamplingRate: 75 } });
    h.sdk.start(h.config); expect(h.rumConfig().sessionSampleRate).toBe(75); h.sdk.detach();
  });

  it('starts the initial manual view before checking the Browser initialization result', () => {
    const f = setup();
    f.rum.getInitConfiguration = () => vi.mocked(f.rum.startView).mock.calls.length ? f.rumConfig() : undefined;
    bootstrapWeb(f.config, f.target);
    expect(f.rum.startView).toHaveBeenCalledWith({ name: 'HostPage' });
    f.sdk.attach(); f.sdk.detach();
  });

  it('does not reuse native application IDs or reporting endpoints', () => {
    const f = setup({ web: {}, sdk: { datakitUrl: 'http://localhost' }, rum: { androidAppId: 'native' } });
    expect(() => f.sdk.start(f.config)).toThrow('web.datakitOrigin');
    f.config.web.datakitOrigin = 'http://localhost';
    expect(() => f.sdk.start(f.config)).toThrow('web.applicationId'); expect(f.rum.init).not.toHaveBeenCalled();
  });

  it('rejects duplicate ownership and incompatible attachment configuration', () => {
    const f = setup(); bootstrapWeb(f.config, f.target); f.sdk.attach();
    const other = new FTCocosWebSDK(f.hooks, () => true, f.target);
    expect(() => other.attach()).toThrow('Another Cocos');
    f.sdk.detach(); expect(() => other.attach({ applicationId: 'native-app' })).toThrow('does not match');
    expect(() => other.attach({ autoTrack: { network: false } })).toThrow('page bootstrap');
    other.attach(); other.detach();
    expect(() => bootstrapWeb(f.config, f.target)).toThrow('already initialized');
  });

  it('fails explicitly for APIs that cannot preserve native semantics', () => {
    const f = setup(); f.sdk.start(f.config);
    for (const operation of [() => f.sdk.rum.startAction('timed'), () => f.sdk.rum.startResource('key'),
      () => f.sdk.rum.stopResource('key'), () => f.sdk.rum.addResource('key', { url: 'https://example.invalid', httpMethod: 'GET' }),
      () => f.sdk.rum.addLongTask('stack', 1000), () => f.sdk.trace.getHeaders('https://example.invalid'),
      () => f.sdk.mobile.shutdown(), () => f.sdk.rum.start({}), () => f.sdk.logger.start({})]) {
      expect(operation).toThrow('not supported on Web');
    }
    expect(() => f.sdk.shutdown()).toThrow('no public shutdown');
    expect(() => f.sdk.setReplayCamera({})).toThrow('configured canvas'); f.sdk.detach();
  });

  it('filters automatic Browser events according to explicit opt-in while retaining manual errors', () => {
    const f = setup({ autoTrack: {} }); f.sdk.start(f.config);
    const filter = f.rumConfig().beforeSend;
    expect(filter({ type: 'resource' })).toBe(false); expect(filter({ type: 'error' })).toBe(false);
    expect(filter({ type: 'long_task' })).toBe(false);
    expect(filter({ type: 'error', context: { [FT_COCOS_SDK_BRIDGE_INFO_KEY]: 'bridge' } })).toBe(true);
    expect(filter({ type: 'view' })).toBe(true); f.sdk.detach();
  });

  it('filters tagged automatic Browser errors but preserves untagged and explicit manual errors', () => {
    const f = setup(); f.sdk.start(f.config);
    const filter = f.rumConfig().beforeSend;
    const error = replayError('Missing Replay privacy skinned bounds');
    expect(filter({ type: 'error', error: { message: error.message, stack: error.stack } })).toBe(false);
    expect(filter({ type: 'error', error: { stack: error.stack } })).toBe(false);
    expect(filter({ type: 'error', error: { message: 'Missing Replay privacy skinned bounds' } })).toBe(true);
    expect(filter({ type: 'error', error: { message: error.message },
      context: { [FT_COCOS_SDK_BRIDGE_INFO_KEY]: 'bridge' } })).toBe(true);
    f.sdk.detach();
  });

  it('starts WebGL before engine boot and fails closed until privacy is registered', () => {
    const f = setup(); f.config.web.replay = { enabled: true, canvasPrivacy: 'allow', sessionReplaySamplingRate: 100 };
    expect(() => f.sdk.start(f.config)).toThrow('before engine boot');
    bootstrapWeb(f.config, f.target);
    expect(f.target.TRUEWATCH_RUM_WEBGL!.webglReplayPlugin).toHaveBeenCalledOnce();
    const allowed = f.rumConfig().shouldRecordCanvas;
    const canvas = { id: 'GameCanvas' };
    expect(allowed(canvas)).toBe(false);
    f.sdk.attach(); f.sdk.enterCocos(); expect(allowed(canvas)).toBe(true); expect(allowed({ id: 'OtherCanvas' })).toBe(false);
    const node = {}; f.sdk.replay.setPrivacy(node, 'mask'); expect(allowed(canvas)).toBe(false);
    f.sdk.replay.setPrivacy(node, 'unmask'); expect(allowed(canvas)).toBe(true);
    f.sdk.leaveCocos(); expect(allowed(canvas)).toBe(false); f.sdk.detach();
  });

  it('blocks canvas capture by default even when Replay is enabled', () => {
    const f = setup(); f.config.web.replay = { enabled: true, sessionReplaySamplingRate: 100 };
    bootstrapWeb(f.config, f.target); f.sdk.attach(); f.sdk.enterCocos();
    expect(f.rumConfig().shouldRecordCanvas({ id: 'GameCanvas' })).toBe(false); f.sdk.detach();
  });

  it('recognizes a privacy component by its contract when its registered class name differs', () => {
    const component = { enabled: true, enabledInHierarchy: true, replayPrivacyMode: 'mask' };
    const scene = { children: [], getComponent: () => undefined, getComponents: () => [component] };
    expect(isScenePublic(scene)).toBe(false);
    component.enabled = false; expect(isScenePublic(scene)).toBe(true);
  });
  it('blocks active ReplayPrivacy components and edit boxes, including children added later', () => {
    const scene: any = { children: [], getComponent: () => undefined };
    expect(isScenePublic(scene)).toBe(true); expect(isScenePublic(null)).toBe(false);
    const legacyScene = { children: [], get activeInHierarchy(): boolean { throw new Error('Unsupported on Creator 2 Scene'); } };
    expect(isScenePublic(legacyScene, false)).toBe(true);
    scene.children.push({ getComponent: (name: string) => name === 'ReplayPrivacy' ? { enabledInHierarchy: true } : undefined });
    expect(isScenePublic(scene)).toBe(false); scene.children[0].activeInHierarchy = false;
    expect(isScenePublic(scene)).toBe(true);
    scene.children.push({ getComponent: (name: string) => name === 'cc.EditBox' ? {} : undefined });
    expect(isScenePublic(scene)).toBe(false);
  });

  it('does not take over a host waiting for its first manual view', () => {
    const f = setup();
    f.rum.getInitConfiguration = () => undefined;
    f.rum.init = vi.fn();
    expect(() => bootstrapWeb(f.config, f.target)).toThrow('already initialized');
    expect(f.rum.startView).not.toHaveBeenCalled();
    expect(f.rum.setGlobalContextProperty).not.toHaveBeenCalled();
    expect(f.logs.init).not.toHaveBeenCalled();
  });

  it('does not stop or reinitialize an unrelated Browser SDK instance', () => {
    const f = setup(); f.rum.init({ applicationId: 'host' });
    expect(() => new FTWebRuntime(f.config, f.target)).toThrow('already initialized');
    expect(f.rum.stopSessionReplayRecording).not.toHaveBeenCalled(); expect(f.logs.init).not.toHaveBeenCalled();
  });
});
