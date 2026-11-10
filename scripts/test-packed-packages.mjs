import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePackedPackage } from './publish-npm-token.mjs';

const require = createRequire(import.meta.url);
const published = process.argv.includes('--published');
const keep = process.argv.includes('--keep');
const registry = 'https://registry.npmjs.org';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'cocos-packed-consumer-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, cwd = root) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, npm_config_cache: path.join(temporary, 'cache') }, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`${command} failed:\n${String(error.stdout || '').slice(-4000)}\n${String(error.stderr || '').slice(-4000)}`);
  }
}

function checkCreator2SourceMaps(packageRoot) {
  let count = 0;
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.js.map')) {
        const map = JSON.parse(readFileSync(file, 'utf8'));
        // Creator 2.4.9 refine-sourcemap reads consumer.sourcesContent[0]
        // without a null check, so every published JS map must embed its sources.
        assert.ok(map.sources.length > 0, `${file}: missing sources`);
        assert.ok(Array.isArray(map.sourcesContent), `${file}: missing sourcesContent`);
        assert.equal(map.sourcesContent.length, map.sources.length, `${file}: incomplete sourcesContent`);
        for (const source of map.sourcesContent) {
          assert.ok(typeof source === 'string' && source.trim().length > 0, `${file}: empty source content`);
        }
        count++;
      }
    }
  }
  visit(path.join(packageRoot, 'dist/creator2'));
  assert.ok(count > 0, `${packageRoot}: no Creator 2 source maps`);
  console.log(`${path.basename(packageRoot)}: ${count} Creator 2 source maps embed source content.`);
}

