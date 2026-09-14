'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { syncManagedDirectory } = require('./managed-assets.cjs');

const BEGIN = '/* COCOS_SDK_BEGIN */';
const END = '/* COCOS_SDK_END */';
const POD_BEGIN = '# COCOS_SDK_BEGIN';
const POD_END = '# COCOS_SDK_END';
const XCCONFIG_BEGIN = '// COCOS_SDK_BEGIN';
const XCCONFIG_END = '// COCOS_SDK_END';
const LEGACY_BEGIN = '/* FT_COCOS_SDK_BEGIN */';
const LEGACY_END = '/* FT_COCOS_SDK_END */';
const LEGACY_POD_BEGIN = '# FT_COCOS_SDK_BEGIN';
const LEGACY_POD_END = '# FT_COCOS_SDK_END';
const LEGACY_XCCONFIG_BEGIN = '// FT_COCOS_SDK_BEGIN';
const LEGACY_XCCONFIG_END = '// FT_COCOS_SDK_END';

function installNative(buildRoot, extensionRoot, logger = console) {
  if (!buildRoot) return;
  buildRoot = path.resolve(buildRoot);
  extensionRoot = path.resolve(extensionRoot);
  if (!fs.existsSync(buildRoot)) return;
  const dependencyManager = readIosDependencyManager(buildRoot, extensionRoot);
  const nativeSource = path.join(extensionRoot, 'native');
  if (!fs.existsSync(nativeSource)) {
    logger.warn(`[cocos-sdk] Native bridge not found at ${nativeSource}`);
    return;
  }
  const replayDescriptor = path.join(extensionRoot, 'replay-integration.json');
  const replay = fs.existsSync(replayDescriptor) ? JSON.parse(fs.readFileSync(replayDescriptor, 'utf8')) : null;
  const installedFile = path.join(extensionRoot, 'sdk-integration.json');
  const installed = fs.existsSync(installedFile) ? JSON.parse(fs.readFileSync(installedFile, 'utf8')) : null;
  if (installed?.replay && !replay) throw new Error('[cocos-sdk] Replay assets are missing. Run truewatch-cocos install --replay.');
  if (replay && (replay.schemaVersion !== 1 || !installed || replay.baseVersion !== installed.version || replay.version !== installed.version || replay.iosSdkVersion !== '1.6.8-alpha.5')) {
    throw new Error('[cocos-sdk] Replay native integration version does not match the base SDK. Reinstall matching packages.');
  }
  const replaySource = path.join(extensionRoot, 'replay-native');
  const buildNative = path.join(buildRoot, 'cocos-sdk-native');
  const sources = [{ root: nativeSource }];
  if (replay) sources.push({ root: replaySource, prefix: 'replay/' });
  if (dependencyManager === 'spm') {
    sources.push({ root: path.join(nativeSource, 'ios'), prefix: 'FTCocosBridge/' });
    if (replay) sources.push({ root: path.join(replaySource, 'ios'), prefix: 'FTCocosReplayBridge/' });
  }
  const modules = 'android/src/main/java/com/ft/sdk/cocos/FTCocosBridgeModules.java';
  const dispatcher = fs.readFileSync(path.join(nativeSource, modules), 'utf8');
  const configuredDispatcher = replay ? dispatcher.replace(
    '        return "{',
    '        if ("session-replay".equals(endpoint)) return FTCocosReplayBridge.invokeLocal(method, payload);\n        return "{',
  ) : dispatcher;
  syncManagedDirectory(buildNative, sources, { [modules]: configuredDispatcher });
  const files = findFiles(buildRoot, 7);
  const replayHeader = replay ? path.join(buildNative, 'replay', 'shared', 'FTReplayFileBridge.h') : null;
  findReplayEntryFiles(files).forEach(file => patchReplayFileBridge(file, replayHeader));
  const gradlePropertiesFiles = files.filter((file) => path.basename(file) === 'gradle.properties');
  const gradleFiles = uniqueFiles([
    ...files.filter((file) => /(?:^|\/)app\/build\.gradle$/.test(normalize(file))),
    ...gradlePropertiesFiles.flatMap(findNativeAppGradleFiles),
  ]);
  const podfiles = files.filter((file) => path.basename(file) === 'Podfile');
  const xcodeProjects = files.filter((file) => (
    path.basename(file) === 'project.pbxproj' && path.extname(path.dirname(file)) === '.xcodeproj'
  ));
  const iosApplicationProjects = xcodeProjects
    .map((projectFile) => ({ projectFile, target: findIosApplicationTarget(projectFile) }))
    .filter((project) => project.target);
  if (dependencyManager === 'spm' && iosApplicationProjects.length > 0) {
    migrateManagedPods(podfiles, logger);
  }
  if (dependencyManager === 'cocoapods' && podfiles.length === 0) {
    iosApplicationProjects.forEach(({ projectFile, target }) => {
      const projectDirectory = path.dirname(path.dirname(projectFile));
      const podfile = path.join(projectDirectory, 'Podfile');
      if (!fs.existsSync(podfile)) createPodfile(podfile, projectFile, target);
      podfiles.push(podfile);
    });
  }
  iosApplicationProjects.forEach(({ projectFile, target }) => {
    patchCocos2IosConfiguration(projectFile, target);
    if (dependencyManager === 'spm') {
      const spm = require('./install-spm.cjs');
      if (!replay) spm.removeSwiftPackages(projectFile, ['FTCocosReplayBridge']);
      spm.installSwiftPackage(projectFile, path.join(buildNative, 'FTCocosBridge'), 'FTCocosBridge', target);
      if (replay) spm.installSwiftPackage(projectFile, path.join(buildNative, 'FTCocosReplayBridge'), 'FTCocosReplayBridge', target);
    } else if (fs.readFileSync(projectFile, 'utf8').includes('XCLocalSwiftPackageReference')
      || fs.existsSync(path.join(path.dirname(projectFile), 'cocos-sdk-spm.json'))) {
      require('./install-spm.cjs').removeSwiftPackages(projectFile);
    }
  });
  gradleFiles.forEach((file) => patchGradle(file, buildNative, replay));
  gradlePropertiesFiles.forEach(patchGradleProperties);
  if (dependencyManager === 'cocoapods') podfiles.forEach((file) => patchPodfile(file, buildNative, replay));
  logger.info(
    `[cocos-sdk] Installed native bridge (${gradleFiles.length} Android, ${dependencyManager === 'spm' ? iosApplicationProjects.length : podfiles.length} iOS project files; iOS: ${dependencyManager}).`,
  );
}

