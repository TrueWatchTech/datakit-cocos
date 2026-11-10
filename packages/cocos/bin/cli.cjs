#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { syncManagedDirectory } = require('./managed-assets.cjs');

const packageRoot = path.resolve(__dirname, '..');
const metadata = require(path.join(packageRoot, 'package.json'));
const rawArguments = process.argv.slice(2);

if (rawArguments.includes('--help') || rawArguments.includes('-h')) {
  printHelp();
  process.exit(0);
}

const command = rawArguments[0] && !rawArguments[0].startsWith('-')
  ? rawArguments.shift()
  : 'install';
if (command !== 'install') fail(`Unknown command: ${command}`);

const projectRoot = path.resolve(readOption(rawArguments, '--project') || process.cwd());
if (!fs.existsSync(path.join(projectRoot, 'assets'))) {
  fail(`No Cocos project found at ${projectRoot} (missing assets directory).`);
}

const creatorMajor = resolveCreatorMajor(projectRoot, readOption(rawArguments, '--creator'));
const container = creatorMajor === 2 ? 'packages' : 'extensions';
const destination = path.join(projectRoot, container, 'truewatch-cocos-sdk');
const extensionSource = path.join(packageRoot, 'extensions', `creator${creatorMajor}`);
const manager = readOption(rawArguments, '--ios-dependency-manager');
if (manager !== undefined && !['spm', 'cocoapods'].includes(manager)) {
  fail('Invalid --ios-dependency-manager. Expected spm or cocoapods.');
}
const configFile = path.join(projectRoot, 'cocos-sdk.config.json');
const config = readJson(configFile) || {};
const projectConfiguration = require('./project-configuration.cjs');
if (rawArguments.includes('--replay') && rawArguments.includes('--no-replay')) fail('Choose either --replay or --no-replay.');
if (rawArguments.includes('--web') && rawArguments.includes('--no-web')) fail('Choose either --web or --no-web.');
const webEnabled = rawArguments.includes('--web') ? true : rawArguments.includes('--no-web') ? false : config.web?.enabled === true;
const replayEnabled = rawArguments.includes('--replay') ? true
  : rawArguments.includes('--no-replay') ? false : config.replay?.enabled === true;
const effectiveConfig = { ...config, web: { ...config.web, enabled: webEnabled }, replay: { ...config.replay, enabled: replayEnabled } };
const nativeReplayEnabled = projectConfiguration.nativeReplayEnabled(effectiveConfig);
const nativeConfiguration = projectConfiguration.resolveNativeConfiguration(effectiveConfig);
const webConfiguration = projectConfiguration.resolveWebConfiguration(effectiveConfig);
let replayRoot;
let replayDescriptor;
if (nativeReplayEnabled) {
  try {
    const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
    replayRoot = path.dirname(projectRequire.resolve('@truewatchtech/cocos-session-replay/package.json'));
  } catch {
    fail('Session Replay is not installed. Install @truewatchtech/cocos-session-replay at the same version as @truewatchtech/cocos-sdk, then rerun with --replay.');
  }
  const replayPackage = readJson(path.join(replayRoot, 'package.json'));
  replayDescriptor = readJson(path.join(replayRoot, 'native-integration.json'));
  if (replayPackage.version !== metadata.version || replayPackage.peerDependencies?.[metadata.name] !== metadata.version
    || replayDescriptor?.schemaVersion !== 1 || replayDescriptor?.version !== metadata.version || replayDescriptor?.baseVersion !== metadata.version) {
    fail('Replay package and native integration must exactly match the base SDK version.');
  }
}
const sources = [{ root: extensionSource }, { root: path.join(packageRoot, 'native'), prefix: 'native/' }];
if (replayRoot) sources.push({ root: path.join(replayRoot, 'native'), prefix: 'replay-native/' });
const generated = {
  'sdk-integration.json': JSON.stringify({ schemaVersion: 1, version: metadata.version, replay: nativeReplayEnabled }, null, 2) + '\n',
};
if (webEnabled) {
  try { Object.assign(generated, require('./web-assets.cjs').webAssets(projectRoot, packageRoot, webConfiguration)); }
  catch (error) { fail(error.message); }
}
if (replayDescriptor) generated['replay-integration.json'] = JSON.stringify(replayDescriptor, null, 2) + '\n';
syncManagedDirectory(destination, sources, generated);
// Install once with platform metadata; switching build targets never rewrites game imports.
const nativePluginFlags = { isPlugin: true, loadPluginInWeb: false, loadPluginInNative: true, loadPluginInEditor: true, ...(creatorMajor === 3 ? { loadPluginInMiniGame: false } : {}) };
const nativePluginMeta = creatorMajor === 2
  ? { ver: '1.0.8', uuid: '22890dac-cd02-4da1-817a-f4eb4468a2c3', importer: 'javascript', ...nativePluginFlags, subMetas: {} }
  : { ver: '4.0.24', uuid: '22890dac-cd02-4da1-817a-f4eb4468a2c3', importer: 'javascript', imported: true, files: [], subMetas: {}, userData: { ...nativePluginFlags, simulateGlobals: [] } };
