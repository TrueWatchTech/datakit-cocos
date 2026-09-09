'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
  const nativeSource = path.join(extensionRoot, 'native');
  if (!fs.existsSync(nativeSource)) {
    logger.warn(`[cocos-sdk] Native bridge not found at ${nativeSource}`);
    return;
  }
  const buildNative = path.join(buildRoot, 'cocos-sdk-native');
  copyDirectory(nativeSource, buildNative);
  const files = findFiles(buildRoot, 7);
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
  if (podfiles.length === 0) {
    iosApplicationProjects.forEach(({ projectFile, target }) => {
      const projectDirectory = path.dirname(path.dirname(projectFile));
      const podfile = path.join(projectDirectory, 'Podfile');
      if (!fs.existsSync(podfile)) createPodfile(podfile, projectFile, target);
      podfiles.push(podfile);
    });
  }
  iosApplicationProjects.forEach(({ projectFile, target }) => {
    patchCocos2IosConfiguration(projectFile, target);
  });
  gradleFiles.forEach((file) => patchGradle(file, buildNative));
  gradlePropertiesFiles.forEach(patchGradleProperties);
  podfiles.forEach((file) => patchPodfile(file, buildNative));
  logger.info(
    `[cocos-sdk] Installed native bridge (${gradleFiles.length} Android, ${podfiles.length} iOS project files).`,
  );
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

function patchGradle(file, nativeRoot) {
  const javaDir = normalize(path.join(nativeRoot, 'android', 'src', 'main', 'java'));
  replaceMarkedBlock(file, [
    BEGIN,
    'android {',
    `    sourceSets { main.java.srcDirs += ['${escapeGroovy(javaDir)}'] }`,
    '}',
    'repositories {',
    "    maven { url 'https://mvnrepo.truewatch.com/repository/maven-releases' }",
    '}',
    'dependencies {',
    "    implementation 'com.truewatch.ft.mobile.sdk.tracker.agent:ft-sdk:1.7.6-alpha02'",
    "    implementation 'com.truewatch.ft.mobile.sdk.tracker.agent:ft-native:1.1.3'",
    "    implementation 'com.truewatch.ft.mobile.sdk.tracker.agent:ft-session-replay:0.1.9-alpha02'",
    "    implementation 'com.google.code.gson:gson:2.10.1'",
    "    implementation platform('org.jetbrains.kotlin:kotlin-bom:1.8.22')",
    "    implementation 'androidx.appcompat:appcompat:1.1.0'",
    "    implementation 'androidx.fragment:fragment:1.8.0'",
    '}',
    END,
  ].join('\n'), BEGIN, END, [[LEGACY_BEGIN, LEGACY_END]]);
}

function patchPodfile(file, nativeRoot) {
  const iosDir = normalize(path.join(nativeRoot, 'ios'));
  const block = [
    POD_BEGIN,
    `pod 'FTCocosBridge', :path => '${escapeRuby(iosDir)}'`,
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

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
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

module.exports = { installNative };