function patchReplayFileBridge(file, header) {
  const original = fs.readFileSync(file, 'utf8');
  const includeBegin = '// COCOS_SDK_REPLAY_INCLUDE_BEGIN';
  const includeEnd = '// COCOS_SDK_REPLAY_INCLUDE_END';
  const initBegin = '// COCOS_SDK_REPLAY_INIT_BEGIN';
  const initEnd = '// COCOS_SDK_REPLAY_INIT_END';
  // Creator 3 shares Game.cpp across iOS/Android builds. Keep its include stable
  // when another platform's build directory is cleaned or regenerated.
  const sharedDirectory = path.join(path.dirname(file), 'cocos-sdk-replay');
  if (!header) {
    const next = original.replace(markedPattern(includeBegin, includeEnd), '').replace(markedPattern(initBegin, initEnd), '');
    if (fs.existsSync(sharedDirectory)) syncManagedDirectory(sharedDirectory, []);
    if (next !== original) fs.writeFileSync(file, next);
    return;
  }
  const include = `${includeBegin}\n#include "cocos-sdk-replay/FTReplayFileBridge.h"\n${includeEnd}`;
  const init = `${initBegin}\n    ft_cocos::installReplayFileBridge();\n    ${initEnd}\n    `;
  let next = original;
  if (markedPattern(initBegin, initEnd).test(next)) {
    next = next.replace(markedPattern(initBegin, initEnd), init.trimEnd());
  } else {
    const anchor = path.basename(file) === 'Game.cpp'
      ? /\b(?:return\s+)?BaseGame::init\(\);/
      : /\b(?:return\s+)?se->start\(\);/;
    if (!anchor.test(next)) return;
    next = next.replace(anchor, (value) => init + value);
  }
  next = markedPattern(includeBegin, includeEnd).test(next)
    ? next.replace(markedPattern(includeBegin, includeEnd), include)
    : `${include}\n${next}`;
  syncManagedDirectory(sharedDirectory, [{ root: path.dirname(header) }]);
  if (next !== original) fs.writeFileSync(file, next);
}