const runtimeDirectory = path.join(projectRoot, 'assets', 'truewatch-cocos-sdk-runtime');
const nativeMetaFile = path.join(runtimeDirectory, 'native.js.meta');
// Creator upgrades metadata versions and adds importer fields. Preserve those edits and the asset UUID.
const existingMeta = readJson(nativeMetaFile);
const existingFlags = creatorMajor === 2 ? existingMeta : existingMeta?.userData;
if (existingMeta && Object.entries(nativePluginFlags).some(([key, value]) => existingFlags?.[key] !== value)) {
  fail('The SDK native runtime must remain a plugin loaded only on native platforms and in the Editor. Restore its import settings before reinstalling.');
}
syncManagedDirectory(runtimeDirectory, [], {
  'native.js': fs.readFileSync(path.join(packageRoot, 'runtime', 'native.js'), 'utf8')
    + (replayRoot ? fs.readFileSync(path.join(replayRoot, 'runtime', `creator${creatorMajor}.js`), 'utf8') : '')
    + projectConfiguration.nativeConfigurationScript(nativeConfiguration),
});
if (!existingMeta) fs.writeFileSync(nativeMetaFile, JSON.stringify(nativePluginMeta, null, 2) + '\n');
const componentDestination = path.join(projectRoot, 'assets', 'truewatch-cocos-sdk');
if (replayRoot) syncManagedDirectory(componentDestination, [{ root: path.join(replayRoot, 'components', `creator${creatorMajor}`) }]);
// Keep existing component scripts and .meta files when disabling Replay: scenes may reference them.
if (manager !== undefined) config.ios = { ...config.ios, dependencyManager: manager };
if (rawArguments.includes('--replay') || rawArguments.includes('--no-replay') || config.replay) {
  config.replay = { ...config.replay, enabled: replayEnabled };
}
if (rawArguments.includes('--web') || rawArguments.includes('--no-web')) config.web = { ...config.web, enabled: webEnabled };
if (manager !== undefined || ['--replay', '--no-replay', '--web', '--no-web'].some(flag => rawArguments.includes(flag))) {
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
}
process.stdout.write(
  `Installed ${metadata.name} for Cocos Creator ${creatorMajor} at ${destination} (Replay: ${replayEnabled ? 'enabled' : 'disabled'})\n`
  + (replayRoot ? `Installed ReplayPrivacy at ${componentDestination}. Add it through Session Replay/ReplayPrivacy in the component menu.\n` : '')
  + (webEnabled ? 'Web: import @truewatchtech/cocos-sdk/creator' + creatorMajor + ' and call start() to use project settings.\n' : '')
  + 'Re-open Cocos Creator, enable the truewatch-cocos-sdk extension, and rebuild the project.\n',
);
for (const duplicate of findDuplicateExtensions(path.join(projectRoot, container), destination)) {
  process.stderr.write(
    `[truewatch-cocos] Another SDK extension detected at ${duplicate}. `
    + 'Remove it after confirming it contains no project-specific changes.\n',
  );
}

function findDuplicateExtensions(containerRoot, installedDestination) {
  return fs.readdirSync(containerRoot)
    .map((entry) => path.join(containerRoot, entry))
    .filter((directory) => directory !== installedDestination && (
      fs.existsSync(path.join(directory, 'native', 'ios', 'FTCocosBridge.podspec'))
      || fs.existsSync(path.join(directory, 'native', 'android', 'src', 'main', 'java', 'com', 'ft', 'sdk', 'cocos', 'FTCocosBridge.java'))
    ));
}

function resolveCreatorMajor(projectPath, explicitValue) {
  if (explicitValue !== undefined) {
    const explicitMajor = Number(explicitValue);
    if (explicitMajor === 2 || explicitMajor === 3) return explicitMajor;
    fail(`Unsupported --creator value: ${explicitValue}. Expected 2 or 3.`);
  }

  const legacyProject = readJson(path.join(projectPath, 'project.json'));
  if (legacyProject) {
    const projectMajor = versionMajor(legacyProject.version);
    if (projectMajor === 2 || projectMajor === 3) return projectMajor;
    if (legacyProject.engine === 'cocos2d-html5') return 2;
  }

  const projectPackage = readJson(path.join(projectPath, 'package.json'));
  if (projectPackage) {
    const creatorVersion = projectPackage.creator && typeof projectPackage.creator === 'object'
      ? projectPackage.creator.version
      : projectPackage.creatorVersion;
    const packageMajor = versionMajor(creatorVersion);
    if (packageMajor === 2 || packageMajor === 3) return packageMajor;
  }

  if (fs.existsSync(path.join(projectPath, 'extensions'))) return 3;
  if (fs.existsSync(path.join(projectPath, 'project.json'))) return 2;
  fail('Unable to detect the Cocos Creator version. Pass --creator 2 or --creator 3.');
}

function versionMajor(value) {
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function readJson(file) {
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Unable to read ${file}: ${error.message}`);
  }
}

function readOption(argumentsList, name) {
  const exactIndex = argumentsList.indexOf(name);
  if (exactIndex >= 0) {
    const value = argumentsList[exactIndex + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for ${name}.`);
    return value;
  }
  const prefix = `${name}=`;
  const inline = argumentsList.find((argument) => argument.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : undefined;
}

function printHelp() {
  process.stdout.write([
    'Usage: npx @truewatchtech/cocos-sdk install [options]',
    '',
    'Options:',
    '  --project <path>  Cocos project root (defaults to the current directory)',
    '  --creator <2|3>   Override automatic Cocos Creator version detection',
    '  --web            Install Browser bundles using cocos-sdk.config.json',
    '  --no-web         Disable Web bootstrap integration',
    '  --replay         Include the separately installed Session Replay package',
    '  --no-replay      Remove SDK-managed Replay native integration on rebuild',
    '  --ios-dependency-manager <spm|cocoapods>  Save the iOS dependency manager in cocos-sdk.config.json',
    '  -h, --help        Show this help',
    '',
    'Project settings: configuration supplies native/shared settings; web.configuration supplies Web connection settings.',
    'Replay settings: replay.enabled, shared sampling, replay.native and replay.web. Call the SDK start() method to use them.',
    '',
  ].join('\n'));
}

function fail(message) {
  process.stderr.write(`[truewatch-cocos] ${message}\n`);
  process.exit(1);
}
