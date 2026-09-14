import { createRequire } from 'node:module';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const ANDROID_BEGIN = '/* COCOS_HYBRID_SAMPLE_BEGIN */';
const ANDROID_END = '/* COCOS_HYBRID_SAMPLE_END */';
const IOS_BEGIN = '// COCOS_HYBRID_SAMPLE_BEGIN';
const IOS_END = '// COCOS_HYBRID_SAMPLE_END';
const POD_BEGIN = '# COCOS_HYBRID_SAMPLE_BEGIN';
const POD_END = '# COCOS_HYBRID_SAMPLE_END';
const ANDROID_MANIFEST_BEGIN = '<!-- COCOS_HYBRID_NATIVE_PAGE_BEGIN -->';
const ANDROID_MANIFEST_END = '<!-- COCOS_HYBRID_NATIVE_PAGE_END -->';
const FT_PLUGIN_BEGIN = '/* COCOS_HYBRID_FT_PLUGIN_CLASSPATH_BEGIN */';
const FT_PLUGIN_END = '/* COCOS_HYBRID_FT_PLUGIN_CLASSPATH_END */';

const projectRoot = path.resolve(readOption('--project') || process.cwd());
const creator = readCreator();
const buildRootValue = readOption('--build-root');

if (!buildRootValue) fail('Pass the generated native directory with --build-root.');
const buildRoot = path.resolve(projectRoot, buildRootValue);
if (!existsSync(buildRoot) || !statSync(buildRoot).isDirectory()) {
  fail(`Native build directory does not exist: ${buildRoot}`);
}

const extensionRoot = path.join(
  projectRoot,
  creator === '3' ? 'extensions/truewatch-cocos-sdk' : 'packages/truewatch-cocos-sdk',
);
const bridgeInstaller = path.join(extensionRoot, 'install-native.cjs');
if (!existsSync(bridgeInstaller)) {
  fail(`Local SDK build extension is missing. Run npm run setup first: ${extensionRoot}`);
}

const nativeHostSource = path.join(projectRoot, 'native-host');
const requiredHostFiles = [
  'android/HybridSampleSdk.java',
  'android/HybridSampleEnvironment.java',
  'android/HybridSampleApplication.java',
  'android/HybridSampleNativeActivity.java',
  'ios/HybridSampleSDK.h',
  'ios/HybridSampleSDK.m',
  'ios/HybridSampleEnvironment.generated.h',
  'ios/HybridSampleHost.podspec',
];
for (const relativePath of requiredHostFiles) {
  if (!existsSync(path.join(nativeHostSource, relativePath))) {
    fail(`Missing ${relativePath}. Run npm run configure before native:install.`);
  }
}

const { installNative, readIosDependencyManager } = require(bridgeInstaller);
const useSPM = readIosDependencyManager?.(buildRoot, extensionRoot) === 'spm';
installNative(buildRoot, extensionRoot, console);

const nativeHostBuild = path.join(buildRoot, 'hybrid-sample-native');
copyDirectory(nativeHostSource, nativeHostBuild);

const searchRoots = collectSearchRoots(buildRoot);
const files = unique(searchRoots.flatMap((root) => findFiles(root, 12)));
const gradleFiles = files.filter((file) => /(?:^|\/)app\/build\.gradle$/.test(normalize(file)));
const rootGradleFiles = files.filter((file) => (
  path.basename(file) === 'build.gradle'
  && existsSync(path.join(path.dirname(file), 'settings.gradle'))
));
const appActivities = files.filter((file) => path.basename(file) === 'AppActivity.java');
const androidManifests = files.filter((file) => /(?:^|\/)app\/AndroidManifest\.xml$/.test(normalize(file)));
const podfiles = files.filter((file) => path.basename(file) === 'Podfile');
const spmProjects = useSPM ? files.filter((file) => (
  path.basename(file) === 'project.pbxproj'
  && readFileSync(file, 'utf8').includes('COCOS_SDK_XCODE_PROJECT')
)) : [];
const iosProjectCount = useSPM ? spmProjects.length : podfiles.length;
const iosLaunchFiles = files.filter((file) => ['AppDelegate.mm', 'AppController.mm'].includes(path.basename(file)));