function findReplayEntryFiles(files) {
  const entries = files.filter((file) => ['AppDelegate.cpp', 'Game.cpp'].includes(path.basename(file)));
  for (const file of files) {
    let nativeDirectory;
    if (path.basename(file) === 'gradle.properties') {
      const value = readProperty(fs.readFileSync(file, 'utf8'), 'NATIVE_DIR');
      if (value) nativeDirectory = path.resolve(path.dirname(file), value);
    } else if (path.basename(file) === 'CMakeCache.txt') {
      const match = fs.readFileSync(file, 'utf8').match(/^CMAKE_HOME_DIRECTORY:INTERNAL=(.+)$/m);
      if (match) nativeDirectory = match[1].trim();
    }
    if (nativeDirectory) {
      const game = path.resolve(nativeDirectory, '..', 'common', 'Classes', 'Game.cpp');
      if (fs.existsSync(game)) entries.push(game);
    }
  }
  return uniqueFiles(entries);
}

function patchCocos2IosConfiguration(projectFile, target) {
  const projectDirectory = path.dirname(path.dirname(projectFile));
  const iosDirectory = path.join(projectDirectory, 'ios');
  const configurations = ['debug', 'release'];
  const configFiles = configurations.map((configuration) => ({
    configuration,
    file: path.join(iosDirectory, `UserConfigIOS.${configuration}.xcconfig`),
  }));
  if (!configFiles.some(({ file }) => fs.existsSync(file))) return;

  configFiles.forEach(({ configuration, file }) => {
    if (!fs.existsSync(file)) return;
    replaceMarkedBlock(file, [
      XCCONFIG_BEGIN,
      `#include? "../Pods/Target Support Files/Pods-${target}/Pods-${target}.${configuration}.xcconfig"`,
      `OTHER_LDFLAGS = $(inherited) ${cocos2CompatibilityLinkerFlags()}`,
      XCCONFIG_END,
    ].join('\n'), XCCONFIG_BEGIN, XCCONFIG_END, [
      [LEGACY_XCCONFIG_BEGIN, LEGACY_XCCONFIG_END],
    ]);
  });

  const original = fs.readFileSync(projectFile, 'utf8');
  let next = quoteWhitespaceProductNames(original).replace(
    /(\b(?:HEADER|LIBRARY)_SEARCH_PATHS\s*=\s*)"([^"]*)";/g,
    (line, prefix, value) => value.includes('$(inherited)')
      ? line
      : `${prefix}"${`$(inherited) ${value}`.trim()}";`,
  );
  next = next.replace(
    /(\bIPHONEOS_DEPLOYMENT_TARGET\s*=\s*)(\d+(?:\.\d+)*)(\s*;)/g,
    (line, prefix, version, suffix) => compareVersions(version, '12.0') < 0
      ? `${prefix}12.0${suffix}`
      : line,
  );
  if (next !== original) fs.writeFileSync(projectFile, next);
}

function quoteWhitespaceProductNames(contents) {
  return contents.replace(
    /^([ \t]*productName[ \t]*=)([^;\r\n]*)(;)$/gm,
    (line, prefix, value, suffix) => {
      const productName = value.trim();
      if (!/[ \t]/.test(productName) || (productName.startsWith('"') && productName.endsWith('"'))) {
        return line;
      }
      const spacing = value.match(/^[ \t]*/)?.[0] || ' ';
      return `${prefix}${spacing}"${productName.replace(/"/g, '\\"')}"${suffix}`;
    },
  );
}

