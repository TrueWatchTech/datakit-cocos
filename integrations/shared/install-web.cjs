'use strict';

const fs = require('fs');
const path = require('path');
const { syncManagedDirectory } = require('./managed-assets.cjs');
const { resolveWebConfiguration } = require('./project-configuration.cjs');
const BEGIN = '<!-- COCOS_SDK_WEB_BEGIN -->';
const END = '<!-- COCOS_SDK_WEB_END -->';

function isWebBuild(options) {
  return options && ['web-mobile', 'web-desktop'].includes(options.platform);
}
function readWebConfig(extensionRoot) {
  const project = path.resolve(extensionRoot, '..', '..');
  const file = path.join(project, 'cocos-sdk.config.json');
  const projectConfig = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const config = resolveWebConfiguration(projectConfig);
  if (!config) return undefined;
  if (!config || !config.web || (!config.rum && !config.logger)) {
    throw new Error('Set web.configuration in cocos-sdk.config.json with explicit web reporting settings and rum or logger');
  }
  // The runtime performs detailed API validation. Build validation detects missing assets/configuration early.
  if (config.rum && !config.web.applicationId) throw new Error('web.configuration.web.applicationId is required');
  if (!config.web.datakitOrigin && !(config.web.site && config.web.clientToken)) throw new Error('Configure the Web reporting origin');
  for (const file of requiredFiles(config)) {
    if (!fs.existsSync(path.join(extensionRoot, 'web', file))) throw new Error(`Missing Web asset ${file}; rerun the installer with --web`);
  }
  return config;
}
function requiredFiles(config) {
  return [
    ...(config.rum ? ['rum.js'] : []),
    ...(config.logger ? ['logs.js'] : []),
    ...(config.web.replay ? ['webgl.js'] : []),
    'bootstrap.js',
  ];
}
function installWeb(buildRoot, extensionRoot) {
  const config = readWebConfig(extensionRoot);
  if (!config) {
    const htmlFile = buildRoot && path.join(buildRoot, 'index.html');
    if (htmlFile && fs.existsSync(htmlFile)) {
      const original = fs.readFileSync(htmlFile, 'utf8');
      const clean = original.replace(/<!-- COCOS_SDK_WEB_BEGIN -->[\s\S]*?<!-- COCOS_SDK_WEB_END -->\s*/g, '');
      if (clean !== original) fs.writeFileSync(htmlFile, clean);
      const managed = path.join(buildRoot, 'cocos-sdk-web');
      if (fs.existsSync(path.join(managed, '.cocos-sdk-managed.json'))) syncManagedDirectory(managed, [], {});
    }
    return;
  }
  if (!buildRoot) throw new Error('Cannot resolve the Web build output directory');
  const htmlFile = path.join(buildRoot, 'index.html');
  if (!fs.existsSync(htmlFile)) throw new Error(`Missing Web build index.html at ${buildRoot}`);
  const original = fs.readFileSync(htmlFile, 'utf8');
  const clean = original.replace(/<!-- COCOS_SDK_WEB_BEGIN -->[\s\S]*?<!-- COCOS_SDK_WEB_END -->\s*/g, '');
  const head = /<head(?:\s[^>]*)?>/i.exec(clean);
  if (!head) throw new Error('Cannot place the Web bootstrap before engine boot: index.html has no head');
  const generated = {};
  requiredFiles(config).forEach(file => { generated[file] = fs.readFileSync(path.join(extensionRoot, 'web', file)); });
  const sourceMap = path.join(extensionRoot, 'web', 'bootstrap.js.map');
  if (fs.existsSync(sourceMap)) generated['bootstrap.js.map'] = fs.readFileSync(sourceMap);
  generated['initialize.js'] = 'CocosWebSDK.bootstrapWeb(' + JSON.stringify(config).replace(/</g, '\\u003c') + ');\n';
  // Dedicated output directory, never change user scripts or the project's node_modules.
  syncManagedDirectory(path.join(buildRoot, 'cocos-sdk-web'), [], generated);
  const scripts = [...requiredFiles(config), 'initialize.js'].map(file => `<script src="cocos-sdk-web/${file}"></script>`).join('\n');
  const index = head.index + head[0].length;
  fs.writeFileSync(htmlFile, clean.slice(0, index) + '\n' + BEGIN + '\n' + scripts + '\n' + END + '\n' + clean.slice(index));
}
module.exports = { isWebBuild, readWebConfig, installWeb };