gradleFiles.forEach((file) => patchGradle(file, path.join(nativeHostBuild, 'android')));
if (creator === '3') {
  gradleFiles.forEach((file) => patchAndroidPageAlignment(path.resolve(path.dirname(file), '../CMakeLists.txt')));
}
appActivities.forEach(patchAndroidLaunch);
rootGradleFiles.forEach(patchFTPluginClasspath);
androidManifests.forEach((file) => patchAndroidManifest(file, creator));
if (useSPM) {
  const { installSwiftPackage } = require(path.join(extensionRoot, 'install-spm.cjs'));
  const hostPackage = path.join(nativeHostBuild, 'HybridSampleHost');
  copyDirectory(path.join(nativeHostSource, 'ios'), hostPackage);
  spmProjects.forEach((file) => installSwiftPackage(file, hostPackage, 'HybridSampleHost'));
} else {
  podfiles.forEach((file) => patchPodfile(file, path.join(nativeHostBuild, 'ios')));
}
iosLaunchFiles.forEach(patchIOSLaunch);

if (gradleFiles.length === 0 && iosProjectCount === 0) {
  fail('No Android app/build.gradle or iOS application project was found. Build a native platform in Creator first.');
}
if (gradleFiles.length > 0 && appActivities.length === 0) {
  fail('Android project found, but AppActivity.java could not be located.');
}
if (gradleFiles.length > 0 && rootGradleFiles.length === 0) {
  fail('Android project found, but the root build.gradle for ft-plugin could not be located.');
}
if (gradleFiles.length > 0 && androidManifests.length === 0) {
  fail('Android project found, but app/AndroidManifest.xml could not be located.');
}
if (iosProjectCount > 0 && iosLaunchFiles.length === 0) {
  fail('iOS project found, but AppDelegate.mm/AppController.mm could not be located.');
}

process.stdout.write(
  `[cocos-hybrid-sample] Installed Creator ${creator} native host `
  + `(${gradleFiles.length} Android, ${iosProjectCount} iOS project files).\n`,
);
if (!useSPM && podfiles.length > 0) {
  process.stdout.write('[cocos-hybrid-sample] Run pod install in the generated iOS project directory.\n');
}

function collectSearchRoots(root) {
  const roots = [root];
  const files = findFiles(root, 7);
  for (const file of files) {
    if (path.basename(file) !== 'gradle.properties') continue;
    const value = readProperty(readFileSync(file, 'utf8'), 'NATIVE_DIR');
    if (!value) continue;
    const nativeRoot = path.isAbsolute(value) ? value : path.resolve(path.dirname(file), value);
    if (existsSync(nativeRoot) && statSync(nativeRoot).isDirectory()) roots.push(nativeRoot);
  }
  if (files.some((file) => ['Podfile', 'project.pbxproj'].includes(path.basename(file)))) {
    const creator3IOSRoot = path.join(projectRoot, 'native/engine/ios');
    if (existsSync(creator3IOSRoot) && statSync(creator3IOSRoot).isDirectory()) roots.push(creator3IOSRoot);
  }
  return unique(roots);
}

function patchGradle(file, androidHostRoot) {
  const javaDirectory = normalize(androidHostRoot);
  const block = [
    ANDROID_BEGIN,
    'android {',
    `    sourceSets { main.java.srcDirs += ['${escapeSingleQuoted(javaDirectory)}'] }`,
    '}',
  ];
  block.push(
    "apply plugin: 'ft-plugin'",
    'FTExt {',
    '    showLog = true',
    '    instrumentHttpURLConnection = true',
    '}',
    'dependencies {',
    "    implementation 'com.squareup.okhttp3:okhttp:4.5.0'",
    '}',
  );
  block.push(ANDROID_END);
  replaceMarkedBlock(file, ANDROID_BEGIN, ANDROID_END, block.join('\n'));
}

