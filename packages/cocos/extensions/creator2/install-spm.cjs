'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');

function readProject(file) {
  // plutil understands both Xcode's OpenStep format and XML plists, without Ruby/gems.
  return JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }));
}

function writeProject(file, project) {
  const next = `// !$*UTF8*$!\n// COCOS_SDK_XCODE_PROJECT\n${serialize(project)}\n`;
  if (fs.readFileSync(file, 'utf8') !== next) fs.writeFileSync(file, next);
}

function serialize(value, depth = 0) {
  const indent = '\t'.repeat(depth);
  if (Array.isArray(value)) {
    return `(\n${value.map((entry) => `${indent}\t${serialize(entry, depth + 1)},\n`).join('')}${indent})`;
  }
  if (value && typeof value === 'object') {
    return `{\n${Object.entries(value).sort(([a], [b]) => a === 'isa' ? -1 : b === 'isa' ? 1 : a.localeCompare(b)).map(([key, entry]) => (
      `${indent}\t${serialize(key)} = ${serialize(entry, depth + 1)};\n`
    )).join('')}${indent}}`;
  }
  const text = String(value);
  return /^[A-Za-z0-9_./]+$/.test(text) ? text : JSON.stringify(text);
}

function applicationTarget(project, preferredName) {
  const targets = Object.entries(project.objects).filter(([, object]) => (
    object.isa === 'PBXNativeTarget' && object.productType === 'com.apple.product-type.application'
  ));
  return targets.find(([, object]) => object.name === preferredName)
    || targets.find(([, object]) => /(?:^|[-_.])(?:mobile|ios)$/i.test(object.name))
    || targets[0];
}

function add(list, value) {
  if (!list.includes(value)) list.push(value);
}

function identifier(value) {
  return createHash('sha256').update(`cocos-sdk:${value}`).digest('hex').slice(0, 24).toUpperCase();
}

function installSwiftPackage(projectFile, packageDirectory, productName, targetName) {
  if (!fs.existsSync(path.join(packageDirectory, 'Package.swift'))) {
    throw new Error(`[cocos-sdk] Missing Swift package: ${packageDirectory}`);
  }
  const project = readProject(projectFile);
  const selected = applicationTarget(project, targetName);
  if (!selected) throw new Error(`[cocos-sdk] No application target in ${projectFile}`);
  const [targetID, target] = selected;
  const objects = project.objects;
  const root = objects[project.rootObject];
  const projectDirectory = path.resolve(path.dirname(path.dirname(projectFile)), root.projectDirPath || '.');
  const relativePath = path.relative(projectDirectory, packageDirectory).split(path.sep).join('/');
  const packageID = identifier(`package:${productName}`);
  const productID = identifier(`product:${targetID}:${productName}`);
  const buildID = identifier(`framework:${targetID}:${productName}`);
  const existing = (target.packageProductDependencies || []).find((id) => (
    id !== productID && objects[id]?.productName === productName
  ));
  if (existing) throw new Error(`[cocos-sdk] ${productName} is already managed manually in ${target.name}; remove that reference before automatic installation.`);

  objects[packageID] = { isa: 'XCLocalSwiftPackageReference', relativePath };
  objects[productID] = { isa: 'XCSwiftPackageProductDependency', productName };
  objects[buildID] = { isa: 'PBXBuildFile', productRef: productID };
  add(root.packageReferences ||= [], packageID);
  add(target.packageProductDependencies ||= [], productID);
  let phaseID = (target.buildPhases || []).find((id) => objects[id]?.isa === 'PBXFrameworksBuildPhase');
  if (!phaseID) {
    phaseID = identifier(`frameworks:${targetID}`);
    objects[phaseID] = { isa: 'PBXFrameworksBuildPhase', buildActionMask: '2147483647', files: [], runOnlyForDeploymentPostprocessing: '0' };
    add(target.buildPhases ||= [], phaseID);
  }
  add(objects[phaseID].files ||= [], buildID);
  const configurations = objects[target.buildConfigurationList]?.buildConfigurations || [];
  for (const configID of configurations) {
    const settings = objects[configID].buildSettings ||= {};
    const flags = settings.OTHER_LDFLAGS;
    if (Array.isArray(flags)) {
      add(flags, '$(inherited)');
      add(flags, '-ObjC');
    } else {
      const parts = [flags || '$(inherited)'];
      if (!String(flags || '').includes('$(inherited)')) add(parts, '$(inherited)');
      if (!/(?:^|\s)-ObjC(?:\s|$)/.test(flags || '')) add(parts, '-ObjC');
      settings.OTHER_LDFLAGS = parts.join(' ');
    }
    if (Number(settings.IPHONEOS_DEPLOYMENT_TARGET || 0) < 12) settings.IPHONEOS_DEPLOYMENT_TARGET = '12.0';
    settings.CLANG_ENABLE_MODULES = 'YES';
  }
  preserveCmakeIntegration(projectFile, project, { packageDirectory, productName, targetName: target.name });
  writeProject(projectFile, project);
}

