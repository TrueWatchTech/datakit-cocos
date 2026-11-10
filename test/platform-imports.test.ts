import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FTPlatformGlobal } from '../src/core/platform-runtime';
import type { FTWebWindow } from '../src/web/types';
import { FT_COCOS_SDK_VERSION } from '../src/core/version';

vi.mock('cc', () => ({ native: {}, sys: {}, director: {}, Director: {}, Node: {}, Input: {}, input: {},
  Camera: {}, EditBox: {}, RenderTexture: {}, UITransform: {}, Vec3: {}, isValid: () => true, screen: {}, view: {} }));
const environment = vi.hoisted(() => ({ NATIVE: false, EDITOR: false }));
vi.mock('cc/env', () => environment);
afterEach(() => { environment.EDITOR = false; vi.unstubAllGlobals(); vi.resetModules(); });

describe('public and explicit Web imports', () => {
  it.each([[2, true], [2, false], [3, true], [3, false]] as const)('shares one Creator %i backend (explicit first: %s)', async (major, explicitFirst) => {
    vi.resetModules();
    const target: FTPlatformGlobal & FTWebWindow = {};
    vi.stubGlobal('window', target); vi.stubGlobal('cc', {}); vi.stubGlobal('CC_JSB', false);
    const { FTCocosWebSDK } = await import('../src/web/client');
    target.__FT_COCOS_WEB_FACTORY__ = {
      protocol: 1, version: FT_COCOS_SDK_VERSION,
      create: (context) => new FTCocosWebSDK(context.hooks, context.canvasIsPublic, target),
    };
    const common = () => major === 2 ? import('../src/creator2/index') : import('../src/creator3/index');
    const explicit = () => major === 2 ? import('../src/web/creator2') : import('../src/web/creator3');
    const first = explicitFirst ? (await explicit()).truewatchSdk : (await common()).truewatchSdk;
    const rum = first.rum;
    const second = explicitFirst ? (await common()).truewatchSdk : (await explicit()).truewatchSdk;
    expect(second.rum).toBe(rum); expect(second.mobile).toBe(first.mobile);
    expect(Object.keys(target.__FT_COCOS_INSTANCES__!)).toHaveLength(1);
  });
  it.each([2, 3])('keeps native Replay composition safe while Creator %i imports assets in the Editor', async major => {
    vi.resetModules(); environment.EDITOR = true;
    const target: FTPlatformGlobal = {};
    vi.stubGlobal('window', target); vi.stubGlobal('cc', {}); vi.stubGlobal('CC_EDITOR', true); vi.stubGlobal('CC_JSB', false);
    runInNewContext(readFileSync('packages/cocos/runtime/native.js', 'utf8'), { globalThis: target, console });
    const { truewatchSdk } = major === 2 ? await import('../src/creator2/index') : await import('../src/creator3/index');
    const { withSessionReplay } = major === 2 ? await import('../src/session-replay/creator2/index') : await import('../src/session-replay/creator3/index');
    const replay = withSessionReplay(truewatchSdk);
    expect(truewatchSdk.platform).toBe('unsupported');
    expect(replay.rum).toBe(truewatchSdk.rum);
  });
  it('can import in preview before configuration without initializing collectors', async () => {
    vi.resetModules(); vi.stubGlobal('window', {}); vi.stubGlobal('cc', {}); vi.stubGlobal('CC_JSB', false);
    const { truewatchSdk } = await import('../src/creator2/index');
    expect(truewatchSdk.engine).toBe('creator2');
    expect(() => truewatchSdk.attach()).toThrow('installer with --web');
  });
});
