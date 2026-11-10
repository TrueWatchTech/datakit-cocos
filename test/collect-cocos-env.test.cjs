'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { collect, parseArgs, parseNative } = require('../scripts/collect-cocos-env.cjs');
const script = path.resolve(__dirname, '../scripts/collect-cocos-env.cjs');
// Exercise the same CLI flow with terminal detection enabled, using deterministic input pipes.
const interactiveBootstrap = 'Object.defineProperty(process.stdin, "isTTY", {value: true});'
  + 'require(process.argv[1]).main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-env-test-'));
  const project = path.join(directory, 'project');
  fs.mkdirSync(path.join(project, 'assets'), { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (file, value) => {
    const full = path.join(project, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value));
    return full;
  };
  const run = (...args) => spawnSync(process.execPath, [script, '--project', project, '--no-tools', ...args],
    { cwd: directory, encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024 });
  const runInteractive = (input, ...args) => spawnSync(process.execPath,
    ['-e', interactiveBootstrap, script, '--project', project, '--no-tools', ...args],
    { cwd: directory, input, encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024 });
  const runStdin = (input, ...args) => spawnSync(process.execPath, ['-', ...args],
    { cwd: directory, input, encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024 });
  return { directory, project, write, run, runInteractive, runStdin,
    collect: options => collect({ project, tools: false, ...options }) };
}

test('keeps declared, locked and installed SDK versions separate without executing package code', t => {
  const f = fixture(t);
  f.write('package.json', { creator: { version: '3.8.8' }, dependencies: { '@cloudcare/cocos-sdk': '^0.1.0',
    '@cloudcare/cocos-session-replay': 'file:/private/customer-secret' }, scripts: { postinstall: 'DO-NOT-EXECUTE' } });
  f.write('package-lock.json', { packages: { 'node_modules/@cloudcare/cocos-sdk': { version: '0.1.0' },
    'node_modules/@cloudcare/cocos-session-replay': { link: true, resolved: '../replay' }, '../replay': { version: '0.1.0' } } });
  f.write('node_modules/@cloudcare/cocos-sdk/package.json', { version: '0.1.1-alpha.2', main: 'index.js' });
  f.write('node_modules/@cloudcare/cocos-sdk/index.js', 'throw new Error("Do not execute project modules");');
  f.write('node_modules/@cloudcare/cocos-session-replay/package.json', { version: '0.1.0' });
  f.write('extensions/guance-cocos-sdk/sdk-integration.json', { version: '0.1.0', replay: true });
  const r = f.collect();
  assert.equal(r.creator.version.value, '3.8.8');
  assert.equal(r.dependencies[0].declared.value, '^0.1.0');
  assert.equal(r.dependencies[0].locked.value, '0.1.0');
  assert.equal(r.dependencies[0].installed.value, '0.1.1-alpha.2');
  assert.equal(r.dependencies[1].declared.value, '<local-or-workspace>');
  assert.equal(r.dependencies[1].locked.value, '0.1.0');
  assert.ok(r.checks.some(c => c.code === 'installed-lock-mismatch'));
  assert.ok(r.checks.some(c => c.code === 'staged-runtime-version-mismatch'));
  assert.ok(r.checks.some(c => c.code === 'base-replay-installed-version-match' && c.status === 'review'));
  assert.equal(r.tools.status, 'skipped');
});

for (const scope of ['@cloudcare/', '@truewatchtech/', '@other-brand/', '']) {
  test('collects SDK packages independently of npm scope: ' + (scope || 'unscoped'), t => {
    const f = fixture(t);
    const versions = { 'cocos-sdk': '0.1.0', 'cocos-session-replay': '0.1.0',
      'browser-rum': '3.3.22', 'browser-logs': '3.3.22', 'browser-rum-webgl': '3.3.8' };
    const declared = Object.fromEntries(Object.entries(versions).map(([name, value]) => [scope + name, '^' + value]));
    f.write('package.json', { creator: { version: '3.8.8' }, dependencies: declared });
    f.write('package-lock.json', { packages: Object.fromEntries(Object.entries(versions)
      .map(([name, value]) => ['node_modules/' + scope + name, { version: value }])) });
    for (const [name, value] of Object.entries(versions)) {
      f.write('node_modules/' + scope + name + '/package.json', { name: scope + name, version: value, main: 'index.js' });
      f.write('node_modules/' + scope + name + '/index.js', 'throw new Error("Never execute SDK package code");');
    }
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(f.directory, 'cocos-env.json'), 'utf8'));
    assert.equal(report.dependencies.length, 5);
    for (const [name, value] of Object.entries(versions)) {
      const dependency = report.dependencies.find(dep => dep.name === scope + name);
      assert.ok(dependency);
      assert.equal(dependency.declared.value, '^' + value);
      assert.equal(dependency.locked.value, value);
      assert.equal(dependency.installed.value, value);
      assert.match(run.stdout, new RegExp(name + ': declared='));
    }
    assert.ok(report.checks.some(check => check.code === 'base-replay-installed-version-match' && check.status === 'pass'));
  });
}

