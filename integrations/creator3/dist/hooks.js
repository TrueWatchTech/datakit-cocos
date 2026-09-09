'use strict';

const fs = require('fs');
const path = require('path');
const { installNative } = require('../install-native.cjs');

function addCandidate(candidates, value) {
  if (typeof value === 'string' && value.trim() && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    candidates.push(value);
  }
}

function collectCandidates(input, candidates) {
  if (typeof input === 'string') {
    addCandidate(candidates, input);
    return;
  }
  if (!input || typeof input !== 'object') return;
  ['dest', 'buildPath', 'outputPath'].forEach((key) => {
    addCandidate(candidates, input[key]);
  });
  if (input.paths && typeof input.paths === 'object') {
    Object.values(input.paths).forEach((value) => addCandidate(candidates, value));
  }
  const projectPath = input.projectPath || input.project;
  if (typeof projectPath === 'string' && typeof input.outputName === 'string') {
    addCandidate(candidates, path.join(projectPath, 'build', input.outputName));
  }
}

function install(...inputs) {
  const candidates = [];
  inputs.forEach((input) => collectCandidates(input, candidates));
  const projectPath = globalThis.Editor && globalThis.Editor.Project && globalThis.Editor.Project.path;
  const taskOptions = inputs.find((input) => input && typeof input === 'object' && input.outputName);
  if (projectPath && taskOptions) {
    addCandidate(candidates, path.join(projectPath, 'build', taskOptions.outputName));
  }

  candidates.slice().forEach((candidate) => {
    const buildParent = path.dirname(candidate);
    if (path.basename(buildParent) === 'build') addCandidate(candidates, path.dirname(buildParent));
  });

  const visited = new Set();
  const normalizedCandidates = candidates.map((candidate) => {
    let normalized = path.resolve(candidate);
    if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
      normalized = path.dirname(normalized);
    }
    return normalized;
  }).sort((left, right) => left.split(path.sep).length - right.split(path.sep).length);
  normalizedCandidates.forEach((normalized) => {
    if (visited.has(normalized)) return;
    visited.add(normalized);
    installNative(normalized, path.resolve(__dirname, '..'), console);
  });
}

exports.onBeforeMake = async function onBeforeMake(root) {
  install(root);
};

exports.onAfterMake = async function onAfterMake(root) {
  install(root);
};

exports.onAfterBuild = async function onAfterBuild(options, result) {
  install(options, result);
};
