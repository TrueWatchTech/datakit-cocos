import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const packageRoot = 'packages/cocos';

async function stageExtension(flavor) {
  const destination = `${packageRoot}/extensions/${flavor}`;
  await cp(`integrations/${flavor}`, destination, { recursive: true, filter: stageFilter });
  await cp('integrations/shared/install-native.cjs', `${destination}/install-native.cjs`);
  for (const file of ['project-configuration.cjs', 'install-web.cjs', 'install-spm.cjs', 'managed-assets.cjs', 'legacy-asset-hashes.json']) {
    await cp(`integrations/shared/${file}`, `${destination}/${file}`);
  }
}

function stageFilter(source) {
  return !source.split(/[\\/]/).some((segment) => segment === '.idea' || segment.endsWith('.iml'));
}

await mkdir(`${packageRoot}/bin`, { recursive: true });
await Promise.all([
  stageExtension('creator2'),
  stageExtension('creator3'),
  cp('native', `${packageRoot}/native`, { recursive: true, filter: stageFilter }),
  cp('integrations/shared/project-configuration.cjs', `${packageRoot}/bin/project-configuration.cjs`),
  cp('integrations/shared/web-assets.cjs', `${packageRoot}/bin/web-assets.cjs`),
  cp('installer/cli.cjs', `${packageRoot}/bin/cli.cjs`),
  cp('integrations/shared/managed-assets.cjs', `${packageRoot}/bin/managed-assets.cjs`),
  cp('integrations/shared/legacy-asset-hashes.json', `${packageRoot}/bin/legacy-asset-hashes.json`),
  cp('LICENSE', `${packageRoot}/LICENSE`),
  cp('THIRD_PARTY_NOTICES', `${packageRoot}/THIRD_PARTY_NOTICES`),
]);

await writeFile(`${packageRoot}/dist/creator3/package.json`, '{"type":"module"}\n');

const replayRoot = 'packages/cocos-session-replay';
await Promise.all([
  cp('src/session-replay/native', `${replayRoot}/native`, { recursive: true, filter: stageFilter }),
  cp('src/session-replay/components', `${replayRoot}/components`, { recursive: true, filter: stageFilter }),
  cp('LICENSE', `${replayRoot}/LICENSE`),
  cp('THIRD_PARTY_NOTICES', `${replayRoot}/THIRD_PARTY_NOTICES`),
]);
await writeFile(`${replayRoot}/dist/creator3/package.json`, '{"type":"module"}\n');

await build({ entryPoints: [`${packageRoot}/dist/creator2/web/bootstrap.js`], bundle: true, format: 'iife', globalName: 'CocosWebSDK', target: 'es5', outfile: `${packageRoot}/web/bootstrap.js`, sourcemap: true });

await mkdir(`${packageRoot}/runtime`, { recursive: true });
await build({ entryPoints: [`${packageRoot}/dist/creator2/native/bootstrap.js`], bundle: true, format: 'iife', target: 'es5', outfile: `${packageRoot}/runtime/native.js` });
await build({ entryPoints: [`${packageRoot}/dist/creator2/native/error-bootstrap.js`], bundle: true, format: 'iife', target: 'es5', outfile: `${packageRoot}/native/jsb-errors.js` });

// Load engine imports only when the native Replay factory is invoked. The Web game graph never imports this code.
await mkdir(`${replayRoot}/runtime`, { recursive: true });
for (const major of [2, 3]) {
  const result = await build({ entryPoints: [`${replayRoot}/dist/creator${major}/creator${major}/index.js`], bundle: true,
    format: 'cjs', external: ['cc', 'cc/env'], target: major === 2 ? 'es5' : 'es2018', write: false });
  const source = `(function(target) {
    target.__FT_COCOS_REPLAY_FACTORY__ = {
      protocol: 1, version: ${JSON.stringify(JSON.parse(await readFile(`${replayRoot}/package.json`, 'utf8')).version)}, engine: 'creator${major}',
      create: function(base, context) {
        var cc = context.engineApi;
        var module = { exports: {} }, exports = module.exports;
        var require = function(id) {
          if (id === 'cc') return context.engineApi;
          if (id === 'cc/env') return { NATIVE: context.platform === 'android' || context.platform === 'ios' };
          throw new Error('Unsupported Replay runtime import: ' + id);
        };
        ${result.outputFiles[0].text}
        return module.exports.withSessionReplay(base);
      }
    };
  })(typeof window !== 'undefined' ? window : globalThis);
`;
  await writeFile(`${replayRoot}/runtime/creator${major}.js`, source);
}
