import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { FTCocosPlatformSDK } from '../src/core/platform-client';
import type { FTPlatformContext, FTPlatformGlobal } from '../src/core/platform-runtime';

const hooks = { onSceneChanged: () => () => {}, onAction: () => () => {} };
afterEach(() => vi.useRealTimers());
function fixture(major: 2 | 3, platform: 'android' | 'ios') {
  vi.useFakeTimers();
  const target: FTPlatformGlobal = {};
  const calls: Array<{ method: string; payload: any }> = [];
  const reflection = { callStaticMethod: (...args: string[]) => {
    const method = args[args.length - 2]!; calls.push({ method, payload: JSON.parse(args[args.length - 1]!) });
    return JSON.stringify({ ok: true, value: method === 'replay.capabilities' ? { protocol: 1 } : undefined });
  } };
  const engine = { native: { reflection }, sys: { os: platform, OS: { ANDROID: 'android', IOS: 'ios' }, OS_ANDROID: 'android', OS_IOS: 'ios' },
    director: { getScene: () => null }, isValid: () => false, view: {} };
  const context: FTPlatformContext = { engine: `creator${major}`, platform, hooks, reflection, engineApi: engine, canvasIsPublic: () => true };
  const vm = { globalThis: target, console, setTimeout, clearTimeout, cc: engine, jsb: { reflection }, CC_JSB: true, CC_ANDROID: platform === 'android', CC_IOS: platform === 'ios' };
  runInNewContext(readFileSync('packages/cocos/runtime/native.js', 'utf8'), vm);
  runInNewContext(readFileSync(`packages/cocos-session-replay/runtime/creator${major}.js`, 'utf8'), vm);
  target.__FT_COCOS_CONFIGURATION__ = { sdk: { datakitUrl: 'http://localhost' }, rum: { androidAppId: 'a', iosAppId: 'i' },
    replay: { sessionReplaySamplingRate: 25, captureFps: 2, maxImageDimension: 720, touchPrivacy: 'hide' } };
  return { target, calls, context, sdk: new FTCocosPlatformSDK(`creator${major}`, () => context, target),
    other: new FTCocosPlatformSDK(`creator${major}`, () => context, target) };
}
describe('installed native Replay through the public entry', () => {
  it.each([[2, 'android'], [2, 'ios'], [3, 'android'], [3, 'ios']] as const)('runs the same API on Creator %s / %s', (major, platform) => {
    const f = fixture(major, platform);
    expect(() => f.sdk.replay.start()).toThrow('Start or attach');
    f.sdk.start();
    f.sdk.rum.addAction('level_started');
    f.other.replay.stop(); f.other.replay.start();
    const configurations = f.calls.filter(call => call.method === 'replay.configure');
    expect(configurations).toHaveLength(2);
    expect(configurations[1]!.payload).toEqual(configurations[0]!.payload);
    expect(configurations[0]!.payload.sessionReplaySamplingRate).toBe(25);
    f.other.stop(); f.sdk.stop();
    expect(f.calls.filter(call => call.method === 'sdk.shutdown')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    f.sdk.start(); f.sdk.stop();
    expect(f.calls.filter(call => call.method === 'sdk.shutdown')).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops Hybrid capture without shutting down the native host', () => {
    const f = fixture(3, 'ios'); f.sdk.attach();
    expect(() => f.sdk.replay.start()).toThrow('enterCocos');
    f.sdk.enterCocos({ viewName: 'Game' }); f.sdk.replay.stop(); f.sdk.replay.start(); f.sdk.stop();
    expect(f.calls.some(call => call.method === 'sdk.shutdown')).toBe(false);
    expect(f.calls.some(call => call.method === 'replay.configure')).toBe(false);
    expect(f.calls.filter(call => call.method === 'hybrid.setExternalRecorderActive').map(call => call.payload.active)).toEqual([true, false, true, false]);
    expect(vi.getTimerCount()).toBe(0);
    f.sdk.attach(); f.sdk.enterCocos({ viewName: 'Back' }); f.sdk.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps explicit legacy Replay composition compatible with installed project settings', () => {
    const f = fixture(3, 'android');
    const legacy = f.target.__FT_COCOS_REPLAY_FACTORY__!.create(f.sdk as any, f.context);
    legacy.attach({ replay: { captureFps: 1 } });
    f.sdk.enterCocos({ viewName: 'Legacy' }); f.sdk.stop();
    expect(f.calls.filter(call => call.method === 'hybrid.attach')).toHaveLength(1);
    expect(f.calls.some(call => call.method === 'sdk.shutdown')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects a missing or mismatched optional runtime before native initialization', () => {
    const f = fixture(3, 'android'); delete f.target.__FT_COCOS_REPLAY_FACTORY__;
    expect(() => f.sdk.start()).toThrow('Replay runtime'); expect(f.calls).toEqual([]);
    f.sdk.stop();
  });
});