try {
  const tarballs = [];
  const manifests = [];
  for (const directory of ['cocos', 'cocos-session-replay']) {
    const manifest = JSON.parse(readFileSync(path.join(root, 'packages', directory, 'package.json'), 'utf8'));
    manifests.push(manifest);
    const spec = published ? [`${manifest.name}@${manifest.version}`, '--registry', registry] : ['--workspace', manifest.name];
    const [packed] = JSON.parse(run(npm, ['pack', ...spec, '--json', '--ignore-scripts', '--pack-destination', temporary], published ? temporary : root));
    validatePackedPackage(packed, manifest, directory !== 'cocos');
    if (directory === 'cocos-session-replay') {
      assert.ok(packed.files.some(entry => entry.path === 'native/shared/FTReplayParticleBounds.h'));
    }
    if (directory === 'cocos') {
      for (const file of ['web/bootstrap.js', 'web/bootstrap.js.map', 'runtime/native.js', 'native/jsb-errors.js', 'bin/web-assets.cjs',
        'extensions/creator2/install-web.cjs', 'extensions/creator3/install-web.cjs',
        'web/creator2/package.json', 'web/creator3/package.json',
        'dist/creator2/web/creator2.js', 'dist/creator3/web/creator3.js']) {
        assert.ok(packed.files.some(entry => entry.path === file), `Missing packed Web integration asset: ${file}`);
      }
    }
    tarballs.push(path.join(temporary, packed.filename));
    console.log(`${manifest.name}: ${packed.entryCount} files, ${packed.size} compressed bytes.`);
  }
  if (!published) {
    // An empty offline cache proves that local consumers cannot silently use
    // a workspace or registry peer. Published mode intentionally resolves it.
    const wrongBase = path.join(temporary, 'wrong-base');
    mkdirSync(wrongBase);
    writeFileSync(path.join(wrongBase, 'package.json'), JSON.stringify({ name: manifests[0].name, version: '0.0.0' }));
    const [wrongPacked] = JSON.parse(run(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], wrongBase));
    for (const conflict of [false, true]) {
      const consumer = path.join(temporary, conflict ? 'conflicting-peer' : 'missing-peer');
      mkdirSync(consumer);
      writeFileSync(path.join(consumer, 'package.json'), '{"name":"negative-peer-consumer","private":true}');
      const specs = conflict ? [path.join(temporary, wrongPacked.filename), tarballs[1]] : [tarballs[1]];
      assert.throws(() => run(npm, ['install', '--offline', '--strict-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund',
        '--package-lock=false', '--cache', path.join(consumer, 'empty-cache'), ...specs], consumer), error => {
        assert.match(error.message, conflict ? /ERESOLVE/ : /ENOTCACHED/);
        assert.ok(error.message.includes(manifests[0].name));
        return true;
      });
      assert.equal(existsSync(path.join(consumer, 'node_modules', manifests[1].name)), false);
    }
    console.log('Local missing/conflicting exact-peer installs failed as expected without registry access.');
  }
  for (const creator of [2, 3]) for (const enabled of [false, true]) {
    const consumer = path.join(temporary, `creator${creator}-${enabled ? 'replay' : 'base'}`);
    mkdirSync(path.join(consumer, 'assets'), { recursive: true });
    writeFileSync(path.join(consumer, 'package.json'), '{"name":"packed-consumer","private":true}');
    // Installing Replay alone must resolve its exact base peer from the public registry.
    const install = published
      ? ['--registry', registry, `${manifests[enabled ? 1 : 0].name}@${manifests[enabled ? 1 : 0].version}`]
      : ['--offline', ...tarballs.slice(0, enabled ? 2 : 1)];
    run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', ...install], consumer);
    const installed = path.join(consumer, 'node_modules/@truewatchtech/cocos-sdk');
    assert.equal(JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8')).version, manifests[0].version);
    if (creator === 2) {
      checkCreator2SourceMaps(installed);
      if (enabled) checkCreator2SourceMaps(path.join(consumer, 'node_modules/@truewatchtech/cocos-session-replay'));
    }
    const cli = path.join(installed, 'bin/cli.cjs');
    // Exercise the installed CLI's preflight, including recovery, rather than
    // inferring compatibility from the source manifests alone.
    if (enabled) {
      const replayRoot = path.join(consumer, 'node_modules/@truewatchtech/cocos-session-replay');
      const faults = [
        ['package.json', value => { value.version = '0.0.0-invalid'; }],
        ['package.json', value => { value.peerDependencies[manifests[0].name] = `^${manifests[0].version}`; }],
        ['native-integration.json', value => { value.baseVersion = '0.0.0-invalid'; }],
        ['native-integration.json', value => { value.schemaVersion = 999; }],
      ];
      for (const [file, corrupt] of faults) {
        const target = path.join(replayRoot, file);
        const original = readFileSync(target, 'utf8');
        const value = JSON.parse(original);
        corrupt(value);
        writeFileSync(target, JSON.stringify(value));
        try {
          assert.throws(() => run(process.execPath, [cli, 'install', '--project', consumer, '--creator', String(creator), '--replay']), /must exactly match/);
          assert.deepEqual(readdirSync(path.join(consumer, 'assets')), [], 'Failed preflight wrote runtime or component assets');
          assert.equal(existsSync(path.join(consumer, creator === 2 ? 'packages' : 'extensions')), false);
          assert.equal(existsSync(path.join(consumer, 'cocos-sdk.config.json')), false);
        } finally {
          writeFileSync(target, original);
        }
      }
    }
    if (!enabled) {
      assert.throws(() => run(process.execPath, [cli, 'install', '--project', consumer, '--creator', String(creator), '--replay']), /Session Replay is not installed/);
    }
    run(process.execPath, [cli, 'install', '--project', consumer, '--creator', String(creator), enabled ? '--replay' : '--no-replay']);
    run(process.execPath, [cli, 'install', '--project', consumer, '--creator', String(creator)]);
    {
      const meta = JSON.parse(readFileSync(path.join(consumer, 'assets/truewatch-cocos-sdk-runtime/native.js.meta'), 'utf8'));
      const flags = creator === 2 ? meta : meta.userData;
      assert.equal(flags.isPlugin, true);
      assert.equal(flags.loadPluginInWeb, false);
      assert.equal(flags.loadPluginInNative, true);
      assert.equal(flags.loadPluginInEditor, true);
      if (creator === 3) assert.equal(flags.loadPluginInMiniGame, false);
      const metaFile = path.join(consumer, 'assets/truewatch-cocos-sdk-runtime/native.js.meta');
      meta.uuid = 'keep-runtime-asset-reference';
      meta.ver = creator === 2 ? '1.1.0' : '4.0.24';
      const upgraded = JSON.stringify(meta);
      writeFileSync(metaFile, upgraded);
      run(process.execPath, [cli, 'install', '--project', consumer, '--creator', String(creator)]);
      assert.equal(readFileSync(metaFile, 'utf8'), upgraded);
      flags.loadPluginInWeb = true;
      writeFileSync(metaFile, JSON.stringify(meta));
      assert.throws(() => run(process.execPath, [cli, 'install', '--project', consumer, '--creator', String(creator)]), /loaded only on native platforms/);
      writeFileSync(metaFile, upgraded);
    }
    const extension = path.join(consumer, creator === 2 ? 'packages' : 'extensions', 'truewatch-cocos-sdk');
    const { installNative } = require(path.join(extension, 'install-native.cjs'));
    const build = path.join(consumer, 'build');
    mkdirSync(path.join(build, 'android/app'), { recursive: true });
    const gradle = path.join(build, 'android/app/build.gradle');
    const podfile = path.join(build, 'Podfile');
    writeFileSync(gradle, "plugins { id 'com.android.application' }\n");
    writeFileSync(podfile, "target 'Smoke-mobile' do\npod 'HostOwnedDependency'\nend\n");
    writeFileSync(path.join(build, 'Game.cpp'), 'void start() { BaseGame::init(); }\n');
    const quiet = { info() {}, warn() {} };
    installNative(build, extension, quiet);
    installNative(build, extension, quiet);
    const nativeReplay = path.join(build, 'cocos-sdk-native/replay/android/src/main/java/com/ft/sdk/cocos/FTCocosReplayBridge.java');
    const checkNative = expected => {
      assert.equal(existsSync(nativeReplay), expected);
      for (const directory of ['cocos-sdk-native/replay/shared', 'cocos-sdk-replay']) {
        assert.equal(existsSync(path.join(build, directory, 'FTReplayParticleBounds.h')), expected);
      }
      assert.equal(readFileSync(gradle, 'utf8').includes('ft-session-replay:'), expected);
      assert.equal(readFileSync(podfile, 'utf8').includes("pod 'FTCocosReplayBridge'"), expected);
      assert.ok(readFileSync(podfile, 'utf8').includes("pod 'HostOwnedDependency'"));
      const dispatch = readFileSync(path.join(build, 'cocos-sdk-native/android/src/main/java/com/ft/sdk/cocos/FTCocosBridgeModules.java'), 'utf8');
      assert.equal(dispatch.includes('FTCocosReplayBridge'), expected);
    };
    checkNative(enabled);
    const ccRoot = path.join(consumer, 'node_modules/cc');
    mkdirSync(ccRoot, { recursive: true });
    writeFileSync(path.join(ccRoot, 'package.json'), JSON.stringify({ name: 'cc', type: 'module', exports: { '.': './index.js', './env': './env.js' } }));
    writeFileSync(path.join(ccRoot, 'env.js'), 'export const NATIVE = true, EDITOR = false;');
    writeFileSync(path.join(ccRoot, 'index.js'), `export const Camera={},Director={},EditBox={},Node={},RenderTexture={},UITransform={},Vec3={},director={},isValid=()=>true,native={},screen={},sys={os:'test',OS:{ANDROID:'android',IOS:'ios'}},view={},Input={},input={};`);
    const sample = `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { truewatchSdk as sdk3 } from '@truewatchtech/cocos-sdk/creator3';
const require = createRequire(import.meta.url);
const { truewatchSdk: sdk2 } = require('@truewatchtech/cocos-sdk/creator2');
globalThis.CC_JSB = true; globalThis.cc = { sys: { os: 'test', OS_ANDROID: 'android', OS_IOS: 'ios' } };
require('./assets/truewatch-cocos-sdk-runtime/native.js');
assert.equal('replay' in sdk2, true);
assert.equal('replay' in sdk3, true);
assert.equal(typeof sdk2.detach, 'function');
assert.equal(typeof sdk3.detach, 'function');
assert.throws(() => sdk2.replay.start(), /Start or attach/);
assert.throws(() => sdk3.replay.start(), /Start or attach/);
${enabled ? `
const { withSessionReplay: withReplay2 } = require('@truewatchtech/cocos-session-replay/creator2');
const { withSessionReplay: withReplay3 } = await import('@truewatchtech/cocos-session-replay/creator3');
const replay2 = withReplay2(sdk2);
const replay3 = withReplay3(sdk3);
assert.equal(replay2.rum, sdk2.rum);
assert.equal(replay3.rum, sdk3.rum);
assert.equal(withReplay2(sdk2), replay2);
assert.equal(typeof replay3.setReplayCamera, 'function');
assert.equal(typeof replay2.detach, 'function');
assert.equal(typeof replay3.detach, 'function');
assert.throws(() => withReplay3(sdk2), /does not match/);
` : `assert.throws(() => require.resolve('@truewatchtech/cocos-session-replay/creator2'), /Cannot find module/);`}
`;
    writeFileSync(path.join(consumer, 'smoke.mjs'), sample);
    run(process.execPath, ['smoke.mjs'], consumer);
    for (const [engine, suffix] of [['creator2', 'cts'], ['creator3', 'mts']]) {
      writeFileSync(path.join(consumer, `types.${suffix}`), `
import { truewatchSdk } from '@truewatchtech/cocos-sdk/${engine}';
truewatchSdk.detach();
truewatchSdk.replay;
truewatchSdk.replay.start(); truewatchSdk.replay.stop(); truewatchSdk.stop();
// @ts-expect-error Replay configuration requires the optional facade.
truewatchSdk.attach({ replay: {} });
${enabled ? `import { withSessionReplay } from '@truewatchtech/cocos-session-replay/${engine}';
const sdk = withSessionReplay(truewatchSdk);
sdk.attach({ replay: { captureFps: 2, touchPrivacy: 'hide' } });
sdk.setReplayCamera({});
sdk.detach();
sdk.replay.setPrivacy({}, 'mask');` : ''}
`);
    }
    run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext',
      '--moduleResolution', 'NodeNext', '--target', 'ES2020', 'types.cts', 'types.mts'], consumer);
    if (enabled) {
      const component = path.join(consumer, 'assets/truewatch-cocos-sdk/ReplayPrivacy.ts');
      const metadata = `${component}.meta`;
      writeFileSync(metadata, '{"uuid":"keep-scene-reference"}');
      run(process.execPath, [cli, 'install', '--creator', String(creator), '--no-replay'], consumer);
      assert.equal(readFileSync(metadata, 'utf8'), '{"uuid":"keep-scene-reference"}');
      assert.ok(readFileSync(component, 'utf8').includes('ReplayPrivacy'));
      installNative(build, extension, quiet);
      checkNative(false);
      run(process.execPath, [cli, 'install', '--creator', String(creator), '--replay'], consumer);
      installNative(build, extension, quiet);
      checkNative(true);
      assert.equal(readFileSync(metadata, 'utf8'), '{"uuid":"keep-scene-reference"}');
    }
    console.log(`Creator ${creator} ${enabled ? 'Replay' : 'base-only'} ${published ? 'npm' : 'packed'} consumer: entrypoints, declarations, installer and native enable/disable integration passed.`);
  }
} finally {
  if (keep) console.log(`Integration fixtures retained at ${temporary}`);
  else rmSync(temporary, { recursive: true, force: true });
}
