#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

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

copyDirectory(extensionSource, destination);
copyDirectory(path.join(packageRoot, 'native'), path.join(destination, 'native'));
const componentDestination = path.join(projectRoot, 'assets', 'truewatch-cocos-sdk');
copyDirectory(path.join(packageRoot, 'components', `creator${creatorMajor}`), componentDestination);

process.stdout.write(
  `Installed ${metadata.name} for Cocos Creator ${creatorMajor} at ${destination}\n`
  + `Installed ReplayPrivacy at ${componentDestination}. Add it through Session Replay/ReplayPrivacy in the component menu.\n`
  + 'Re-open Cocos Creator, enable the truewatch-cocos-sdk extension, and rebuild the native project.\n',
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

function copyDirectory(source, destinationPath) {
  if (!fs.existsSync(source)) fail(`Missing package asset: ${source}`);
  fs.mkdirSync(destinationPath, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destinationPath, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}

function printHelp() {
  process.stdout.write([
    'Usage: npx @truewatchtech/cocos-sdk install [options]',
    '',
    'Options:',
    '  --project <path>  Cocos project root (defaults to the current directory)',
    '  --creator <2|3>   Override automatic Cocos Creator version detection',
    '  -h, --help        Show this help',
    '',
  ].join('\n'));
}

function fail(message) {
  process.stderr.write(`[truewatch-cocos] ${message}\n`);
  process.exit(1);
}
