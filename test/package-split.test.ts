import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTCocosSDK, type FTAutoTrackingController } from '../src/core/client';
import type { FTNativeTransport } from '../src/core/transport';
import { composeSessionReplay, type FTReplayCapture } from '../src/session-replay/core/client';
import { createReplayExtension } from './replay-fixtures';

const require = createRequire(import.meta.url);
const { installNative } = require('../integrations/shared/install-native.cjs');
const { readProject } = require('../integrations/shared/install-spm.cjs');
const roots: string[] = [];
const quiet = { info() {}, warn() {} };
afterEach(() => { vi.useRealTimers(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });

class Transport implements FTNativeTransport {
  readonly platform = 'android' as const;
  calls: string[] = [];
  fail: string | undefined;
  invoke<T>(method: string): T | undefined {
    this.calls.push(method);
    if (method === this.fail) throw new Error('native failure');
    if (method === 'replay.capabilities') return { protocol: 1 } as T;
    return undefined;
  }
}

function setup(tracking?: FTAutoTrackingController) {
  const transport = new Transport();
  const base = new FTCocosSDK(transport, tracking);
  const factory = vi.fn(() => ({
    transport,
    capture: {
      capture: async () => undefined,
      persist: async () => { throw new Error('No captured frame'); },
      disposeStoredFrame() {}, setPrivacy() {}, setCamera() {},
    } as FTReplayCapture,
    pointers: { onReplayPointer: () => () => {} },
  }));
  return { transport, base, factory, compose: () => composeSessionReplay(base, 'creator3', factory) };
}

describe('optional Replay lifecycle', () => {
  it('runs base-only lifecycle without touching Replay and rejects legacy JS configuration before side effects', () => {
    const { base, transport } = setup();
    expect(() => base.start({ sdk: { datakitUrl: 'http://localhost' }, replay: {} } as any)).toThrow('withSessionReplay');
    expect(() => base.attach({ replay: {} } as any)).toThrow('withSessionReplay');
    expect(transport.calls).toEqual([]);
    base.start({ sdk: { datakitUrl: 'http://localhost' }, rum: { androidAppId: 'app' } });
    base.shutdown();
    base.attach();
    base.enterCocos({ viewName: 'Game' });
    base.leaveCocos();
    expect(transport.calls).toEqual(['sdk.configure', 'rum.configure', 'sdk.shutdown', 'hybrid.attach']);
    expect('replay' in base).toBe(false);
  });

  it('composes once, shares modules, and validates engine/version before creating capture', () => {
    const f = setup();
    const sdk = f.compose();
    expect(f.compose()).toBe(sdk);
    expect(f.factory).toHaveBeenCalledTimes(1);
    expect(sdk.rum).toBe(f.base.rum);
    expect(f.transport.calls).toEqual([]);
    expect(() => composeSessionReplay(f.base, 'creator2', f.factory)).toThrow('does not match');
    expect(() => f.base.registerExtension('session-replay', '0.0.0', 'creator3', f.factory as any)).toThrow('does not match');
    const other = setup();
    other.base.attach();
    expect(other.compose).toThrow('before start() or attach()');
  });

  it('checks missing native Replay and invalid config before initializing the base', () => {
    const f = setup();
    const sdk = f.compose();
    f.transport.fail = 'replay.capabilities';
    expect(() => sdk.start({ sdk: { datakitUrl: 'http://localhost' }, replay: {} })).toThrow('--replay');
    expect(f.transport.calls).toEqual(['replay.capabilities']);
    f.transport.calls.length = 0;
    expect(() => sdk.start({ sdk: { datakitUrl: 'http://localhost' }, replay: { captureFps: 0 } })).toThrow('captureFps');
    expect(f.transport.calls).toEqual([]);
    expect(() => sdk.replay.start()).toThrow('--replay');
  });

  it('rolls back attachment and can retry without claiming the native SDK', () => {
    const f = setup();
    const sdk = f.compose();
    f.transport.fail = 'hybrid.attach';
    expect(() => sdk.attach({ replay: {} })).toThrow('native failure');
    f.transport.fail = undefined;
    sdk.start({ sdk: { datakitUrl: 'http://localhost' } });
    sdk.shutdown();
    expect(f.transport.calls).toContain('sdk.shutdown');
  });

  it('restores recorder ownership when tracking startup and its cleanup both throw', () => {
    vi.useFakeTimers();
    const f = setup({ start() { throw new Error('tracking start'); }, stop() { throw new Error('tracking stop'); } });
    const sdk = f.compose();
    sdk.attach({ replay: {} });
    expect(() => sdk.enterCocos({ viewName: 'Game' })).toThrow('tracking start');
    expect(f.transport.calls.filter(call => call === 'hybrid.setExternalRecorderActive')).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans Replay through the original base reference even if tracking cleanup fails', () => {
    vi.useFakeTimers();
    const f = setup({ start() {}, stop() { throw new Error('tracking stop'); } });
    const sdk = f.compose();
    sdk.start({ sdk: { datakitUrl: 'http://localhost' }, replay: {} });
    expect(vi.getTimerCount()).toBe(1);
    expect(() => f.base.shutdown()).toThrow('tracking stop');
    expect(vi.getTimerCount()).toBe(0);
    expect(f.transport.calls.slice(-2)).toEqual(['replay.stop', 'sdk.shutdown']);
  });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), 'cocos-package-split-'));
  roots.push(root);
  const build = join(root, 'build');
  mkdirSync(join(build, 'android', 'app'), { recursive: true });
  const gradle = join(build, 'android', 'app', 'build.gradle');
  writeFileSync(gradle, "plugins { id 'com.android.application' }\n");
  const pod = join(build, 'Podfile');
  writeFileSync(pod, "target 'Smoke-mobile' do\npod 'HostOwnedDependency'\nend\n");
  const entry = join(build, 'Game.cpp');
  writeFileSync(entry, 'void start() { BaseGame::init(); }\n');
  return { root, build, gradle, pod, entry };
}