test('discovers declared, locked and installed-only SDKs without matching unrelated package names', t => {
  const f = fixture(t);
  f.write('package.json', { devDependencies: { '@truewatchtech/cocos-sdk': '^0.1.0' },
    optionalDependencies: { '@truewatchtech/cocos-session-replay': '~0.1.0' },
    dependencies: { '@private/browser-rum-extra': '1.0.0', '@private/not-browser-logs': '1.0.0' } });
  f.write('package-lock.json', { dependencies: { '@other-brand/browser-logs': { version: '3.3.22' } },
    packages: { 'node_modules/@truewatchtech/browser-rum': { link: true, resolved: '../web-rum' },
      '../web-rum': { version: '3.3.22' },
      'node_modules/unrelated/node_modules/@private/browser-rum': { version: '999.0.0' } } });
  f.write('node_modules/@truewatchtech/browser-rum-webgl/package.json', { version: '3.3.8' });
  f.write('node_modules/browser-rum-webgl/package.json', { version: '3.3.7' });
  f.write('node_modules/@private/browser-rum-extra/package.json', { version: '999.0.0' });
  const report = f.collect();
  const sdk = report.dependencies.find(dep => dep.name === '@truewatchtech/cocos-sdk');
  assert.equal(sdk.declared.value, '^0.1.0');
  assert.equal(sdk.installed.status, 'unknown');
  assert.equal(report.dependencies.find(dep => dep.name === '@truewatchtech/cocos-session-replay').declared.value, '~0.1.0');
  assert.equal(report.dependencies.find(dep => dep.name === '@other-brand/browser-logs').locked.value, '3.3.22');
  assert.equal(report.dependencies.find(dep => dep.name === '@truewatchtech/browser-rum').locked.value, '3.3.22');
  assert.equal(report.dependencies.find(dep => dep.name === '@truewatchtech/browser-rum-webgl').installed.value, '3.3.8');
  assert.equal(report.dependencies.find(dep => dep.name === 'browser-rum-webgl').installed.value, '3.3.7');
  assert.ok(!JSON.stringify(report).includes('@private'));
});

test('keeps coexisting scopes separate and pairs base and replay versions only within the same scope', t => {
  const f = fixture(t);
  for (const [scope, value] of [['@cloudcare', '0.1.0'], ['@truewatchtech', '0.2.0']]) {
    for (const name of ['cocos-sdk', 'cocos-session-replay']) {
      f.write('node_modules/' + scope + '/' + name + '/package.json', { version: value });
    }
  }
  f.write('node_modules/@cloudcare/cocos-sdk/extensions/creator2/package.json', { name: 'guance-cocos-sdk' });
  f.write('node_modules/@truewatchtech/cocos-sdk/extensions/creator3/package.json', { name: 'truewatch-cocos-sdk' });
  f.write('extensions/guance-cocos-sdk/sdk-integration.json', { version: '0.1.0' });
  f.write('extensions/truewatch-cocos-sdk/sdk-integration.json', { version: '0.2.0' });
  const report = f.collect();
  const matches = report.checks.filter(check => check.code === 'base-replay-installed-version-match');
  assert.equal(matches.length, 2);
  assert.ok(matches.every(check => check.status === 'pass'));
  assert.deepEqual(matches.map(check => check.packages), [
    ['@cloudcare/cocos-sdk', '@cloudcare/cocos-session-replay'],
    ['@truewatchtech/cocos-sdk', '@truewatchtech/cocos-session-replay'],
  ]);
  assert.ok(!report.checks.some(check => check.code === 'staged-runtime-version-mismatch'));
  f.write('node_modules/@truewatchtech/cocos-session-replay/package.json', { version: '0.3.0' });
  f.write('extensions/truewatch-cocos-sdk/sdk-integration.json', { version: '0.1.0' });
  f.write('package-lock.json', { packages: { 'node_modules/@truewatchtech/cocos-session-replay': { version: '0.2.0' } } });
  const changed = f.collect();
  const mismatch = changed.checks.find(check => check.code === 'installed-lock-mismatch');
  assert.equal(mismatch.package, '@truewatchtech/cocos-session-replay');
  const pairMismatch = changed.checks.filter(check => check.code === 'base-replay-installed-version-match' && check.status === 'review');
  assert.equal(pairMismatch.length, 1);
  assert.deepEqual(pairMismatch[0].packages, ['@truewatchtech/cocos-sdk', '@truewatchtech/cocos-session-replay']);
  const stageMismatch = changed.checks.filter(check => check.code === 'staged-runtime-version-mismatch');
  assert.equal(stageMismatch.length, 1);
  assert.equal(stageMismatch[0].source, 'extensions/truewatch-cocos-sdk/sdk-integration.json');
});

test('collects TrueWatch staged integrations and checks them against installed base versions', t => {
  const f = fixture(t);
  f.write('node_modules/@truewatchtech/cocos-sdk/package.json', { version: '0.1.0' });
  f.write('packages/truewatch-cocos-sdk/sdk-integration.json', { version: '0.1.0' });
  f.write('extensions/truewatch-cocos-sdk/sdk-integration.json', { version: '0.1.1' });
  const report = f.collect();
  assert.equal(report.integrations.length, 2);
  const mismatches = report.checks.filter(check => check.code === 'staged-runtime-version-mismatch');
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].source, 'extensions/truewatch-cocos-sdk/sdk-integration.json');
});

test('collector source contains no restricted brand names', () => {
  assert.doesNotMatch(fs.readFileSync(script, 'utf8'), /truewatch|cloudcare|guance/i);
});

test('discovers staged integrations and pairs coexisting SDKs using extension manifests rather than scope names', t => {
  const f = fixture(t);
  f.write('node_modules/@vendor-one/cocos-sdk/package.json', { version: '0.1.0' });
  f.write('node_modules/@vendor-two/cocos-sdk/package.json', { version: '0.2.0' });
  f.write('node_modules/@vendor-one/cocos-sdk/extensions/creator2/package.json', { name: 'alpha-cocos-sdk',
    main: 'do-not-execute.cjs' });
  f.write('node_modules/@vendor-two/cocos-sdk/extensions/creator3/package.json', { name: 'beta-cocos-sdk' });
  f.write('node_modules/@vendor-one/cocos-sdk/extensions/creator2/do-not-execute.cjs', 'throw new Error("Never execute");');
  f.write('packages/alpha-cocos-sdk/sdk-integration.json', { version: '0.1.0' });
  f.write('extensions/beta-cocos-sdk/sdk-integration.json', { version: '0.1.0' });
  f.write('extensions/unrelated/sdk-integration.json', { version: '9.0.0' });
  const report = f.collect();
  assert.deepEqual(report.integrations, [
    { source: 'packages/alpha-cocos-sdk/sdk-integration.json', version: '0.1.0' },
    { source: 'extensions/beta-cocos-sdk/sdk-integration.json', version: '0.1.0' },
  ]);
  assert.deepEqual(report.checks.filter(check => check.code === 'staged-runtime-version-mismatch'), [
    { status: 'review', code: 'staged-runtime-version-mismatch', source: 'extensions/beta-cocos-sdk/sdk-integration.json' },
  ]);
});