function patchAndroidPageAlignment(file) {
  if (!existsSync(file) || !/add_library\(\s*\$\{CC_LIB_NAME\}\s+SHARED\b/.test(readFileSync(file, 'utf8'))) {
    fail(`Unable to locate the Creator 3 shared library target in ${file}`);
  }
  const begin = '# COCOS_HYBRID_ANDROID_PAGE_ALIGNMENT_BEGIN';
  const end = '# COCOS_HYBRID_ANDROID_PAGE_ALIGNMENT_END';
  replaceMarkedBlock(file, begin, end, [
    begin,
    '# Older NDKs need both options for 16 KB LOAD segments and GNU_RELRO boundaries.',
    '# Scope this to libcocos; prebuilt shared libraries must be checked separately.',
    'set_property(TARGET ${CC_LIB_NAME} APPEND_STRING PROPERTY LINK_FLAGS',
    '    " -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384")',
    end,
  ].join('\n'));
}

function patchFTPluginClasspath(file) {
  const source = readFileSync(file, 'utf8');
  const block = [
    FT_PLUGIN_BEGIN,
    'repositories {',
    "    maven { url 'https://mvnrepo.truewatch.com/repository/maven-releases' }",
    '}',
    'dependencies {',
    "    classpath 'com.truewatch.ft.mobile.sdk.tracker.plugin:ft-plugin:1.3.9-alpha01'",
    '}',
    FT_PLUGIN_END,
  ].join('\n');
  let next;
  if (markedPattern(FT_PLUGIN_BEGIN, FT_PLUGIN_END).test(source)) {
    next = source.replace(markedPattern(FT_PLUGIN_BEGIN, FT_PLUGIN_END), block);
  } else if (/buildscript\s*\{/.test(source)) {
    next = source.replace(/buildscript\s*\{/, (match) => `${match}\n    ${block.replace(/\n/g, '\n    ')}`);
  } else {
    fail(`Unable to locate buildscript block in ${file}`);
  }
  if (next !== source) writeFileSync(file, next);
}

function patchAndroidManifest(file, creatorVersion) {
  const source = readFileSync(file, 'utf8');
  const cocosActivity = creatorVersion === '3'
    ? 'com.cocos.game.AppActivity'
    : 'org.cocos2dx.javascript.AppActivity';
  const activityName = `android:name="${cocosActivity}"`;
  const activityNameIndex = source.indexOf(activityName);
  const activityStart = activityNameIndex >= 0 ? source.lastIndexOf('<activity', activityNameIndex) : -1;
  const openingTagEnd = activityStart >= 0 ? source.indexOf('>', activityStart) : -1;
  const selfClosing = openingTagEnd >= 0 && source[openingTagEnd - 1] === '/';
  const activityEndStart = selfClosing ? openingTagEnd : source.indexOf('</activity>', openingTagEnd);
  if (activityStart < 0 || openingTagEnd < 0 || activityEndStart < 0) {
    fail(`Unable to locate ${cocosActivity} in ${file}`);
  }
  const activityEnd = selfClosing ? openingTagEnd + 1 : activityEndStart + '</activity>'.length;
  let appActivity = source.slice(activityStart, activityEnd);
  if (creatorVersion === '2') {
    const openingTag = appActivity.match(/<activity\b[^>]*>/)?.[0];
    if (!openingTag) fail(`Unable to locate ${cocosActivity} activity tag in ${file}`);
    const withCocosProcess = /\bandroid:process\s*=/.test(openingTag)
      ? openingTag.replace(/\bandroid:process\s*=\s*"[^"]*"/, 'android:process=":cocos"')
      : openingTag.replace(/(\/?>)$/, ' android:process=":cocos"$1');
    appActivity = appActivity.replace(openingTag, withCocosProcess);
  }
  const withoutLauncher = appActivity.replace(/\s*<intent-filter>[\s\S]*?<\/intent-filter>/g, (filter) => (
    filter.includes('android.intent.action.MAIN') && filter.includes('android.intent.category.LAUNCHER')
      ? ''
      : filter
  ));
  let next = `${source.slice(0, activityStart)}${withoutLauncher}${source.slice(activityEnd)}`;
  const applicationTag = next.match(/<application\b[^>]*>/)?.[0];
  if (!applicationTag) fail(`Unable to locate application element in ${file}`);
  const applicationClass = 'android:name="com.truewatch.cocos.sample.HybridSampleApplication"';
  if (!applicationTag.includes(applicationClass)) {
    if (/\bandroid:name\s*=/.test(applicationTag)) {
      fail(`The sample already declares a custom Android Application in ${file}`);
    }
    next = next.replace(applicationTag, applicationTag.replace(/>$/, ` ${applicationClass}>`));
  }
  const nativeActivity = [
    ANDROID_MANIFEST_BEGIN,
    ...(creatorVersion === '2' ? [
      '<provider android:name="com.ft.sdk.cocos.FTCocosBridgeProvider" android:authorities="${applicationId}.ft.cocos.bridge" android:exported="false"/>',
    ] : []),
    '<activity android:name="com.truewatch.cocos.sample.HybridSampleNativeActivity" android:screenOrientation="sensorLandscape" android:label="@string/app_name" android:theme="@android:style/Theme.Material.NoActionBar" android:launchMode="singleTask" android:exported="true">',
    '  <intent-filter>',
    '    <action android:name="android.intent.action.MAIN"/>',
    '    <category android:name="android.intent.category.LAUNCHER"/>',
    '  </intent-filter>',
    '</activity>',
    ANDROID_MANIFEST_END,
  ].join('\n');
  if (markedPattern(ANDROID_MANIFEST_BEGIN, ANDROID_MANIFEST_END).test(next)) {
    next = next.replace(markedPattern(ANDROID_MANIFEST_BEGIN, ANDROID_MANIFEST_END), nativeActivity);
  } else if (next.includes('</application>')) {
    next = next.replace('</application>', `  ${nativeActivity.replace(/\n/g, '\n  ')}\n</application>`);
  } else {
    fail(`Unable to locate application element in ${file}`);
  }
  if (next !== source) writeFileSync(file, next);
}

function patchAndroidLaunch(file) {
  let source = readFileSync(file, 'utf8');
  const importLine = 'import com.truewatch.cocos.sample.HybridSampleSdk;';
  if (!source.includes(importLine)) {
    const packageMatch = source.match(/^package\s+[^;]+;\s*$/m);
    if (!packageMatch) fail(`Unable to locate the Java package declaration in ${file}`);
    source = source.replace(packageMatch[0], `${packageMatch[0]}\n\n${importLine}`);
  }

  const block = [
    ANDROID_BEGIN,
    'HybridSampleSdk.start();',
    ANDROID_END,
  ].join('\n');
  const existing = markedPattern(ANDROID_BEGIN, ANDROID_END);
  if (existing.test(source)) {
    source = replaceIndentedMarkedBlock(source, ANDROID_BEGIN, ANDROID_END, block);
  } else {
    const onCreate = source.match(/protected\s+void\s+onCreate\s*\([^)]*\)\s*\{[\s\S]*?super\.onCreate\s*\([^;]*\);/);
    if (!onCreate) fail(`Unable to locate AppActivity.onCreate in ${file}`);
    source = source.replace(onCreate[0], `${onCreate[0]}\n        ${block.replace(/\n/g, '\n        ')}`);
  }
  writeFileSync(file, source);
}

function patchPodfile(file, iosHostRoot) {
  const block = [
    POD_BEGIN,
    `pod 'HybridSampleHost', :path => '${escapeSingleQuoted(normalize(iosHostRoot))}'`,
    POD_END,
  ].join('\n');
  const source = readFileSync(file, 'utf8');
  let next;
  if (markedPattern(POD_BEGIN, POD_END).test(source)) {
    next = replaceIndentedMarkedBlock(source, POD_BEGIN, POD_END, block);
  } else {
    const targetPattern = /(^[ \t]*target\s+['"][^'"]+['"]\s+do\s*$)/m;
    next = targetPattern.test(source)
      ? source.replace(targetPattern, `$1\n  ${block.replace(/\n/g, '\n  ')}`)
      : `${source.replace(/\s*$/, '')}\n\n${block}\n`;
  }
  if (next !== source) writeFileSync(file, next);
}

function patchIOSLaunch(file) {
  let source = readFileSync(file, 'utf8');
  const importLine = '#import <HybridSampleHost/HybridSampleSDK.h>';
  if (!source.includes(importLine)) {
    const firstImport = source.match(/^#import\s+[^\r\n]+$/m);
    if (!firstImport) fail(`Unable to locate an Objective-C import in ${file}`);
    source = source.replace(firstImport[0], `${firstImport[0]}\n${importLine}`);
  }

  const block = [
    IOS_BEGIN,
    '[HybridSampleSDK start];',
    IOS_END,
  ].join('\n');
  if (markedPattern(IOS_BEGIN, IOS_END).test(source)) {
    source = replaceIndentedMarkedBlock(source, IOS_BEGIN, IOS_END, block);
  } else {
    const selector = source.indexOf('didFinishLaunchingWithOptions');
    const methodStart = selector >= 0 ? source.lastIndexOf('- (BOOL)', selector) : -1;
    const methodBody = methodStart >= 0 ? source.indexOf('{', selector) : -1;
    if (methodBody < 0) fail(`Unable to locate didFinishLaunchingWithOptions in ${file}`);
    source = `${source.slice(0, methodBody + 1)}\n    ${block.replace(/\n/g, '\n    ')}${source.slice(methodBody + 1)}`;
  }
  writeFileSync(file, source);
}

function replaceMarkedBlock(file, begin, end, block) {
  const source = readFileSync(file, 'utf8');
  const pattern = markedPattern(begin, end);
  const next = pattern.test(source)
    ? source.replace(pattern, block)
    : `${source.replace(/\s*$/, '')}\n\n${block}\n`;
  if (next !== source) writeFileSync(file, next);
}

function replaceIndentedMarkedBlock(source, begin, end, block) {
  const pattern = new RegExp(`(^[\\t ]*)${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
  return source.replace(pattern, (match, indent) => `${indent}${block.replace(/\n/g, `\n${indent}`)}`);
}

function markedPattern(begin, end) {
  return new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
}

function copyDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

function findFiles(root, maxDepth) {
  const files = [];
  function visit(directory, depth) {
    if (depth > maxDepth) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.git', 'cocos-sdk-native', 'hybrid-sample-native'].includes(entry.name)) continue;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(child, depth + 1);
      else if (entry.isFile()) files.push(child);
    }
  }
  visit(root, 0);
  return files;
}

function readProperty(source, key) {
  const match = source.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.+?)\\s*$`, 'm'));
  return match && match[1] ? match[1].trim() : undefined;
}

function readCreator() {
  const value = readOption('--creator');
  if (value !== '2' && value !== '3') fail('--creator must be 2 or 3.');
  return value;
}

function readOption(name) {
  const argumentsList = process.argv.slice(2);
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

function unique(values) {
  return [...new Set(values.map((value) => path.resolve(value)))];
}

function normalize(value) {
  return value.split(path.sep).join('/');
}

function escapeSingleQuoted(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fail(message) {
  process.stderr.write(`[cocos-hybrid-sample] ${message}\n`);
  process.exit(1);
}
