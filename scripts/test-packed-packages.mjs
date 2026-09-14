import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
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

try {
  const tarballs = [];
  const manifests = [];
  for (const directory of ['cocos', 'cocos-session-replay']) {
    const manifest = JSON.parse(readFileSync(path.join(root, 'packages', directory, 'package.json'), 'utf8'));
    manifests.push(manifest);
    const spec = published ? [`${manifest.name}@${manifest.version}`, '--registry', registry] : ['--workspace', manifest.name];
    const [packed] = JSON.parse(run(npm, ['pack', ...spec, '--json', '--ignore-scripts', '--pack-destination', temporary], published ? temporary : root));
    validatePackedPackage(packed, manifest, directory !== 'cocos');
    tarballs.push(path.join(temporary, packed.filename));
    console.log(`${manifest.name}: ${packed.entryCount} files, ${packed.size} compressed bytes.`);
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
    const cli = path.join(installed, 'bin/cli.cjs');
    if (!enabled) {
      assert.throws(() => run(process.execPath, [cli, 'install', '--project', consumer, '--creator', String(creator), '--replay']), /Session Replay is not installed/);
    }
    run(process.execPath, [cli, 'install', '--project', consumer, '--creator', String(creator), enabled ? '--replay' : '--no-replay']);
    run(process.execPath, [cli, 'install', '--project', consumer, '--creator', String(creator)]);
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
    writeFileSync(path.join(ccRoot, 'env.js'), 'export const NATIVE = false;');
    writeFileSync(path.join(ccRoot, 'index.js'), 'export const Camera={},Director={},EditBox={},Node={},RenderTexture={},UITransform={},Vec3={},director={},isValid=()=>true,native={},sys={},view={},Input={},input={};');
    const sample = `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { truewatchSdk as sdk3 } from '@truewatchtech/cocos-sdk/creator3';
const require = createRequire(import.meta.url);
const { truewatchSdk: sdk2 } = require('@truewatchtech/cocos-sdk/creator2');
assert.equal('replay' in sdk2, false);
assert.equal('replay' in sdk3, false);
assert.throws(() => sdk2.start({ sdk: {}, replay: {} }), /withSessionReplay/);
${enabled ? `
const { withSessionReplay: withReplay2 } = require('@truewatchtech/cocos-session-replay/creator2');
const { withSessionReplay: withReplay3 } = await import('@truewatchtech/cocos-session-replay/creator3');
const replay2 = withReplay2(sdk2);
const replay3 = withReplay3(sdk3);
assert.equal(replay2.rum, sdk2.rum);
assert.equal(replay3.rum, sdk3.rum);
assert.equal(withReplay2(sdk2), replay2);
assert.equal(typeof replay3.setReplayCamera, 'function');
assert.throws(() => withReplay3(sdk2), /does not match/);
` : `assert.throws(() => require.resolve('@truewatchtech/cocos-session-replay/creator2'), /Cannot find module/);`}
`;
    writeFileSync(path.join(consumer, 'smoke.mjs'), sample);
    run(process.execPath, ['smoke.mjs'], consumer);
    for (const [engine, suffix] of [['creator2', 'cts'], ['creator3', 'mts']]) {
      writeFileSync(path.join(consumer, `types.${suffix}`), `
import { truewatchSdk } from '@truewatchtech/cocos-sdk/${engine}';
// @ts-expect-error The base SDK must not expose Replay.
truewatchSdk.replay;
// @ts-expect-error Replay configuration requires the optional facade.
truewatchSdk.attach({ replay: {} });
${enabled ? `import { withSessionReplay } from '@truewatchtech/cocos-session-replay/${engine}';
const sdk = withSessionReplay(truewatchSdk);
sdk.attach({ replay: { captureFps: 2, touchPrivacy: 'hide' } });
sdk.setReplayCamera({});
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