test('staged integration discovery skips linked extension directories', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const target = path.join(f.directory, 'external-cocos-sdk');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'sdk-integration.json'), '{"version":"9.0.0"}');
  fs.mkdirSync(path.join(f.project, 'extensions'));
  fs.symlinkSync(target, path.join(f.project, 'extensions', 'linked-cocos-sdk'));
  let report = f.collect();
  assert.deepEqual(report.integrations, []);
  assert.equal(report.coverage.skippedSymlinks, 1);
  fs.symlinkSync(target, path.join(f.project, 'packages'));
  report = f.collect();
  assert.deepEqual(report.integrations, []);
  assert.equal(report.coverage.skippedSymlinks, 2);
});

test('supports Creator 2 and marks conflicting or absent engine versions unknown', t => {
  const f = fixture(t);
  f.write('project.json', { engine: 'cocos2d-html5', version: '2.4.15' });
  assert.equal(f.collect().creator.version.value, '2.4.15');
  f.write('package.json', { creator: { version: '3.8.8' } });
  assert.equal(f.collect().creator.version.status, 'conflict');
  f.write('project.json', {});
  f.write('package.json', {});
  assert.equal(f.collect().creator.version.status, 'unknown');
});

test('allowlists configuration values and excludes credentials, UI text, code and absolute paths', t => {
  const f = fixture(t);
  const secret = 'CUSTOMER-SECRET-NOT-FOR-REPORT';
  f.write('package.json', { creator: { version: '3.8.8' }, dependencies: { '@cloudcare/cocos-sdk': 'https://user:' + secret + '@host/pkg.tgz' } });
  f.write('cocos-sdk.config.json', { web: { enabled: true }, replay: { enabled: false },
    configuration: { sdk: { datawayToken: secret, datakitUrl: 'https://' + secret }, autoTrack: { network: true } } });
  f.write('build-config/android.json', { platform: 'android', name: secret, buildPath: f.project,
    debug: true, sourceMaps: true, md5Cache: true, encryptJs: true, zipCompressJs: true,
    packages: { android: { apiLevel: 34, appABIs: ['arm64-v8a', secret], keystorePassword: secret,
      renderBackEnd: { gles3: true } }, native: { encrypted: true, xxteaKey: secret } } });
  f.write('assets/Main.scene', [{ __type__: 'cc.Node', _name: secret, _components: [{ __id__: 1 }] },
    { __type__: 'cc.Label', _string: secret }]);
  f.write('assets/Business.ts', 'const token = "' + secret + '";');
  const r = f.collect();
  const encoded = JSON.stringify(r);
  assert.ok(!encoded.includes(secret));
  assert.ok(!encoded.includes(f.project));
  assert.equal(r.sdkConfiguration, undefined);
  assert.equal(r.components, undefined);
  assert.equal(r.buildConfigurations[0].fields['packages.android.renderBackEnd.gles3'], undefined);
  assert.equal(r.buildConfigurations[0].fields['packages.native.encrypted'], undefined);
  assert.deepEqual(r.buildConfigurations[0].fields['packages.android.appABIs'], ['arm64-v8a']);
  assert.deepEqual(r.buildConfigurations[0].fields, {
    'packages.android.apiLevel': 34, 'packages.android.appABIs': ['arm64-v8a'],
  });
  assert.equal(r.scope, 'development-environment');
});

test('components are opt-in while source code and path export stay unsupported', t => {
  const f = fixture(t);
  assert.equal(parseArgs(['--components']).components, true);
  assert.equal(parseArgs([]).components, false);
  for (const flag of ['--script-hints', '--include-paths']) {
    assert.throws(() => parseArgs([flag]));
    assert.notEqual(f.run(flag).status, 0);
  }
  for (const option of ['scriptHints', 'includePaths']) {
    assert.throws(() => f.collect({ [option]: true }), /not supported/);
  }
});

