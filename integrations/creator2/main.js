'use strict';

const path = require('path');
const { installNative } = require('./install-native.cjs');

function onBuildFinished(options, callback) {
  try {
    installNative(options && (options.dest || options.buildPath), __dirname, Editor);
    callback();
  } catch (error) {
    Editor.error(`[cocos-sdk] ${error && error.stack ? error.stack : error}`);
    callback(error);
  }
}

module.exports = {
  load() {
    Editor.Builder.on('build-finished', onBuildFinished);
  },
  unload() {
    Editor.Builder.removeListener('build-finished', onBuildFinished);
  },
};
