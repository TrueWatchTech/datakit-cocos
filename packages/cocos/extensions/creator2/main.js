'use strict';

const { installNative } = require('./install-native.cjs');

function web() { return require('./install-web.cjs'); }

function onBuildStart(options, callback) {
  try {
    const config = require('./project-configuration.cjs');
    config.resolveNativeConfiguration(config.readProject(__dirname));
    if (options && ['web-mobile', 'web-desktop'].includes(options.platform)) web().readWebConfig(__dirname);
    callback();
  } catch (error) { callback(error); }
}

function onBuildFinished(options, callback) {
  try {
    if (options && ['web-mobile', 'web-desktop'].includes(options.platform)) web().installWeb(options.dest || options.buildPath, __dirname);
    else {
      const root = options && (options.dest || options.buildPath);
      installNative(root, __dirname, Editor);
      require('./project-configuration.cjs').configureNativeBuild(root, __dirname);
    }
    callback();
  } catch (error) {
    Editor.error(`[cocos-sdk] ${error && error.stack ? error.stack : error}`);
    callback(error);
  }
}

module.exports = {
  load() {
    Editor.Builder.on('build-start', onBuildStart);
    Editor.Builder.on('build-finished', onBuildFinished);
  },
  unload() {
    Editor.Builder.removeListener('build-start', onBuildStart);
    Editor.Builder.removeListener('build-finished', onBuildFinished);
  },
};