test('parses literal native configuration and never treats expressions or comments as resolved versions', () => {
  const r = parseNative(`// minSdkVersion 5
    android {
      compileSdk = 34
      defaultConfig {
        minSdkVersion 21
        targetSdk = project.targetSdk
      }
      ndkVersion = "26.3.11579264"
    }
    println("minSdk 4")
    classpath 'com.android.tools.build:gradle:8.2.2'
    implementation 'com.truewatch.ft.mobile.sdk.tracker.agent:ft-sdk:1.7.6'
    /* targetSdkVersion 18 */`, 'build.gradle');
  assert.deepEqual(r.fields.minSdk, [21]);
  assert.deepEqual(r.fields.compileSdk, [34]);
  assert.equal(r.fields.targetSdk, undefined);
  assert.deepEqual(r.fields.ndkVersion, ['26.3.11579264']);
  assert.deepEqual(r.fields.androidGradlePlugin, ['8.2.2']);
  assert.deepEqual(r.fields['ft-sdk'], ['1.7.6']);
  assert.equal(parseNative('minSdk = 21 + 4\n', 'build.gradle.kts').fields.minSdk, undefined);
  assert.deepEqual(parseNative('distributionUrl=https\\://host/gradle-8.7-bin.zip', 'gradle-wrapper.properties').fields.gradleWrapper, ['8.7']);
  assert.deepEqual(parseNative('IPHONEOS_DEPLOYMENT_TARGET = 15.0;', 'project.pbxproj').fields.iosDeploymentTarget, ['15.0']);
  assert.deepEqual(parseNative('// swift-tools-version:5.5\nplatforms: [.iOS(.v15)],', 'Package.swift').fields,
    { swiftToolsVersion: ['5.5'], iosDeploymentTarget: ['15'] });
  assert.deepEqual(parseNative('platforms: [.iOS("15.2")]', 'Package.swift').fields.iosDeploymentTarget, ['15.2']);
  assert.deepEqual(parseNative('  - TrueWatchSDK/Agent (1.6.8)', 'Podfile.lock').fields.iosSDKLocked, ['1.6.8']);
  assert.deepEqual(parseNative("s.platform = :ios, '15.0'", 'Host.podspec').fields.iosDeploymentTarget, ['15.0']);
  assert.deepEqual(parseNative('.package(url: "https://github.com/TrueWatchTech/datakit-ios.git", .exact("1.6.8"))',
    'Package.swift').fields.iosSDKDeclared, ['1.6.8']);
  assert.deepEqual(parseNative('PROP_MIN_SDK_VERSION=21\nPROP_NDK_VERSION=26.1.10909125\nPROP_APP_ABI=arm64-v8a:armeabi-v7a\nPASSWORD=private',
    'gradle.properties').fields, { PROP_MIN_SDK_VERSION: ['21'], PROP_NDK_VERSION: ['26.1.10909125'], PROP_APP_ABI: ['arm64-v8a', 'armeabi-v7a'] });
});

test('collects Android SDK artifacts independently of Maven group without matching unrelated artifacts', () => {
  const report = parseNative(`implementation 'org.vendor.mobile:ft-sdk:1.7.6'
    implementation("io.vendor.replay:ft-session-replay:0.1.0-beta.1")
    implementation 'org.vendor.mobile:other-ft-sdk:9.0.0'
    implementation 'org.vendor.mobile:ft-sdk-extra:9.0.0'
    // implementation 'org.vendor.mobile:ft-sdk:8.0.0'`, 'build.gradle.kts');
  assert.deepEqual(report.fields['ft-sdk'], ['1.7.6']);
  assert.deepEqual(report.fields['ft-session-replay'], ['0.1.0-beta.1']);
});

test('flags differing native SDK declarations and lock values without choosing an effective version', t => {
  const f = fixture(t);
  f.write('native/ios/Bridge.podspec', "s.dependency 'TrueWatchSDK/Agent', '1.6.8'");
  f.write('build/ios/Podfile.lock', '  - TrueWatchSDK/Agent (1.6.8-alpha.11)');
  const r = f.collect();
  assert.ok(r.checks.some(c => c.code === 'multiple-ios-sdk-versions-in-scanned-files'));
  assert.equal(r.nativeConfigurations.length, 2);
});

test('explicit exported configuration uses a neutral source label', t => {
  const f = fixture(t);
  const file = path.join(f.directory, 'private-export.json');
  fs.writeFileSync(file, JSON.stringify({ platform: 'ios', packages: { ios: { targetVersion: '15.0' } } }));
  const r = f.collect({ buildConfigs: [file] });
  assert.equal(r.buildConfigurations[0].source, 'explicit-build-config-1.json');
  assert.equal(r.buildConfigurations[0].fields['packages.ios.targetVersion'], '15.0');
  assert.ok(!JSON.stringify(r).includes(f.directory));
});

test('incomplete, malformed and oversized development configs are reported without contents', t => {
  const f = fixture(t);
  f.write('package.json', '{broken');
  f.write('build-config/Broken.json', '{broken');
  f.write('native/Large.gradle', ' '.repeat(8 * 1024 * 1024 + 1));
  f.write('pnpm-lock.yaml', 'secret');
  const r = f.collect();
  assert.ok(r.warnings.some(w => w.code === 'invalid-json'));
  assert.ok(r.warnings.some(w => w.code === 'lockfile-not-parsed'));
  assert.ok(r.warnings.some(w => w.code === 'read-limit'));
  assert.equal(r.coverage.limited, true);
});

test('does not traverse external symlinks or follow report symlinks', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const outside = path.join(f.directory, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'hidden.gradle'), 'minSdk 21');
  fs.mkdirSync(path.join(f.project, 'native'));
  fs.symlinkSync(outside, path.join(f.project, 'native', 'linked'));
  const target = path.join(f.directory, 'missing.json');
  const output = path.join(f.directory, 'report.json');
  fs.symlinkSync(target, output);
  assert.equal(f.collect().nativeConfigurations.length, 0);
  assert.ok(f.collect().coverage.skippedSymlinks > 0);
  assert.notEqual(f.run('--output', output, '--force').status, 0);
  assert.equal(fs.existsSync(target), false);
});

test('CLI writes a report, refuses arbitrary overwrites, and only replaces its own report with force', t => {
  const f = fixture(t);
  f.write('project.json', { version: '2.4.15' });
  const output = path.join(f.directory, 'report.json');
  const run = f.run('--output', output);
  assert.equal(run.status, 0);
  assert.ok(run.stdout.endsWith('Report saved: ' + output + '\n'));
  assert.equal(JSON.parse(fs.readFileSync(output)).creator.version.value, '2.4.15');
  const nonInteractive = f.run('--output', output);
  assert.notEqual(nonInteractive.status, 0);
  assert.match(nonInteractive.stderr, /interactive terminal.*--force/);
  const forced = f.run('--output', output, '--force');
  assert.equal(forced.status, 0);
  assert.ok(!forced.stderr.includes('Overwrite?'));
  fs.writeFileSync(output, '{"customer":"keep"}');
  assert.notEqual(f.run('--output', output, '--force').status, 0);
  assert.equal(fs.readFileSync(output, 'utf8'), '{"customer":"keep"}');
  assert.notEqual(f.run('--output', path.join(f.project, 'project.json'), '--force').status, 0);
});