function cocos2CompatibilityLinkerFlags() {
  const flags = ['-lwebp'];
  if (process.platform !== 'darwin') return flags.join(' ');
  try {
    const version = execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' });
    const major = Number((version.match(/^Xcode\s+(\d+)/m) || [])[1]);
    if (major >= 15) flags.push('-Wl,-ld_classic');
  } catch {
    // Xcode is optional when only generating or testing non-iOS projects.
  }
  return flags.join(' ');
}

function patchGradleProperties(file) {
  let contents = fs.readFileSync(file, 'utf8');
  contents = raiseNumericProperty(contents, 'PROP_COMPILE_SDK_VERSION', 34);
  contents = raiseNumericProperty(contents, 'PROP_MIN_SDK_VERSION', 21);
  contents = raiseNumericProperty(contents, 'PROP_TARGET_SDK_VERSION', 34);
  contents = raiseVersionProperty(contents, 'PROP_BUILD_TOOLS_VERSION', '34.0.0');
  contents = enableBooleanProperty(contents, 'android.useAndroidX');
  if (contents !== fs.readFileSync(file, 'utf8')) fs.writeFileSync(file, contents);
}

function findNativeAppGradleFiles(propertiesFile) {
  const contents = fs.readFileSync(propertiesFile, 'utf8');
  const nativeDirectoryValue = readProperty(contents, 'NATIVE_DIR');
  if (!nativeDirectoryValue) return [];
  const nativeDirectory = path.isAbsolute(nativeDirectoryValue)
    ? nativeDirectoryValue
    : path.resolve(path.dirname(propertiesFile), nativeDirectoryValue);
  const gradleFile = path.join(nativeDirectory, 'app', 'build.gradle');
  return fs.existsSync(gradleFile) ? [gradleFile] : [];
}

function readProperty(contents, key) {
  const match = contents.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.+?)\\s*$`, 'm'));
  return match && match[1] ? match[1].trim() : null;
}

function uniqueFiles(files) {
  return [...new Set(files.map((file) => path.resolve(file)))];
}

function enableBooleanProperty(contents, key) {
  const pattern = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*=\\s*)(?:true|false)(\\s*)$`, 'mi');
  if (pattern.test(contents)) {
    return contents.replace(pattern, (line, prefix, suffix) => `${prefix}true${suffix}`);
  }
  return `${contents.replace(/\s*$/, '')}\n${key}=true\n`;
}

function raiseNumericProperty(contents, key, minimum) {
  const pattern = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*=\\s*)(-?\\d+)(\\s*)$`, 'm');
  return contents.replace(pattern, (line, prefix, value, suffix) => (
    Number(value) < minimum ? `${prefix}${minimum}${suffix}` : line
  ));
}

function raiseVersionProperty(contents, key, minimum) {
  const pattern = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*=\\s*)(\\d+(?:\\.\\d+)*)(\\s*)$`, 'm');
  return contents.replace(pattern, (line, prefix, value, suffix) => (
    compareVersions(value, minimum) < 0 ? `${prefix}${minimum}${suffix}` : line
  ));
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function patchGradle(file, nativeRoot, replay) {
  const javaDir = normalize(path.join(nativeRoot, 'android', 'src', 'main', 'java'));
  const javaDirs = [javaDir];
  if (replay) javaDirs.push(normalize(path.join(nativeRoot, 'replay', 'android', 'src', 'main', 'java')));
  replaceMarkedBlock(file, [
    BEGIN,
    'android {',
    `    sourceSets { main.java.srcDirs += [${javaDirs.map(dir => `'${escapeGroovy(dir)}'`).join(', ')}] }`,
    '}',
    'repositories {',
    "    maven { url 'https://mvnrepo.truewatch.com/repository/maven-releases' }",
    '}',
    'dependencies {',
    "    implementation 'com.truewatch.ft.mobile.sdk.tracker.agent:ft-sdk:1.7.6-alpha03'",
    "    implementation 'com.truewatch.ft.mobile.sdk.tracker.agent:ft-native:1.1.3'",
    ...(replay ? [`    implementation '${escapeGroovy(replay.androidReplay)}'`] : []),
    "    implementation 'com.google.code.gson:gson:2.10.1'",
    "    implementation platform('org.jetbrains.kotlin:kotlin-bom:1.8.22')",
    "    implementation 'androidx.appcompat:appcompat:1.1.0'",
    ...(replay ? [`    implementation '${escapeGroovy(replay.androidFragment)}'`] : []),
    '}',
    END,
  ].join('\n'), BEGIN, END, [[LEGACY_BEGIN, LEGACY_END]]);
}