describe('optional native Replay integration', () => {
  it('removes managed Replay dependencies, workers and dispatch without deleting host-owned assets', () => {
    const f = project();
    const ext = createReplayExtension(f.root);
    installNative(f.build, ext, quiet);
    const replayJava = join(f.build, 'cocos-sdk-native/replay/android/src/main/java/com/ft/sdk/cocos/FTCocosReplayBridge.java');
    expect(existsSync(replayJava)).toBe(true);
    expect(readFileSync(f.gradle, 'utf8')).toContain('ft-session-replay:');
    expect(readFileSync(f.pod, 'utf8')).toContain("pod 'FTCocosReplayBridge'");
    const hostFile = join(f.build, 'cocos-sdk-native', 'HostOwned.txt');
    writeFileSync(hostFile, 'host file');
    rmSync(join(ext, 'replay-integration.json'));
    writeFileSync(join(ext, 'sdk-integration.json'), JSON.stringify({ replay: false }));
    installNative(f.build, ext, quiet);
    installNative(f.build, ext, quiet);
    expect(existsSync(replayJava)).toBe(false);
    expect(existsSync(join(f.build, 'cocos-sdk-replay', 'FTReplayFileWorker.h'))).toBe(false);
    expect(readFileSync(f.entry, 'utf8')).not.toContain('installReplayFileBridge');
    expect(readFileSync(f.gradle, 'utf8')).not.toContain('ft-session-replay:');
    expect(readFileSync(f.gradle, 'utf8')).toContain('ft-native:');
    expect(readFileSync(f.pod, 'utf8')).not.toContain("pod 'FTCocosReplayBridge'");
    expect(readFileSync(f.pod, 'utf8')).toContain("pod 'HostOwnedDependency'");
    expect(readFileSync(hostFile, 'utf8')).toBe('host file');
    const dispatch = readFileSync(join(f.build, 'cocos-sdk-native/android/src/main/java/com/ft/sdk/cocos/FTCocosBridgeModules.java'), 'utf8');
    expect(dispatch).not.toContain('FTCocosReplayBridge');
    createReplayExtension(f.root);
    installNative(f.build, ext, quiet);
    expect(existsSync(replayJava)).toBe(true);
  });

  it('rejects stale modified Replay workers from a pre-manifest installation', () => {
    const f = project();
    const oldWorker = join(f.build, 'cocos-sdk-native/android/src/main/java/com/ft/sdk/cocos/FTCocosReplayImageJobs.java');
    mkdirSync(join(oldWorker, '..'), { recursive: true });
    writeFileSync(oldWorker, 'locally modified legacy worker');
    expect(() => installNative(f.build, resolve('.'), quiet)).toThrow('modified legacy Replay asset');
    expect(readFileSync(oldWorker, 'utf8')).toBe('locally modified legacy worker');
  });

  it('refuses to overwrite a modified native bridge and leaves other managed files untouched', () => {
    const f = project();
    installNative(f.build, resolve('.'), quiet);
    const bridge = join(f.build, 'cocos-sdk-native', 'ios', 'FTCocosBridge.m');
    writeFileSync(bridge, 'custom native change');
    const before = readFileSync(f.gradle, 'utf8');
    expect(() => installNative(f.build, resolve('.'), quiet)).toThrow('modified SDK asset');
    expect(readFileSync(bridge, 'utf8')).toBe('custom native change');
    expect(readFileSync(f.gradle, 'utf8')).toBe(before);
  });

  it.skipIf(process.platform !== 'darwin')('links separate SPM products and removes only the Replay product', () => {
    const f = project();
    cpSync(resolve('test/fixtures/ios-spm'), f.build, { recursive: true });
    writeFileSync(join(f.root, 'cocos-sdk.config.json'), '{"ios":{"dependencyManager":"spm"}}');
    const ext = createReplayExtension(f.root);
    installNative(f.build, ext, quiet);
    const pbx = join(f.build, 'Smoke.xcodeproj/project.pbxproj');
    const products = () => Object.values(readProject(pbx).objects).filter((o: any) => o.isa === 'XCSwiftPackageProductDependency').map((o: any) => o.productName).sort();
    expect(products()).toEqual(['FTCocosBridge', 'FTCocosReplayBridge']);
    rmSync(join(ext, 'replay-integration.json'));
    writeFileSync(join(ext, 'sdk-integration.json'), '{"replay":false}');
    installNative(f.build, ext, quiet);
    expect(products()).toEqual(['FTCocosBridge']);
  });
});