test('interactive overwrite requires an affirmative answer and preserves the report on no, blank or EOF', t => {
  const f = fixture(t);
  f.write('project.json', { version: '2.4.9' });
  const output = path.join(f.directory, 'report.json');
  assert.equal(f.run('--output', output).status, 0);
  f.write('project.json', { version: '2.4.15' });
  const original = fs.readFileSync(output, 'utf8');
  for (const answer of ['n\n', '\n', '', 'not sure\n']) {
    const run = f.runInteractive(answer, '--output', output);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stderr.includes('Overwrite? [y/N]'));
    assert.ok(run.stderr.includes(output));
    assert.match(run.stdout, /Cancelled/);
    assert.ok(!run.stdout.includes('Report saved:'));
    assert.equal(fs.readFileSync(output, 'utf8'), original);
  }
  for (const answer of ['y\n', ' YES \n']) {
    const run = f.runInteractive(answer, '--output', output);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.endsWith('Report saved: ' + output + '\n'));
    assert.equal(JSON.parse(fs.readFileSync(output)).creator.version.value, '2.4.15');
  }
  fs.writeFileSync(output, '{"customer":"keep"}');
  const invalid = f.runInteractive('y\n', '--output', output);
  assert.notEqual(invalid.status, 0);
  assert.ok(!invalid.stderr.includes('Overwrite?'));
  assert.equal(fs.readFileSync(output, 'utf8'), '{"customer":"keep"}');
});

test('a file changed during the overwrite prompt is preserved even after confirmation', async t => {
  const f = fixture(t);
  const output = path.join(f.directory, 'report.json');
  assert.equal(f.run('--output', output).status, 0);
  const child = spawn(process.execPath, ['-e', interactiveBootstrap, script, '--project', f.project, '--output', output],
    { cwd: f.directory, stdio: ['pipe', 'pipe', 'pipe'] });
  const timer = setTimeout(() => child.kill(), 5000);
  t.after(() => { clearTimeout(timer); if (child.exitCode === null) child.kill(); });
  let stdout = '', stderr = '', responded = false;
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => {
    stderr += data;
    if (!responded && stderr.includes('Overwrite? [y/N]')) {
      responded = true;
      fs.writeFileSync(output, '{"customer":"changed-during-prompt"}');
      child.stdin.end('y\n');
    }
  });
  const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(responded, true);
  assert.notEqual(status, 0);
  assert.match(stderr, /report changed/);
  assert.ok(!stdout.includes('Report saved:'));
  assert.equal(fs.readFileSync(output, 'utf8'), '{"customer":"changed-during-prompt"}');
});

test('downloaded single file runs outside this repository with no dependencies', t => {
  const f = fixture(t);
  f.write('package.json', { creator: { version: '3.8.8' } });
  const downloaded = path.join(f.directory, 'collect-cocos-env.cjs');
  fs.copyFileSync(script, downloaded);
  const run = spawnSync(process.execPath, [downloaded, '--project', f.project, '--no-tools'],
    { cwd: f.directory, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.existsSync(path.join(f.directory, 'cocos-env.json')));
  assert.match(run.stdout, /Creator: 3\.8\.8/);
  assert.ok(run.stdout.endsWith('Report saved: ' + path.join(fs.realpathSync(f.directory), 'cocos-env.json') + '\n'));
});

test('piped stdin CLI collects a report and respects project and component arguments', t => {
  const f = fixture(t);
  f.write('package.json', { creator: { version: '3.8.8' } });
  f.write('assets/Main.scene', [{ __type__: 'cc.Label' }]);
  const run = f.runStdin(fs.readFileSync(script, 'utf8'), '--project', f.project, '--components', '--no-tools');
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(f.directory, 'cocos-env.json'), 'utf8'));
  assert.equal(report.creator.version.value, '3.8.8');
  assert.equal(report.components.filesParsed, 1);
  assert.equal(report.tools.status, 'skipped');
  assert.match(run.stdout, /Creator: 3\.8\.8/);
  assert.ok(run.stdout.endsWith('Report saved: ' + path.join(fs.realpathSync(f.directory), 'cocos-env.json') + '\n'));
});

test('piped stdin CLI prints help and reports invalid arguments', t => {
  const f = fixture(t);
  const source = fs.readFileSync(script, 'utf8');
  const help = f.runStdin(source, '--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Cocos development environment collector/);
  const invalid = f.runStdin(source, '--run-project');
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Collection failed: Unknown option/);
  assert.equal(fs.existsSync(path.join(f.directory, 'cocos-env.json')), false);
});

test('requiring the collector from stdin does not execute its CLI', t => {
  const f = fixture(t);
  const run = f.runStdin('require(' + JSON.stringify(script) + ');');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, '');
  assert.equal(fs.existsSync(path.join(f.directory, 'cocos-env.json')), false);
});

test('CLI rejects missing arguments and unsupported options', () => {
  assert.throws(() => parseArgs(['--project']));
  assert.throws(() => parseArgs(['--run-project']));
  assert.equal(parseArgs(['--no-tools']).tools, false);
  assert.equal(parseArgs([]).tools, false);
  assert.equal(parseArgs(['--tools']).tools, true);
});

test('all report sources and parse warnings hide business filenames', t => {
  const f = fixture(t);
  const secret = 'ConfidentialCustomer';
  f.write('build-config/' + secret + '.json', '{broken');
  f.write('native/' + secret + '/' + secret + '.podspec', "s.platform = :ios, '15.0'");
  const r = f.collect();
  assert.ok(!JSON.stringify(r).includes(secret));
  assert.match(r.nativeConfigurations[0].source, /^source-\d+\.podspec$/);
  assert.ok(r.warnings.some(w => w.code === 'invalid-json' && /^source-/.test(w.source)));
  assert.equal(r.privacy.sourcePaths, 'anonymous-source-ids');
});