function patchPodfile(file, nativeRoot, replay) {
  const iosDir = normalize(path.join(nativeRoot, 'ios'));
  const block = [
    POD_BEGIN,
    `pod 'FTCocosBridge', :path => '${escapeRuby(iosDir)}'`,
    ...(replay ? [`pod 'FTCocosReplayBridge', :path => '${escapeRuby(normalize(path.join(nativeRoot, 'replay', 'ios')))}'`] : []),
    POD_END,
  ].join('\n');
  const original = fs.readFileSync(file, 'utf8');
  const currentPattern = markedPattern(POD_BEGIN, POD_END);
  const legacyPodPattern = markedPattern(LEGACY_POD_BEGIN, LEGACY_POD_END);
  const legacyPattern = markedPattern(LEGACY_BEGIN, LEGACY_END);
  let next;
  if (currentPattern.test(original)) {
    next = replaceIndentedMarkedBlock(original, POD_BEGIN, POD_END, block);
  } else if (legacyPodPattern.test(original)) {
    next = replaceIndentedMarkedBlock(original, LEGACY_POD_BEGIN, LEGACY_POD_END, block);
  } else if (legacyPattern.test(original)) {
    next = replaceIndentedMarkedBlock(original, LEGACY_BEGIN, LEGACY_END, block);
  } else {
    const targetPattern = /(^[ \t]*target\s+['"][^'"]+['"]\s+do\s*$)/m;
    next = targetPattern.test(original)
      ? original.replace(targetPattern, `$1\n  ${block.replace(/\n/g, '\n  ')}`)
      : `${original.replace(/\s*$/, '')}\n\n${block}\n`;
  }
  if (next !== original) fs.writeFileSync(file, next);
}

