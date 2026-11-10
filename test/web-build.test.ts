import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { installWeb, isWebBuild, readWebConfig } = require('../integrations/shared/install-web.cjs');
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'cocos-web-build-')); roots.push(root);
  const extension = join(root, 'packages/sdk'); const output = join(root, 'build/web-mobile');
  mkdirSync(join(extension, 'web'), { recursive: true }); mkdirSync(output, { recursive: true });
  for (const file of ['rum.js', 'logs.js', 'webgl.js', 'bootstrap.js']) writeFileSync(join(extension, 'web', file), '/* fixture */');
  const config = { web: { enabled: true, configuration: { web: { applicationId: 'test', datakitOrigin: 'http://localhost', replay: { enabled: true } }, rum: {}, logger: {} } } };
  writeFileSync(join(root, 'cocos-sdk.config.json'), JSON.stringify(config));
  writeFileSync(join(output, 'index.html'), '<html><head><script src="engine.js"></script></head><body></body></html>');
  return { root, extension, output, config };
}
describe('Web build isolation and bootstrap', () => {
  it('injects local bundles before the engine and preserves source maps and user files', () => {
    const f = setup(); writeFileSync(join(f.output, 'game.js.map'), '{"version":3}');
    installWeb(f.output, f.extension); const first = readFileSync(join(f.output, 'index.html'), 'utf8');
    installWeb(f.output, f.extension);
    expect(readFileSync(join(f.output, 'index.html'), 'utf8').replace(/\s+/g, '')).toBe(first.replace(/\s+/g, ''));
    expect(first.indexOf('initialize.js')).toBeLessThan(first.indexOf('engine.js'));
    expect(first.indexOf('webgl.js')).toBeLessThan(first.indexOf('initialize.js'));
    expect(readFileSync(join(f.output, 'game.js.map'), 'utf8')).toBe('{"version":3}');
    expect(readFileSync(join(f.output, 'cocos-sdk-web/initialize.js'), 'utf8')).toContain('CocosWebSDK.bootstrapWeb(');
  });
  it('removes only managed bootstrap assets when Web integration is disabled', () => {
    const f = setup(); installWeb(f.output, f.extension);
    writeFileSync(join(f.output, 'cocos-sdk-web/user.txt'), 'keep');
    f.config.web.enabled = false;
    writeFileSync(join(f.root, 'cocos-sdk.config.json'), JSON.stringify(f.config));
    installWeb(f.output, f.extension);
    expect(readFileSync(join(f.output, 'index.html'), 'utf8')).not.toContain('initialize.js');
    expect(readFileSync(join(f.output, 'cocos-sdk-web/user.txt'), 'utf8')).toBe('keep');
  });
  it('ships self-contained Creator 2 source maps without changing the consumer build setting', () => {
    const map = JSON.parse(readFileSync('packages/cocos/dist/creator2/web/client.js.map', 'utf8'));
    expect(map.sourcesContent[0]).toContain('class FTCocosWebSDK');
  });
  it('validates configuration before writing and only handles Web Mobile/Desktop', () => {
    const f = setup(); rmSync(join(f.extension, 'web/webgl.js'));
    expect(() => readWebConfig(f.extension)).toThrow('rerun the installer');
    expect(isWebBuild({ platform: 'android' })).toBe(false); expect(isWebBuild({ platform: 'web-desktop' })).toBe(true);
    const original = readFileSync(join(f.output, 'index.html'), 'utf8');
    expect(() => installWeb(f.output, f.extension)).toThrow();
    expect(readFileSync(join(f.output, 'index.html'), 'utf8')).toBe(original);
  });
  it.each([2, 3])('keeps implementations out of Creator %i default imports and native code out of explicit Web imports', async major => {
    for (const entry of [`creator${major}/index`, `web/creator${major}`]) {
      const result = await build({ entryPoints: [resolve(`packages/cocos/dist/creator${major}/${entry}.js`)], bundle: true,
        write: false, metafile: true, external: ['cc', 'cc/env'], platform: 'browser' });
      const files = Object.keys(result.metafile!.inputs).join('\n');
      expect(files).not.toMatch(/creator[23]\/transport|\/native\/|session-replay|node_modules\/@truewatchtech\/browser/);
      expect(result.outputFiles![0]!.text).not.toContain('FTCocosBridge');
      if (entry.endsWith('/index')) {
        expect(files).not.toMatch(/core\/client|web\/(client|runtime)/);
      }
    }
  });
});