test('default mode never reads assets, business scripts, runtime SDK settings, logs or unrelated service configs', t => {
  const f = fixture(t);
  const forbidden = [
    'assets/Customer.scene', 'assets/Customer.fire', 'assets/Customer.prefab', 'assets/Customer.ts', 'assets/Customer.js',
    'assets/Customer.effect',
    'cocos-sdk.config.json', 'settings/v2/packages/account.json', 'profiles/v2/packages/service.json',
    'native/Customer.m', 'native/Customer.java', 'native/Customer.cpp', '.env', 'debug.log',
  ].map(file => f.write(file, 'private-content'));
  const attempted = [];
  const originalRead = fs.readFileSync;
  let report;
  fs.readFileSync = function (file, ...args) {
    if (forbidden.includes(String(file))) attempted.push(String(file));
    return originalRead.call(this, file, ...args);
  };
  try { report = f.collect(); } finally { fs.readFileSync = originalRead; }
  assert.deepEqual(attempted, []);
  assert.equal(report.coverage.filesRead, 0);
  assert.equal(report.privacy.assetsRead, false);
  assert.equal(report.privacy.businessScriptsRead, false);
  assert.equal(report.privacy.sdkRuntimeConfigurationRead, false);
  assert.equal(report.components, undefined);
  assert.equal(report.sdkConfiguration, undefined);
  assert.deepEqual(report.warnings, []);
});

test('component mode combines scene and script evidence without exposing business names or reading shaders', t => {
  const f = fixture(t);
  const secret = 'CustomerSecret';
  f.write('assets/' + secret + '.fire', [
    { __type__: 'cc.Node', _name: secret, _components: [{ __id__: 1 }, { __id__: 1 }, { __id__: 2 }, { __id__: 99 }] },
    { __type__: 'cc.Button', text: secret }, { __type__: secret },
    { __type__: 'cc.Label' }, // Not referenced by any node.
  ]);
  f.write('assets/Resources/' + secret + '.prefab', [
    { __type__: 'cc.Node', _components: [{ __id__: 1 }] }, { __type__: 'cc.EditBox', _string: secret },
  ]);
  f.write('assets/' + secret + '.scene', [
    { __type__: 'cc.Node', _components: [{ __id__: 1 }, { __id__: 2 }, { __id__: 3 }] },
    { __type__: 'cc.Button' }, { __type__: 'cc.' + secret }, { __type__: secret },
  ]);
  const script = fs.realpathSync(f.write('assets/' + secret + '.ts', 'node.addComponent(cc.Button);'));
  f.write('assets/' + secret + '.js', 'private source');
  const shader = fs.realpathSync(f.write('assets/' + secret + '.effect', 'private shader'));
  const attempted = [];
  const original = fs.readFileSync;
  fs.readFileSync = function (file, ...args) {
    if ([script, shader].includes(String(file))) attempted.push(String(file));
    return original.call(this, file, ...args);
  };
  let r;
  try { r = f.collect({ components: true }); } finally { fs.readFileSync = original; }
  assert.deepEqual(attempted, [script]);
  assert.deepEqual(r.components.serializedComponentRecords, { 'cc.Button': 2, 'cc.EditBox': 1 });
  assert.equal(r.components.filesParsed, 3);
  assert.equal(r.components.customOrUnrecognizedRecords, 3);
  assert.equal(r.components.customOrUnrecognizedTypes, 2);
  assert.equal(r.components.unresolvedReferences, 1);
  assert.equal(r.scope, 'development-environment-with-component-summary');
  assert.equal(r.privacy.assetsRead, true);
  assert.equal(r.privacy.businessScriptsRead, true);
  assert.deepEqual(r.components.detectedTypes, ['cc.Button', 'cc.EditBox']);
  assert.deepEqual(r.components.scriptUsage.addComponentCallSites, { 'cc.Button': 1 });
  assert.deepEqual(r.components.scriptUsage.componentReferenceFiles, { 'cc.Button': 1 });
  assert.ok(!JSON.stringify(r).includes(secret));
});

test('script component scanning resolves Creator 3 imports and aliases while excluding comments and literal text', t => {
  const f = fixture(t);
  const secret = 'CustomerSecret';
  f.write('assets/' + secret + '.ts', `
    import { Label as Text, Button, RichText, sp as Spine, animation, js, postProcess } from 'cc';
    import * as Engine from 'cc';
    import { Label as Foreign } from './${secret}';
    import type { VideoPlayer } from 'cc';
    node.addComponent(Text); node.addComponent(Button);
    node.addComponent(Engine.ScrollView); node.addComponent(Spine.Skeleton);
    node.addComponent(animation.AnimationController); node.addComponent('cc.Widget');
    const FXAA = js.getClassByName('cc.FXAA') as new () => Component;
    const E: Record<string, unknown> = Engine;
    node.addComponent(FXAA); node.addComponent(postProcess.DOF); node.addComponent(E.VideoPlayer);
    node.addComponent(Foreign); node.addComponent(factory());
    // node.addComponent(cc.EditBox);
    /* node.addComponent(cc.VideoPlayer); */
    const text = 'node.addComponent(cc.EditBox); ${secret}';
    const regex = /node.addComponent(cc.Mask)/g;
    const template = \`node.addComponent(cc.Mask) \${node.addComponent(Engine.Slider)}\`;
    const division = 4 / node.addComponent(Button);
  `);
  const r = f.collect({ components: true });
  assert.deepEqual(r.components.scriptUsage.addComponentCallSites, {
    'cc.Button': 2, 'cc.FXAA': 1, 'cc.Label': 1, 'cc.ScrollView': 1, 'cc.Slider': 1, 'cc.VideoPlayer': 1,
    'cc.Widget': 1, 'cc.animation.AnimationController': 1, 'cc.postProcess.DOF': 1, 'sp.Skeleton': 1,
  });
  assert.deepEqual(r.components.detectedTypes, Object.keys(r.components.scriptUsage.addComponentCallSites));
  assert.equal(r.components.scriptUsage.customOrUnresolvedAddComponentCalls, 2);
  assert.equal(r.components.scriptUsage.componentReferenceFiles['cc.Button'], 1);
  assert.equal(r.components.scriptUsage.filesParsed, 1);
  assert.ok(!JSON.stringify(r).includes(secret));
});