function replaceIndentedMarkedBlock(contents, begin, end, block) {
  const pattern = new RegExp(`(^[\\t ]*)${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
  return contents.replace(pattern, (match, indent) => `${indent}${block.replace(/\n/g, `\n${indent}`)}`);
}

function findIosApplicationTarget(projectFile) {
  const contents = fs.readFileSync(projectFile, 'utf8');
  if (contents.includes('COCOS_SDK_XCODE_PROJECT')
    || fs.existsSync(path.join(path.dirname(projectFile), 'cocos-sdk-spm.json'))) {
    const { readProject, applicationTarget } = require('./install-spm.cjs');
    return applicationTarget(readProject(projectFile))?.[1].name || null;
  }
  const nativeTarget = /\/\* ([^*]+) \*\/ = \{\s*isa = PBXNativeTarget;([\s\S]*?)\n\s*\};/g;
  const targets = [];
  let match;
  while ((match = nativeTarget.exec(contents))) {
    if (!/productType = ["']?com\.apple\.product-type\.application["']?;/.test(match[2])) continue;
    const nameMatch = match[2].match(/\n\s*name = ("(?:[^"\\]|\\.)*"|[^;]+);/);
    targets.push(unquotePbxValue(nameMatch ? nameMatch[1] : match[1]));
  }
  return targets.find((target) => /(?:^|[-_.])mobile$/i.test(target))
    || targets.find((target) => /(?:^|[-_.])ios(?:$|[-_.])/i.test(target))
    || targets[0]
    || null;
}

function unquotePbxValue(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replace(/\\"/g, '"')
    : trimmed;
}

function createPodfile(file, projectFile, target) {
  const projectName = path.basename(path.dirname(projectFile));
  fs.writeFileSync(file, [
    "platform :ios, '12.0'",
    `project '${escapeRuby(projectName)}'`,
    '',
    `target '${escapeRuby(target)}' do`,
    'end',
    '',
  ].join('\n'));
}

function replaceMarkedBlock(file, block, begin = BEGIN, end = END, legacyMarkers = []) {
  const original = fs.readFileSync(file, 'utf8');
  const pattern = markedPattern(begin, end);
  let next;
  if (pattern.test(original)) {
    next = original.replace(pattern, block);
  } else {
    const legacy = legacyMarkers.find(([legacyBegin, legacyEnd]) => (
      markedPattern(legacyBegin, legacyEnd).test(original)
    ));
    next = legacy
      ? original.replace(markedPattern(legacy[0], legacy[1]), block)
      : `${original.replace(/\s*$/, '')}\n\n${block}\n`;
  }
  if (next !== original) fs.writeFileSync(file, next);
}

function markedPattern(begin, end) {
  return new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
}

function findFiles(root, maxDepth) {
  const result = [];
  function visit(directory, depth) {
    if (depth > maxDepth) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(child, depth + 1);
      else result.push(child);
    }
  }
  visit(root, 0);
  return result;
}

function normalize(value) { return value.split(path.sep).join('/'); }
function escapeGroovy(value) { return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function escapeRuby(value) { return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function readIosDependencyManager(buildRoot, extensionRoot) {
  for (const start of [buildRoot, extensionRoot]) {
    let directory = path.resolve(start);
    while (true) {
      const file = path.join(directory, 'cocos-sdk.config.json');
      if (fs.existsSync(file)) {
        const config = JSON.parse(fs.readFileSync(file, 'utf8'));
        const manager = config.ios?.dependencyManager ?? 'cocoapods';
        if (!['spm', 'cocoapods'].includes(manager)) {
          throw new Error(`[cocos-sdk] Invalid ios.dependencyManager in ${file}: expected spm or cocoapods.`);
        }
        return manager;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return 'cocoapods';
}

function migrateManagedPods(podfiles, logger) {
  for (const file of podfiles) {
    const original = fs.readFileSync(file, 'utf8');
    let next = original;
    for (const [begin, end] of [
      [POD_BEGIN, POD_END], [LEGACY_POD_BEGIN, LEGACY_POD_END], [LEGACY_BEGIN, LEGACY_END],
      ['# COCOS_HYBRID_SAMPLE_BEGIN', '# COCOS_HYBRID_SAMPLE_END'],
    ]) next = next.replace(markedPattern(begin, end), '');
    if (/^\s*pod\s+['"](?:FTCocosBridge|FTCocosReplayBridge|HybridSampleHost|TrueWatchSDK)(?:\/[^'"]*)?['"]/m.test(next)) {
      throw new Error(`[cocos-sdk] Remove the manually declared native SDK Pod from ${file} before switching to SPM.`);
    }
    if (next !== original) fs.writeFileSync(file, next);
    const directory = path.dirname(file);
    const existingLock = path.join(directory, 'Podfile.lock');
    const hasSDKPods = fs.existsSync(existingLock)
      && /^\s*- (?:FTCocosBridge|FTCocosReplayBridge|HybridSampleHost|TrueWatchSDK)(?:\/|\s|:)/m.test(fs.readFileSync(existingLock, 'utf8'));
    if (next === original && !hasSDKPods) continue;
    if (fs.existsSync(path.join(directory, 'Podfile.lock')) || fs.existsSync(path.join(directory, 'Pods'))) {
      logger.info('[cocos-sdk] Updating existing Pods integration for the SPM switch.');
      try {
        execFileSync('pod', ['install'], { cwd: directory, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
      } catch (error) {
        fs.writeFileSync(file, original);
        throw new Error(`[cocos-sdk] Unable to update existing Pods in ${directory}: ${error.message}`);
      }
      const lock = path.join(directory, 'Podfile.lock');
      if (fs.existsSync(lock) && /^\s*- TrueWatchSDK(?:\/|\s|:)/m.test(fs.readFileSync(lock, 'utf8'))) {
        throw new Error(`[cocos-sdk] Another Pod still depends on the native SDK in ${lock}; migrate that dependency before using SPM.`);
      }
    }
  }
}

module.exports = { installNative, readIosDependencyManager };