const RESTORE_BEGIN = '# COCOS_SDK_SPM_RESTORE_BEGIN';
const RESTORE_END = '# COCOS_SDK_SPM_RESTORE_END';
const restorePattern = /\n?# COCOS_SDK_SPM_RESTORE_BEGIN[\s\S]*?# COCOS_SDK_SPM_RESTORE_END\n?/g;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function preserveCmakeIntegration(projectFile, project, entry) {
  const objects = project.objects;
  const zeroCheck = Object.values(objects).find((object) => object.name === 'ZERO_CHECK');
  if (!zeroCheck) return;
  // CMake's SYMROOT/OBJROOT overrides select Xcode's legacy build locations,
  // which reject packages. Keep CONFIGURATION_BUILD_DIR (engine archives).
  const stateFile = path.join(path.dirname(projectFile), 'cocos-sdk-spm.json');
  const state = fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { packages: [], buildLocations: {} };
  for (const [id, object] of Object.entries(objects)) {
    if (object.isa !== 'XCBuildConfiguration') continue;
    for (const key of ['SYMROOT', 'OBJROOT']) {
      if (object.buildSettings?.[key] === undefined) continue;
      (state.buildLocations[id] ||= {})[key] = object.buildSettings[key];
      delete object.buildSettings[key];
    }
  }
  const relativeDirectory = path.relative(path.dirname(projectFile), entry.packageDirectory);
  state.packages = state.packages.filter((item) => item.productName !== entry.productName);
  state.packages.push({ ...entry, packageDirectory: relativeDirectory });
  state.packages.sort((a, b) => a.productName.localeCompare(b.productName));
  const helper = path.join(path.dirname(projectFile), 'cocos-sdk-spm.cjs');
  if (path.resolve(helper) !== path.resolve(__filename)) fs.copyFileSync(__filename, helper);
  const restore = [
    RESTORE_BEGIN,
    `${process.versions.electron ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}${shellQuote(process.execPath)} ${shellQuote(helper)} --restore`,
    RESTORE_END,
  ].join('\n');
  for (const id of zeroCheck.buildPhases || []) {
    const phase = objects[id];
    if (phase?.isa !== 'PBXShellScriptBuildPhase') continue;
    phase.shellScript = `${(phase.shellScript || '').replace(restorePattern, '').trimEnd()}\n${restore}\n`;
  }
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  if (!fs.existsSync(stateFile) || fs.readFileSync(stateFile, 'utf8') !== serialized) fs.writeFileSync(stateFile, serialized);
}

function removeSwiftPackages(projectFile, productNames = ['FTCocosBridge', 'FTCocosReplayBridge', 'HybridSampleHost']) {
  const project = readProject(projectFile);
  const objects = project.objects;
  const removed = new Set();
  for (const productName of productNames) {
    const packageID = identifier(`package:${productName}`);
    if (!objects[packageID]) continue;
    removed.add(packageID);
    for (const [id, object] of Object.entries(objects)) {
      if (object.isa !== 'PBXNativeTarget') continue;
      removed.add(identifier(`product:${id}:${productName}`));
      removed.add(identifier(`framework:${id}:${productName}`));
    }
  }
  for (const id of removed) delete objects[id];
  for (const object of Object.values(objects)) {
    for (const key of ['packageReferences', 'packageProductDependencies', 'files']) {
      if (Array.isArray(object[key])) object[key] = object[key].filter((id) => !removed.has(id));
    }

  }
  const stateFile = path.join(path.dirname(projectFile), 'cocos-sdk-spm.json');
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    state.packages = state.packages.filter(item => !productNames.includes(item.productName));
    if (state.packages.length) {
      fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    } else {
      for (const [id, settings] of Object.entries(state.buildLocations)) {
        if (objects[id]) Object.assign(objects[id].buildSettings ||= {}, settings);
      }
      for (const object of Object.values(objects)) {
        if (object.isa === 'PBXShellScriptBuildPhase') object.shellScript = (object.shellScript || '').replace(restorePattern, '');
      }
      fs.unlinkSync(stateFile);
      fs.rmSync(path.join(path.dirname(projectFile), 'cocos-sdk-spm.cjs'), { force: true });
    }
  }

  writeProject(projectFile, project);
}

module.exports = { installSwiftPackage, removeSwiftPackages, readProject, applicationTarget };

if (require.main === module && process.argv[2] === '--restore') {
  const directory = path.dirname(__filename);
  const state = JSON.parse(fs.readFileSync(path.join(directory, 'cocos-sdk-spm.json'), 'utf8'));
  for (const item of state.packages) {
    installSwiftPackage(path.join(directory, 'project.pbxproj'), path.resolve(directory, item.packageDirectory), item.productName, item.targetName);
  }
}