test('script component scanning resolves Creator 2 destructuring, namespace aliases and literal property access without execution', t => {
  const f = fixture(t);
  const marker = path.join(f.directory, 'must-not-exist');
  f.write('assets/Legacy.js', `
    const { Button: Action, Label, LabelOutline, LabelShadow, Scrollbar } = cc;
    const E = cc;
    node.addComponent(Action); node.addComponent(Label); node.addComponent(Label);
    node.addComponent(LabelOutline); node.addComponent(LabelShadow); node.addComponent(Scrollbar);
    node.addComponent(E['EditBox']); node.addComponent(E[computed]);
    node.addComponent('cc.Sprite'); node.addComponent(CustomCustomerComponent);
    require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');
  `);
  f.write('assets/Required.cjs', `const { Toggle: Switch } = require('cc'); node.addComponent(Switch);`);
  const r = f.collect({ components: true });
  assert.deepEqual(r.components.scriptUsage.addComponentCallSites, {
    'cc.Button': 1, 'cc.EditBox': 1, 'cc.Label': 2, 'cc.LabelOutline': 1, 'cc.LabelShadow': 1,
    'cc.Scrollbar': 1, 'cc.Sprite': 1, 'cc.Toggle': 1,
  });
  assert.equal(r.components.scriptUsage.customOrUnresolvedAddComponentCalls, 2);
  assert.equal(r.components.scriptUsage.filesParsed, 2);
  assert.equal(fs.existsSync(marker), false);
  assert.ok(!JSON.stringify(r).includes('CustomCustomerComponent'));
  assert.ok(!JSON.stringify(r).includes(marker));
});

test('component script scanning bounds tokens and bytes, excludes declarations and skips external symlinks', t => {
  const f = fixture(t);
  f.write('assets/private/ManyTokens.ts', ';'.repeat(100001));
  f.write('assets/private/Large.js', ' '.repeat(8 * 1024 * 1024 + 1));
  f.write('assets/private/Declarations.d.ts', 'node.addComponent(cc.Button);');
  if (process.platform !== 'win32') {
    const external = path.join(f.directory, 'external.js');
    fs.writeFileSync(external, 'node.addComponent(cc.Label);');
    fs.symlinkSync(external, path.join(f.project, 'assets', 'External.js'));
  }
  const r = f.collect({ components: true });
  assert.equal(r.components.scriptUsage.filesFound, 2);
  assert.equal(r.components.scriptUsage.filesParsed, 0);
  assert.deepEqual(r.components.detectedTypes, []);
  assert.equal(r.coverage.limited, true);
  for (const code of ['read-limit', 'component-script-token-limit']) {
    assert.ok(r.warnings.some(w => w.code === code && /^source-/.test(w.source)));
  }
  if (process.platform !== 'win32') assert.ok(r.coverage.skippedSymlinks > 0);
  assert.ok(!JSON.stringify(r).includes('private/'));
});

test('component mode reports skipped malformed/oversized assets and does not follow symlinks', t => {
  const f = fixture(t);
  f.write('assets/private/Broken.scene', '{broken');
  f.write('assets/private/Unsupported.prefab', { serialized: 'other-format' });
  f.write('assets/private/Large.prefab', ' '.repeat(8 * 1024 * 1024 + 1));
  if (process.platform !== 'win32') {
    const outside = path.join(f.directory, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'External.scene'), '[]');
    fs.symlinkSync(outside, path.join(f.project, 'assets', 'linked'));
  }
  const r = f.collect({ components: true });
  assert.equal(r.components.filesFound, 3);
  assert.equal(r.components.filesParsed, 0);
  assert.equal(r.coverage.limited, true);
  if (process.platform !== 'win32') assert.ok(r.coverage.skippedSymlinks > 0);
  for (const code of ['invalid-json', 'unsupported-serialized-format', 'read-limit']) {
    assert.ok(r.warnings.some(w => w.code === code && /^source-/.test(w.source)));
  }
  assert.ok(!JSON.stringify(r).includes('private/'));
});

test('CLI displays an absolute custom output path only locally and only after successful writing', t => {
  const f = fixture(t);
  const output = '客户 report.json';
  const run = f.run('--components', '--output', output);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.endsWith('Report saved: ' + path.join(fs.realpathSync(f.directory), output) + '\n'));
  const contents = fs.readFileSync(path.join(f.directory, output), 'utf8');
  assert.ok(!contents.includes(f.directory));
  assert.ok(!contents.includes(output));
  assert.ok(JSON.parse(contents).components);
  const failure = f.run('--output', output);
  assert.notEqual(failure.status, 0);
  assert.ok(!failure.stdout.includes('Report saved:'));
});

