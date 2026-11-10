'use strict';

const fs = require('fs');
const path = require('path');
const NATIVE = ['captureFps', 'maxImageDimension', 'imagePolicy', 'touchPrivacy'];
const WEB = ['captureFps', 'maxImageDimension', 'quality', 'maxFrameBytes', 'canvasPrivacy', 'canvasId'];
const SAMPLING = ['sessionReplaySamplingRate', 'sessionReplayOnErrorSamplingRate'];
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
}
function keys(value, allowed, name) {
  object(value, name);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unsupported ${name}.${key}`);
}
function number(value, min, max, name, integer = true) {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  }
}
function validateReplay(replay) {
  if (replay === undefined) return;
  keys(replay, ['enabled', ...SAMPLING, 'native', 'web'], 'replay');
  if (replay.enabled !== undefined && typeof replay.enabled !== 'boolean') throw new Error('replay.enabled must be boolean');
  for (const field of SAMPLING) number(replay[field], 0, 100, `replay.${field}`, false);
  for (const platform of ['native', 'web']) {
    const options = replay[platform];
    if (options === undefined || options === false) continue;
    keys(options, platform === 'native' ? NATIVE : WEB, `replay.${platform}`);
    number(options.captureFps, 1, 5, `replay.${platform}.captureFps`);
    number(options.maxImageDimension, 1, 2048, `replay.${platform}.maxImageDimension`);
    if (platform === 'native') {
      if (options.touchPrivacy !== undefined && !['hide', 'show'].includes(options.touchPrivacy)) throw new Error('replay.native.touchPrivacy must be hide or show');
      if (options.imagePolicy !== undefined) {
        keys(options.imagePolicy, ['quality', 'maxFrameBytes'], 'replay.native.imagePolicy');
        if (options.imagePolicy.quality !== undefined && !['low', 'medium', 'high'].includes(options.imagePolicy.quality)) throw new Error('replay.native.imagePolicy.quality must be low, medium, or high');
        number(options.imagePolicy.maxFrameBytes, 1024, 1048576, 'replay.native.imagePolicy.maxFrameBytes');
      }
    } else {
      if (options.canvasPrivacy !== undefined && !['block', 'allow'].includes(options.canvasPrivacy)) throw new Error('replay.web.canvasPrivacy must be block or allow');
      if (options.canvasId !== undefined && (typeof options.canvasId !== 'string' || !options.canvasId.trim())) throw new Error('replay.web.canvasId must be a nonempty string');
      if (options.quality !== undefined && !['low', 'medium', 'high'].includes(options.quality)) number(options.quality, 0, 1, 'replay.web.quality', false);
      number(options.maxFrameBytes, 1024, 1048576, 'replay.web.maxFrameBytes');
    }
  }
}
function unified(project) {
  return project.configuration !== undefined || Object.keys(project.replay || {}).some(key => key !== 'enabled');
}
function replayOptions(project, platform) {
  validateReplay(project.replay);
  const replay = project.replay;
  if (!replay?.enabled || replay[platform] === false) return undefined;
  return {
    sessionReplaySamplingRate: replay.sessionReplaySamplingRate ?? 100,
    sessionReplayOnErrorSamplingRate: replay.sessionReplayOnErrorSamplingRate ?? 0,
    ...(replay[platform] || {}),
  };
}
function nativeReplayEnabled(project) { validateReplay(project.replay); return project.replay?.enabled === true && project.replay.native !== false; }
function resolveNativeConfiguration(project) {
  validateReplay(project.replay);
  if (project.configuration === undefined) return undefined;
  object(project.configuration, 'configuration');
  const config = JSON.parse(JSON.stringify(project.configuration));
  keys(config, ['sdk', 'rum', 'logger', 'trace', 'autoTrack'], 'configuration');
  object(config.sdk, 'configuration.sdk');
  const replay = replayOptions(project, 'native');
  if (replay) {
    if (!config.rum) throw new Error('Native Replay requires configuration.rum');
    config.replay = replay;
  }
  return config;
}
function resolveWebConfiguration(project) {
  validateReplay(project.replay);
  if (project.web?.enabled !== true) return undefined;
  const override = project.web.configuration || {};
  object(override, 'web.configuration');
  if (!unified(project)) return override;
  const native = resolveNativeConfiguration(project) || {};
  // Copy only shared Browser settings. Native endpoints and application IDs stay out of Web artifacts.
  const fields = {
    sdk: ['serviceName', 'env', 'globalContext'],
    rum: ['sessionSamplingRate', 'sampleRate', 'sessionOnErrorSamplingRate', 'sessionOnErrorSampleRate', 'globalContext'],
    logger: ['logSamplingRate', 'sampleRate', 'enableCustomLog', 'logLevelFilters', 'globalContext'],
    trace: ['traceSamplingRate', 'sampleRate', 'traceType'],
  };
  const config = {};
  for (const [group, names] of Object.entries(fields)) {
    if (native[group] !== undefined) config[group] = Object.fromEntries(names.filter(key => native[group][key] !== undefined).map(key => [key, native[group][key]]));
    if (override[group] !== undefined) config[group] = { ...config[group], ...override[group] };
  }
  if (native.autoTrack || override.autoTrack) config.autoTrack = { ...native.autoTrack, ...override.autoTrack };
  config.web = { ...override.web };
  if (config.web.replay !== undefined) throw new Error('Configure Replay once at replay.web; remove web.configuration.web.replay');
  const replay = replayOptions(project, 'web');
  if (replay) {
    if (!config.rum) throw new Error('Web Replay requires configuration.rum or web.configuration.rum');
    config.web.replay = { enabled: true, ...replay };
  }
  return config;
}
function readProject(extensionRoot) {
  const file = path.resolve(extensionRoot, '..', '..', 'cocos-sdk.config.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}
function nativeConfigurationScript(configuration) {
  return '\n/* COCOS_PROJECT_CONFIGURATION_BEGIN */\n'
    + '(typeof window !== "undefined" ? window : globalThis).__FT_COCOS_CONFIGURATION__ = '
    + (configuration ? JSON.stringify(configuration).replace(/</g, '\\u003c') : 'undefined')
    + ';\n/* COCOS_PROJECT_CONFIGURATION_END */\n';
}
function configureNativeBuild(buildRoot, extensionRoot) {
  if (!buildRoot || !fs.existsSync(buildRoot)) return;
  const config = resolveNativeConfiguration(readProject(extensionRoot));
  let found = false;
  function visit(directory, depth) {
    if (depth > 12) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.git', 'library', 'temp', 'cocos-sdk-native'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        const source = fs.readFileSync(file, 'utf8');
        if (!source.includes('__FT_COCOS_NATIVE_FACTORY__')) continue;
        if (config?.replay && !source.includes('__FT_COCOS_REPLAY_FACTORY__')) throw new Error('Replay was enabled after installation. Rerun the installer with --replay and rebuild.');
        const clean = source.replace(/\n?\/\* COCOS_PROJECT_CONFIGURATION_BEGIN \*\/[\s\S]*?\/\* COCOS_PROJECT_CONFIGURATION_END \*\/\n?/g, '');
        fs.writeFileSync(file, clean + nativeConfigurationScript(config)); found = true;
      }
    }
  }
  visit(path.resolve(buildRoot), 0);
  if (config && !found) throw new Error('Native SDK runtime was not included in the build. Rerun the installer and rebuild.');
}
module.exports = { resolveNativeConfiguration, resolveWebConfiguration, nativeReplayEnabled, readProject, nativeConfigurationScript, configureNativeBuild };
