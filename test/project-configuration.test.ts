import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { resolveNativeConfiguration, resolveWebConfiguration, configureNativeBuild } = require('../integrations/shared/project-configuration.cjs');
function config() {
  return { configuration: { sdk: { datakitUrl: 'https://native.example', serviceName: 'game' },
    rum: { androidAppId: 'android-secret', iosAppId: 'ios-secret', sessionSamplingRate: 80 }, autoTrack: { scenes: true } },
    web: { enabled: true, configuration: { web: { applicationId: 'web-app', datakitOrigin: 'https://web.example' } } },
    replay: { enabled: true, sessionReplaySamplingRate: 25, native: { captureFps: 2, imagePolicy: { quality: 'medium' } },
      web: { captureFps: 5, quality: 0.6, maxFrameBytes: 65536, canvasPrivacy: 'allow' } } };
}
describe('one project configuration for all platforms', () => {
  it('selects native/Web settings without leaking native identities and endpoints into Web', () => {
    const project = config();
    expect(resolveNativeConfiguration(project)).toMatchObject({ sdk: { datakitUrl: 'https://native.example' }, replay: { sessionReplaySamplingRate: 25, captureFps: 2, imagePolicy: { quality: 'medium' } } });
    const web = resolveWebConfiguration(project);
    expect(web).toMatchObject({ sdk: { serviceName: 'game' }, rum: { sessionSamplingRate: 80 }, autoTrack: { scenes: true },
      web: { applicationId: 'web-app', replay: { enabled: true, sessionReplaySamplingRate: 25, captureFps: 5, quality: 0.6, maxFrameBytes: 65536 } } });
    expect(JSON.stringify(web)).not.toMatch(/native.example|android-secret|ios-secret|imagePolicy/);
  });
  it('keeps native WebView configuration out of Browser configuration', () => {
    const project = {
      configuration: {
        sdk: { datakitUrl: 'https://native.example', allowWebViewHost: [] },
        rum: { androidAppId: 'app', enableTraceWebView: false },
        logger: { enableWebViewLog: true },
      },
      web: { enabled: true, configuration: { web: { applicationId: 'web-app' } } },
    };
    expect(resolveNativeConfiguration(project)).toEqual(project.configuration);
    const web = resolveWebConfiguration(project);
    expect(web.sdk).not.toHaveProperty('allowWebViewHost');
    expect(web.rum).not.toHaveProperty('enableTraceWebView');
    expect(web.logger).not.toHaveProperty('enableWebViewLog');
  });
  it('supports global disable and an explicit platform opt-out', () => {
    const project: any = config(); project.replay.native = false;
    expect(resolveNativeConfiguration(project).replay).toBeUndefined();
    expect(resolveWebConfiguration(project).web.replay).toBeDefined();
    project.replay.enabled = false;
    expect(resolveWebConfiguration(project).web.replay).toBeUndefined();
  });
  it.each([
    ['native', { captureFps: 6 }], ['native', { imagePolicy: { quality: 'ultra' } }],
    ['web', { captureFps: 0 }], ['web', { quality: 1.1 }], ['web', { maxFrameBytes: 0 }],
    ['web', { imagePolicy: { quality: 'medium' } }], ['web', { canvasPrivacy: 'mask' }],
  ])('rejects invalid or unsupported %s Replay settings', (platform, options) => {
    const project: any = config(); project.replay[platform as string] = options;
    expect(() => resolveWebConfiguration(project)).toThrow();
  });
  it('rejects duplicate Replay configuration and preserves the legacy Web path', () => {
    const project: any = config(); project.web.configuration.web.replay = { enabled: true };
    expect(() => resolveWebConfiguration(project)).toThrow('Configure Replay once');
    const legacy = { web: project.web };
    expect(resolveWebConfiguration(legacy)).toEqual(project.web.configuration);
  });
  it('refreshes native build settings without reinstalling or rewriting project sources', () => {
    const root = mkdtempSync(join(tmpdir(), 'cocos-unified-config-'));
    try {
      const ext = join(root, 'extensions/sdk'); const out = join(root, 'build/native/data/assets/runtime');
      mkdirSync(ext, { recursive: true }); mkdirSync(out, { recursive: true });
      const runtime = join(out, 'native.js');
      writeFileSync(runtime, 'globalThis.__FT_COCOS_NATIVE_FACTORY__ = {}; globalThis.__FT_COCOS_REPLAY_FACTORY__ = {};');
      const project = config(); const file = join(root, 'cocos-sdk.config.json');
      writeFileSync(file, JSON.stringify(project)); configureNativeBuild(join(root, 'build/native'), ext);
      project.replay.native.captureFps = 4;
      writeFileSync(file, JSON.stringify(project)); configureNativeBuild(join(root, 'build/native'), ext);
      const source = readFileSync(runtime, 'utf8'); const target: any = {};
      runInNewContext(source, { globalThis: target });
      expect(target.__FT_COCOS_CONFIGURATION__.replay.captureFps).toBe(4);
      expect(source.match(/COCOS_PROJECT_CONFIGURATION_BEGIN/g)).toHaveLength(1);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(project);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