test('custom release annotations are redacted after mismatches have been detected', t => {
  const f = fixture(t);
  f.write('package.json', { creator: { version: '3.8.8+CustomerEngine' }, dependencies: {
    '@cloudcare/cocos-sdk': '^0.1.0-CustomerRelease', '@cloudcare/cocos-session-replay': '1 CustomerInternalTag' } });
  f.write('package-lock.json', { packages: { 'node_modules/@cloudcare/cocos-sdk': { version: '0.1.0-CustomerA' } } });
  f.write('node_modules/@cloudcare/cocos-sdk/package.json', { version: '0.1.0-CustomerB' });
  const r = f.collect();
  assert.ok(!JSON.stringify(r).includes('Customer'));
  assert.equal(r.creator.version.value, '3.8.8');
  assert.equal(r.dependencies[0].declared.value, '^0.1.0-custom');
  assert.equal(r.dependencies[0].installed.value, '0.1.0-custom');
  assert.ok(r.checks.some(c => c.code === 'installed-lock-mismatch'));
});

test('default CLI does not probe tools; opt-in tools do not inherit unrelated secrets', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const bin = path.join(f.directory, 'bin');
  fs.mkdirSync(bin);
  const marker = path.join(f.directory, 'tool-was-run');
  // The temporary path is generated by mkdtemp and contains no shell quote characters.
  fs.writeFileSync(path.join(bin, 'java'), '#!/bin/sh\n'
    + 'echo called > "' + marker + '"\n'
    + 'if [ -n "$AWS_SECRET_ACCESS_KEY" ]; then echo \'openjdk version "999.0.0"\' >&2; '
    + 'else echo \'openjdk version "17.0.0"\' >&2; fi\n', { mode: 0o700 });
  const env = { ...process.env, PATH: bin, AWS_SECRET_ACCESS_KEY: 'private-token' };
  const output = path.join(f.directory, 'default.json');
  let run = spawnSync(process.execPath, [script, '--project', f.project, '--output', output],
    { cwd: f.directory, env, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(JSON.parse(fs.readFileSync(output)).tools.status, 'skipped');
  run = spawnSync(process.execPath, [script, '--project', f.project, '--output', output, '--force', '--tools'],
    { cwd: f.directory, env, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.existsSync(marker), true);
  const report = JSON.parse(fs.readFileSync(output));
  assert.equal(report.tools.java.value, '17.0.0');
  assert.ok(!JSON.stringify(report).includes('private-token'));
});

test('Windows npm.cmd probing handles spaced Unicode PATH without inheriting secrets or preload hooks', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const bin = path.join(f.directory, '客户 tools & npm');
  fs.mkdirSync(bin);
  const marker = path.join(bin, 'called');
  fs.writeFileSync(path.join(bin, 'npm.cmd'), '@echo off\r\n'
    + 'echo called>"%~dp0called"\r\n'
    + 'if defined AWS_SECRET_ACCESS_KEY (echo 999.0.0 & exit /b 0)\r\n'
    + 'if defined NODE_OPTIONS (echo 998.0.0 & exit /b 0)\r\n'
    + 'echo 10.9.2\r\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
  Object.assign(env, { Path: bin, AWS_SECRET_ACCESS_KEY: 'private-token', NODE_OPTIONS: '--trace-warnings' });
  const output = path.join(f.directory, 'report.json');
  const run = (...args) => spawnSync(process.execPath, [script, '--project', f.project, '--output', output, ...args],
    { cwd: f.directory, env, encoding: 'utf8', timeout: 15000 });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
  result = run('--tools', '--force');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), true);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.tools.npm.value, '10.9.2');
  assert.equal(report.tools.java.status, 'unavailable');
  assert.equal(report.tools.cmake.status, 'unavailable');
  assert.equal(report.tools.xcode, undefined);
  assert.equal(report.tools.cocoapods, undefined);
  assert.ok(!JSON.stringify(report).includes('private-token'));
});

test('Windows CLI supports drive paths, Unicode, spaces, CRLF configuration and overwrite answers', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const project = path.join(f.directory, '客户 project & demo');
  fs.renameSync(f.project, project);
  fs.writeFileSync(path.join(project, 'project.json'), '{\r\n  "version": "2.4.9"\r\n}\r\n');
  fs.writeFileSync(path.join(project, 'assets', '场景.fire'), JSON.stringify([
    { __type__: 'cc.Node', _components: [{ __id__: 1 }] }, { __type__: 'cc.Button' },
  ]));
  const config = path.join(f.directory, '构建 config.json');
  fs.writeFileSync(config, '{\r\n  "platform": "android"\r\n}\r\n');
  const output = path.join(f.directory, '环境 report.json');
  const args = [script, '--project', project, '--components', '--build-config', config, '--output', output];
  let result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.host.platform, 'win32');
  assert.equal(report.creator.version.value, '2.4.9');
  assert.equal(report.components.serializedComponentRecords['cc.Button'], 1);
  assert.equal(report.buildConfigurations[0].platform, 'android');
  assert.ok(result.stdout.includes('Report saved: ' + output));
  result = spawnSync(process.execPath, ['-e', interactiveBootstrap, ...args],
    { input: 'yes\r\n', encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stderr.includes('Overwrite? [y/N]'));
  assert.ok(result.stdout.includes('Report saved: ' + output));
});

test('Windows directory junctions are skipped without requiring administrator symlink privileges', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const outside = path.join(f.directory, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'hidden.gradle'), 'minSdk 21');
  fs.mkdirSync(path.join(f.project, 'native'));
  fs.symlinkSync(outside, path.join(f.project, 'native', 'linked'), 'junction');
  assert.equal(f.collect().nativeConfigurations.length, 0);
  assert.ok(f.collect().coverage.skippedSymlinks > 0);
});

test('neutral iOS fields retain branded Swift package pin detection', () => {
  const r = parseNative(JSON.stringify({ pins: [{ identity: 'truewatchsdk', state: { version: '1.6.8' } }] }), 'Package.resolved');
  assert.deepEqual(r.fields.iosSDKLocked, ['1.6.8']);
});
