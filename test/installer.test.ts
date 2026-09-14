import { createReplayExtension } from './replay-fixtures';
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { installNative } = require('../integrations/shared/install-native.cjs') as {
  installNative: (buildRoot: string, extensionRoot: string, logger: unknown) => void;
};
const temporaryRoots: string[] = [];

afterEach(() => {
  temporaryRoots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('native build integration', () => {
  it.each(['AppDelegate.cpp', 'Game.cpp'])('installs the async file binding before scripts start in %s', (name) => {
    const root = mkdtempSync(join(tmpdir(), 'cocos-replay-install-'));
    temporaryRoots.push(root);
    const classes = join(root, 'Classes');
    mkdirSync(classes);
    const entry = join(classes, name);
    const anchor = name === 'Game.cpp' ? 'BaseGame::init();' : 'se->start();';
    writeFileSync(entry, `void start() {\n  ${anchor}\n}\n`);
    installNative(root, createReplayExtension(root), { info() {}, warn() {} });
    const first = readFileSync(entry, 'utf8');
    installNative(root, createReplayExtension(root), { info() {}, warn() {} });
    expect(readFileSync(entry, 'utf8')).toBe(first);
    expect(first.indexOf('installReplayFileBridge();')).toBeLessThan(first.indexOf(anchor));
    expect(first).toContain('"cocos-sdk-replay/FTReplayFileBridge.h"');
    expect(readFileSync(join(classes, 'cocos-sdk-replay', 'FTReplayFileWorker.h'), 'utf8'))
      .toContain('class ReplayFileWorker');
  });

  it('installs the binding in Creator 3 native sources outside the build directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'cocos-replay-external-'));
    temporaryRoots.push(root);
    const build = join(root, 'build');
    const native = join(root, 'native', 'engine');
    const classes = join(native, 'common', 'Classes');
    mkdirSync(build, { recursive: true });
    mkdirSync(classes, { recursive: true });
    writeFileSync(join(build, 'gradle.properties'), `NATIVE_DIR=${join(native, 'android')}\n`);
    const entry = join(classes, 'Game.cpp');
    writeFileSync(entry, 'void start() { BaseGame::init(); }');
    installNative(build, createReplayExtension(root), { info() {}, warn() {} });
    expect(readFileSync(entry, 'utf8')).toContain('ft_cocos::installReplayFileBridge();');
  });

  it('ships native-host attachment and recorder ownership bridge methods', () => {
    const android = readFileSync(
      resolve('native/android/src/main/java/com/ft/sdk/cocos/FTCocosBridge.java'),
      'utf8',
    );
    const ios = readFileSync(resolve('native/ios/FTCocosBridge.m'), 'utf8');

    expect(android).toContain('case "hybrid.attach"');
    expect(android).toContain('FTBridgeTransport.invoke("sdk", method, payload)');
    const androidReplay = readFileSync(resolve('src/session-replay/native/android/src/main/java/com/ft/sdk/cocos/FTCocosReplayBridge.java'), 'utf8');
    const iosReplay = readFileSync(resolve('src/session-replay/native/ios/FTCocosReplayBridge.m'), 'utf8');
    expect(android).not.toContain('SessionReplayManager');
    expect(ios).not.toContain('FTSessionReplay.h');
    expect(android).toContain('FTSdk.appendGlobalContext(COCOS_SDK_VERSION_KEY');
    expect(androidReplay).toContain('"setExternalRecorderActive"');
    expect(androidReplay).toContain('.writeExternalSegment(');
    expect(androidReplay).toContain('.setExternalRecordCount(');
    expect(android).not.toContain('.writeFlutterSegment(');
    expect(android).not.toContain('.setFlutterRecordCount(');
    const provider = readFileSync(
      resolve('native/android/src/main/java/com/ft/sdk/cocos/FTCocosBridgeProvider.java'),
      'utf8',
    );
    expect(provider).toContain('FTCocosBridgeModules.invokeLocal(');
    expect(ios).toContain('@"hybrid.attach"');
    expect(ios).toContain('[FTMobileAgent appendGlobalContext:');
    expect(iosReplay).toContain('@"setExternalRecorderActive:"');
  });

  it('references the published native SDK releases required by Cocos replay', () => {
    const installer = readFileSync(resolve('integrations/shared/install-native.cjs'), 'utf8');
    const podspec = readFileSync(resolve('native/ios/FTCocosBridge.podspec'), 'utf8');

    expect(installer).toContain('ft-sdk:1.7.6-alpha03');
    expect(readFileSync('packages/cocos-session-replay/native-integration.json', 'utf8')).toContain('ft-session-replay:0.1.9-alpha03');
    expect(podspec).toContain("s.dependency 'TrueWatchSDK/Agent', '1.6.8-alpha.5'");
    expect(podspec).not.toContain("TrueWatchSDK/FTSessionReplay");
    expect(readFileSync('src/session-replay/native/ios/FTCocosReplayBridge.podspec', 'utf8')).toContain("s.dependency 'TrueWatchSDK/FTSessionReplay', '1.6.8-alpha.5'");
  });

  it('patches generated Gradle and Pod projects idempotently', () => {
    const root = mkdtempSync(join(tmpdir(), 'cocos-sdk-installer-'));
    temporaryRoots.push(root);
    const android = join(root, 'android', 'app');
    const ios = join(root, 'ios');
    mkdirSync(android, { recursive: true });
    mkdirSync(ios, { recursive: true });
    const gradle = join(android, 'build.gradle');
    const gradleProperties = join(root, 'android', 'gradle.properties');
    const podfile = join(ios, 'Podfile');
    writeFileSync(gradle, 'plugins { id "com.android.application" }\n');
    writeFileSync(gradleProperties, [
      'PROP_COMPILE_SDK_VERSION=28',
      'PROP_MIN_SDK_VERSION=16',
      'PROP_TARGET_SDK_VERSION=28',
      'PROP_BUILD_TOOLS_VERSION=28.0.3',
      '',
    ].join('\n'));
    writeFileSync(podfile, [
      "platform :ios, '12.0'",
      "target 'Example-mobile' do",
      'end',
      '',
    ].join('\n'));

    const extensionRoot = createReplayExtension(root);
    const quiet = { info() {}, warn() {} };
    installNative(root, extensionRoot, quiet);
    installNative(root, extensionRoot, quiet);

    const gradleText = readFileSync(gradle, 'utf8');
    const gradlePropertiesText = readFileSync(gradleProperties, 'utf8');
    const podfileText = readFileSync(podfile, 'utf8');
    expect(gradleText.match(/COCOS_SDK_BEGIN/g)).toHaveLength(1);
    expect(gradleText).toContain('https://mvnrepo.truewatch.com/repository/maven-releases');
    expect(gradleText).toContain('ft-session-replay:0.1.9-alpha03');
    expect(gradleText).toContain('com.google.code.gson:gson:2.10.1');
    expect(gradleText).toContain("platform('org.jetbrains.kotlin:kotlin-bom:1.8.22')");
    expect(gradlePropertiesText).toContain('PROP_COMPILE_SDK_VERSION=34');
    expect(gradlePropertiesText).toContain('PROP_MIN_SDK_VERSION=21');
    expect(gradlePropertiesText).toContain('PROP_TARGET_SDK_VERSION=34');
    expect(gradlePropertiesText).toContain('PROP_BUILD_TOOLS_VERSION=34.0.0');
    expect(gradlePropertiesText).toContain('android.useAndroidX=true');
    expect(podfileText.match(/COCOS_SDK_BEGIN/g)).toHaveLength(1);
    expect(podfileText).toContain("pod 'FTCocosBridge'");
    expect(podfileText).toContain("target 'Example-mobile' do\n  # COCOS_SDK_BEGIN");
    expect(podfileText).toContain("\n  pod 'FTCocosBridge'");
    expect(podfileText).toContain('\n  # COCOS_SDK_END');
    expect(podfileText).not.toContain('/* COCOS_SDK_BEGIN */');
  });

  it('patches the Creator 3 app module referenced by NATIVE_DIR before make', () => {
    const root = mkdtempSync(join(tmpdir(), 'cocos-sdk-creator3-native-dir-'));
    temporaryRoots.push(root);
    const buildRoot = join(root, 'build', 'android');
    const gradleProject = join(buildRoot, 'proj');
    const nativeApp = join(root, 'native', 'engine', 'android', 'app');
    const extension = join(root, 'extension');
    mkdirSync(gradleProject, { recursive: true });
    mkdirSync(nativeApp, { recursive: true });
    mkdirSync(join(extension, 'native', 'android'), { recursive: true });
    createReplayExtension(root, extension);
    writeFileSync(join(extension, 'native', 'android', 'bridge.txt'), 'bridge');
    writeFileSync(
      join(gradleProject, 'gradle.properties'),
      `NATIVE_DIR=${join(root, 'native', 'engine', 'android')}\n`,
    );
    const gradle = join(nativeApp, 'build.gradle');
    writeFileSync(gradle, 'plugins { id "com.android.application" }\n');

    installNative(buildRoot, extension, { info() {}, warn() {} });

    const gradleText = readFileSync(gradle, 'utf8');
    expect(gradleText).toContain('ft-session-replay:0.1.9-alpha03');
    expect(gradleText).toContain('com.google.code.gson:gson:2.10.1');
    expect(gradleText).toContain(join(
      buildRoot,
      'cocos-sdk-native',
      'android',
      'src',
      'main',
      'java',
    ));
  });

  it('keeps the most specific Creator 3 build output as the native source root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cocos-sdk-creator3-hook-order-'));
    temporaryRoots.push(root);
    const project = join(root, 'project');
    const buildRoot = join(project, 'build', 'android');
    const gradleProject = join(buildRoot, 'proj');
    const nativeApp = join(project, 'native', 'engine', 'android', 'app');
    const extension = join(root, 'extension');
    mkdirSync(join(extension, 'dist'), { recursive: true });
    mkdirSync(gradleProject, { recursive: true });
    mkdirSync(nativeApp, { recursive: true });
    mkdirSync(join(extension, 'native', 'android'), { recursive: true });
    cpSync(resolve('integrations/creator3/dist/hooks.js'), join(extension, 'dist', 'hooks.js'));
    cpSync(resolve('integrations/shared/install-native.cjs'), join(extension, 'install-native.cjs'));
    for (const helper of ['managed-assets.cjs', 'legacy-asset-hashes.json']) cpSync(resolve('integrations/shared', helper), join(extension, helper));
    createReplayExtension(root, extension);
    writeFileSync(join(extension, 'native', 'android', 'bridge.txt'), 'bridge');
    writeFileSync(
      join(gradleProject, 'gradle.properties'),
      `NATIVE_DIR=${join(project, 'native', 'engine', 'android')}\n`,
    );
    writeFileSync(join(buildRoot, 'cocos.compile.config.json'), '{}\n');
    const gradle = join(nativeApp, 'build.gradle');
    writeFileSync(gradle, 'plugins { id "com.android.application" }\n');

    const previousEditor = (globalThis as { Editor?: unknown }).Editor;
    (globalThis as { Editor?: unknown }).Editor = { Project: { path: project } };
    try {
      const hooks = require(join(extension, 'dist', 'hooks.js')) as {
        onAfterBuild: (options: object, result: object) => Promise<void>;
      };
      await hooks.onAfterBuild({ outputName: 'android', buildPath: 'project://build' }, {
        paths: {
          compileConfig: join(buildRoot, 'cocos.compile.config.json'),
          project,
        },
      });
    } finally {
      (globalThis as { Editor?: unknown }).Editor = previousEditor;
    }

    const gradleText = readFileSync(gradle, 'utf8');
    expect(gradleText).toContain(join(
      buildRoot,
      'cocos-sdk-native',
      'android',
      'src',
      'main',
      'java',
    ));
    expect(gradleText).not.toContain(join(
      project,
      'cocos-sdk-native',
      'android',
      'src',
      'main',
      'java',
    ));
  });

  it('creates a Podfile for a generated Cocos iOS application target', () => {
    const root = mkdtempSync(join(tmpdir(), 'cocos-sdk-installer-ios-'));
    temporaryRoots.push(root);
    const ios = join(root, 'build', 'ios', 'proj');
    const xcodeProject = join(ios, 'Example.xcodeproj');
    const iosConfigDirectory = join(ios, 'ios');
    mkdirSync(xcodeProject, { recursive: true });
    mkdirSync(iosConfigDirectory, { recursive: true });
    writeFileSync(join(iosConfigDirectory, 'UserConfigIOS.debug.xcconfig'), '// Debug\n');
    writeFileSync(join(iosConfigDirectory, 'UserConfigIOS.release.xcconfig'), '// Release\n');
    writeFileSync(join(xcodeProject, 'project.pbxproj'), [
      '/* Begin PBXNativeTarget section */',
      'A0 /* Example-desktop */ = {',
      '  isa = PBXNativeTarget;',
      '  name = "Example-desktop";',
      '  productName = Example Product;',
      '  productType = "com.apple.product-type.application";',
      '};',
      'A1 /* Example-mobile */ = {',
      '  isa = PBXNativeTarget;',
      '  name = "Example-mobile";',
      '  productName = Example Product;',
      '  productType = "com.apple.product-type.application";',
      '};',
      '/* End PBXNativeTarget section */',
      'HEADER_SEARCH_PATHS = "";',
      'LIBRARY_SEARCH_PATHS = "/cocos/external/ios/libs";',
      'IPHONEOS_DEPLOYMENT_TARGET = 10.0;',
      '',
    ].join('\n'));
    const extensionRoot = createReplayExtension(root);
    const quiet = { info() {}, warn() {} };
    installNative(root, extensionRoot, quiet);
    installNative(root, extensionRoot, quiet);

    const podfileText = readFileSync(join(ios, 'Podfile'), 'utf8');
    expect(podfileText).toContain("project 'Example.xcodeproj'");
    expect(podfileText).toContain("target 'Example-mobile' do");
    expect(podfileText).not.toContain("target 'Example-desktop' do");
    expect(podfileText.match(/COCOS_SDK_BEGIN/g)).toHaveLength(1);
    expect(podfileText).toContain("pod 'FTCocosBridge'");
    expect(readFileSync(join(iosConfigDirectory, 'UserConfigIOS.debug.xcconfig'), 'utf8'))
      .toContain('#include? "../Pods/Target Support Files/Pods-Example-mobile/Pods-Example-mobile.debug.xcconfig"');
    expect(readFileSync(join(iosConfigDirectory, 'UserConfigIOS.debug.xcconfig'), 'utf8'))
      .toContain('OTHER_LDFLAGS = $(inherited) -lwebp');
    const projectText = readFileSync(join(xcodeProject, 'project.pbxproj'), 'utf8');
    expect(projectText).toContain('HEADER_SEARCH_PATHS = "$(inherited)";');
    expect(projectText).toContain('LIBRARY_SEARCH_PATHS = "$(inherited) /cocos/external/ios/libs";');
    expect(projectText).toContain('IPHONEOS_DEPLOYMENT_TARGET = 12.0;');
    expect(projectText).toContain('productName = "Example Product";');
    expect(projectText.match(/productName = "Example Product";/g) || []).toHaveLength(2);
  });

  it('accepts the Creator 3 onAfterBuild options object', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cocos-sdk-hook-'));
    temporaryRoots.push(root);
    const extension = join(root, 'extension');
    const xcodeProject = join(root, 'project', 'build', 'ios', 'proj', 'Example.xcodeproj');
    mkdirSync(join(extension, 'dist'), { recursive: true });
    mkdirSync(xcodeProject, { recursive: true });
    cpSync(resolve('integrations/creator3/dist/hooks.js'), join(extension, 'dist', 'hooks.js'));
    cpSync(resolve('integrations/shared/install-native.cjs'), join(extension, 'install-native.cjs'));
    for (const helper of ['managed-assets.cjs', 'legacy-asset-hashes.json']) cpSync(resolve('integrations/shared', helper), join(extension, helper));
    cpSync(resolve('native'), join(extension, 'native'), { recursive: true });
    writeFileSync(join(xcodeProject, 'project.pbxproj'), [
      'A1 /* Example-mobile */ = {',
      '  isa = PBXNativeTarget;',
      '  name = "Example-mobile";',
      '  productType = "com.apple.product-type.application";',
      '};',
      '',
    ].join('\n'));
    const compileConfig = join(root, 'project', 'build', 'ios', 'cocos.compile.config.json');
    writeFileSync(compileConfig, '{}\n');

    const previousEditor = (globalThis as { Editor?: unknown }).Editor;
    (globalThis as { Editor?: unknown }).Editor = { Project: { path: join(root, 'project') } };
    try {
      const hooks = require(join(extension, 'dist', 'hooks.js')) as {
        onAfterBuild: (options: object, result: object) => Promise<void>;
      };
      await hooks.onAfterBuild({
        platform: 'ios',
        outputName: 'ios',
        buildPath: 'project://build',
      }, { paths: { compileConfig } });
    } finally {
      (globalThis as { Editor?: unknown }).Editor = previousEditor;
    }

    expect(readFileSync(join(root, 'project', 'build', 'ios', 'proj', 'Podfile'), 'utf8'))
      .toContain("pod 'FTCocosBridge'");
  });

  it('migrates legacy FT marker blocks without duplicating native integration', () => {
    const root = mkdtempSync(join(tmpdir(), 'cocos-sdk-legacy-markers-'));
    temporaryRoots.push(root);
    const android = join(root, 'android', 'app');
    const ios = join(root, 'ios');
    mkdirSync(android, { recursive: true });
    mkdirSync(ios, { recursive: true });
    const gradle = join(android, 'build.gradle');
    const podfile = join(ios, 'Podfile');
    writeFileSync(gradle, [
      'plugins { id "com.android.application" }',
      '/* FT_COCOS_SDK_BEGIN */',
      '// legacy integration',
      '/* FT_COCOS_SDK_END */',
      '',
    ].join('\n'));
    writeFileSync(podfile, [
      "platform :ios, '12.0'",
      "target 'Example-mobile' do",
      '  # FT_COCOS_SDK_BEGIN',
      "  pod 'FTCocosBridge', :path => '/legacy'",
      '  # FT_COCOS_SDK_END',
      'end',
      '',
    ].join('\n'));

    installNative(root, createReplayExtension(root), { info() {}, warn() {} });

    const gradleText = readFileSync(gradle, 'utf8');
    const podfileText = readFileSync(podfile, 'utf8');
    expect(gradleText).not.toContain('FT_COCOS_SDK_BEGIN');
    expect(gradleText.match(/COCOS_SDK_BEGIN/g)).toHaveLength(1);
    expect(podfileText).not.toContain('FT_COCOS_SDK_BEGIN');
    expect(podfileText.match(/COCOS_SDK_BEGIN/g)).toHaveLength(1);
  });
});
