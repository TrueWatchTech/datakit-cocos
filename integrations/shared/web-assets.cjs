'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

// Validated published bundle contracts. Native consumers do not install these packages.
const BUNDLES = [
  ['@truewatchtech/browser-rum', '3.3.22', 'truewatch-rum.js', 'rum.js'],
  ['@truewatchtech/browser-logs', '3.3.22', 'truewatch-logs.js', 'logs.js'],
  ['@truewatchtech/browser-rum-webgl', '3.3.8', 'truewatch-rum-webgl.js', 'webgl.js'],
];
function webAssets(projectRoot, packageRoot, configuration) {
  const resolve = createRequire(path.join(projectRoot, 'package.json'));
  const files = {
    'web/bootstrap.js': fs.readFileSync(path.join(packageRoot, 'web/bootstrap.js')),
    'web/bootstrap.js.map': fs.readFileSync(path.join(packageRoot, 'web/bootstrap.js.map')),
  };
  const selected = BUNDLES.filter((_, i) => i === 0 ? configuration?.rum : i === 1 ? configuration?.logger : configuration?.web?.replay);
  if (!selected.length) throw new Error('Configure web.configuration with rum or logger before installing --web');
  selected.forEach(([name, version, source, target]) => {
    let root;
    try { root = path.dirname(resolve.resolve(`${name}/package.json`)); }
    catch { throw new Error(`Install ${name}@${version} in the Cocos project before running --web`); }
    if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version !== version) {
      throw new Error(`The Web integration requires ${name}@${version}`);
    }
    files[`web/${target}`] = fs.readFileSync(path.join(root, 'bundle', source));
  });
  return files;
}
module.exports = { webAssets };
