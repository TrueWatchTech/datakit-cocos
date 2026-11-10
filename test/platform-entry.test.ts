import { FT_COCOS_SDK_VERSION } from '../src/core/version';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { FTCocosPlatformSDK } from '../src/core/platform-client';
import { platformImplementation, type FTPlatformContext, type FTPlatformGlobal } from '../src/core/platform-runtime';

const hooks = { onSceneChanged: () => () => {}, onAction: () => () => {} };
function fixture(platform: FTPlatformContext['platform']) {
  const target: FTPlatformGlobal = {};
  const reflection = { callStaticMethod: vi.fn(() => '{"ok":true}') };
  const context: FTPlatformContext = { engine: 'creator3', platform, hooks, reflection, canvasIsPublic: () => true };
  const sdk = new FTCocosPlatformSDK('creator3', () => context, target);
  return { target, reflection, context, sdk };
}
function native(target: FTPlatformGlobal) {
  runInNewContext(readFileSync('packages/cocos/runtime/native.js', 'utf8'), { globalThis: target, console });
}
describe('unified engine entry', () => {
  it.each(['android', 'ios'] as const)('preserves native ownership and bridge dispatch on %s', platform => {
    const f = fixture(platform); native(f.target);
    f.sdk.start({ sdk: { datakitUrl: 'http://localhost' }, rum: { androidAppId: 'android-app', iosAppId: 'ios-app' } });
    f.sdk.mobile.bindUser('user'); f.sdk.rum.addAction('play'); f.sdk.shutdown();
    const calls = f.reflection.callStaticMethod.mock.calls as unknown as string[][];
    expect(calls.map(call => call[call.length - 2])).toEqual(['sdk.configure', 'rum.configure', 'sdk.bindUser', 'rum.addAction', 'sdk.shutdown']);
    expect(calls[0]![0]).toBe(platform === 'android' ? 'com/ft/sdk/cocos/FTCocosBridge' : 'FTCocosBridge');
    f.sdk.attach(); f.sdk.enterCocos({ viewName: 'Game' }); f.sdk.detach();
    expect(() => f.sdk.mobile.shutdown()).toThrow('native host');
  });
  it('shares the backend across imports and rejects incompatible extension engines', () => {
    const f = fixture('android'); native(f.target);
    const other = new FTCocosPlatformSDK('creator3', () => f.context, f.target);
    expect(f.sdk.rum).toBe(other.rum);
    const factory = vi.fn(() => ({ value: {}, lifecycle: {} }));
    expect(f.sdk.registerExtension('test', FT_COCOS_SDK_VERSION, 'creator3', factory)).toBe(other.registerExtension('test', FT_COCOS_SDK_VERSION, 'creator3', factory));
    expect(factory).toHaveBeenCalledOnce();
    expect(() => f.sdk.registerExtension('test', FT_COCOS_SDK_VERSION, 'creator2', factory)).toThrow('does not match');
  });
  it('never falls back to a native runtime when Web setup is missing', () => {
    const f = fixture('web'); native(f.target);
    expect(() => f.sdk.attach()).toThrow('installer with --web');
    expect(f.reflection.callStaticMethod).not.toHaveBeenCalled();
    expect(() => f.sdk.registerExtension('native-replay', '0.1.0', 'creator3', () => ({ value: {}, lifecycle: {} }))).toThrow('unavailable on Web');
  });
  it('checks runtime version and can retry after installing the missing factory', () => {
    const f = fixture('android');
    expect(() => { f.sdk.leaveCocos(); f.sdk.detach(); f.sdk.shutdown(); }).not.toThrow();
    expect(() => f.sdk.attach()).toThrow('Rerun the SDK installer');
    native(f.target); f.target.__FT_COCOS_NATIVE_FACTORY__!.version = '0.0.0';
    expect(() => f.sdk.attach()).toThrow('incompatible');
    native(f.target); f.sdk.attach(); f.sdk.detach();
    expect(platformImplementation(f.context, f.target).rum).toBe(f.sdk.rum);
  });
});
