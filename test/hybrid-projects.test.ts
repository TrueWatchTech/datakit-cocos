import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const projects = [
  {
    root: 'examples/hybrid-creator2',
    creator: 2,
    script: 'assets/Script/HybridTelemetrySample.ts',
    scene: 'assets/Scene/HybridTelemetry.fire',
    sceneComponentType: 'e1b90/rohdEk4SdmmEZANaD',
    sampleName: 'cocos-hybrid-creator2',
  },
  {
    root: 'examples/hybrid-creator3',
    creator: 3,
    script: 'assets/HybridTelemetrySample.ts',
    scene: 'assets/HybridTelemetry.scene',
    sceneComponentType: 'dd05fBJuDVL54GFyL3lSg4R',
    sampleName: 'cocos-hybrid-creator3',
  },
] as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('Complete Hybrid Creator sample projects', () => {
  it.skipIf(process.platform !== 'darwin').each(projects)(
    '$root native host imports compile with CocoaPods and SwiftPM header layouts',
    (project) => {
      const source = sourceAt(`${project.root}/native-host/ios/HybridSampleSDK.m`);
      const imports = source.match(/^#if __has_include[\s\S]*?^#endif/m)?.[0];
      expect(imports).toBeDefined();

      for (const layout of ['cocoapods', 'spm']) {
        const directory = mkdtempSync(path.join(tmpdir(), 'cocos-host-headers-'));
        temporaryDirectories.push(directory);
        writeFileSync(path.join(directory, 'FTMobileSDK.h'), '');
        if (layout === 'cocoapods') {
          mkdirSync(path.join(directory, 'TrueWatchSDK'));
          writeFileSync(path.join(directory, 'TrueWatchSDK/TrueWatchSDK.h'), 'typedef int SDKImport;');
          writeFileSync(path.join(directory, 'TrueWatchSDK/TrueWatchSessionReplay.h'), 'typedef int ReplayImport;');
        } else {
          for (const name of ['FTMobileAgent', 'FTSDKConfig', 'FTRumConfig', 'FTLoggerConfig', 'FTMobileConfig', 'FTSessionReplay']) {
            writeFileSync(path.join(directory, `${name}.h`),
              name === 'FTMobileAgent' ? 'typedef int SDKImport;'
                : name === 'FTSessionReplay' ? 'typedef int ReplayImport;' : '');
          }
        }
        const output = execFileSync('/usr/bin/clang', ['-E', '-P', '-x', 'objective-c', '-I', directory, '-'], {
          input: imports,
          encoding: 'utf8',
        });
        expect(output).toContain('typedef int SDKImport;');
        expect(output).toContain('typedef int ReplayImport;');
      }
    },
  );

  it.each(projects)('$root consumes the local SDK and binds its startup scene', (project) => {
    const packageJson = JSON.parse(sourceAt(`${project.root}/package.json`));
    expect(packageJson.dependencies['@truewatchtech/cocos-sdk']).toBe('file:../../packages/cocos');
    expect(packageJson.scripts.setup).toContain('npm run sdk:install');
    expect(packageJson.scripts['native:install']).toContain(`--creator ${project.creator}`);
    expect(sourceAt(`${project.root}/${project.scene}`)).toContain(project.sceneComponentType);
  });

  it.each(projects)('$root demonstrates all required Hybrid telemetry paths', (project) => {
    const source = sourceAt(`${project.root}/${project.script}`);
    expect(source).toContain('truewatchSdk.attach({');
    expect(source).toContain('truewatchSdk.enterCocos({ viewName: VIEW_NAME })');
    expect(source).toContain('truewatchSdk.leaveCocos()');
    expect(source).toContain('setReplayCamera(');
    expect(source).toContain('truewatchSdk.rum.addAction(');
    expect(source).toContain('truewatchSdk.rum.addError(');
    expect(source).toContain('truewatchSdk.rum.startResource(resourceKey');
    expect(source).toContain('truewatchSdk.rum.addResource(resourceKey');
    expect(source).toContain('truewatchSdk.trace.getHeaders(TRACE_TEST_URL, resourceKey)');
    expect(source).toContain('truewatchSdk.logger.log(');
    expect(source).not.toContain('truewatchSdk.start(');
  });

  it.each(projects)('$root separates automatic/manual network collection and native/Cocos pages', (project) => {
    const source = sourceAt(`${project.root}/${project.script}`);
    const nativeActivity = sourceAt(
      `${project.root}/native-host/android/HybridSampleNativeActivity.java`,
    );
    const application = sourceAt(
      `${project.root}/native-host/android/HybridSampleApplication.java`,
    );
    expect(source).toContain('network: true');
    expect(source).toContain('emitAutomaticResource()');
    expect(source).toContain('emitManualTraceResource()');
    expect(source).toContain('this.untrackedXhr');
    expect(source).toContain("'returnToNative'");
    expect(source).toContain("'showNativePage'");
    expect(nativeActivity).toContain('httpClient.newCall(request)');
    expect(nativeActivity).toContain('new OkHttpClient.Builder().build()');
    expect(nativeActivity).toContain('Open Cocos Page');
    expect(application).toContain('@IgnoreAOP');
    expect(application).toContain('HybridSampleSdk.start()');
    expect(application).toContain('FTAutoTrack.startApp(this)');
  });

  it('keeps Creator 2 alive while a native page covers it in the same process', () => {
    const nativeActivity = sourceAt(
      'examples/hybrid-creator2/native-host/android/HybridSampleNativeActivity.java',
    );
    const sdk = sourceAt('examples/hybrid-creator2/native-host/android/HybridSampleSdk.java');
    expect(nativeActivity).not.toContain('FLAG_ACTIVITY_CLEAR_TASK');
    expect(sdk).not.toContain('FLAG_ACTIVITY_CLEAR_TASK');
    expect(nativeActivity).toContain('finish();');
    expect(nativeActivity).not.toContain('FLAG_ACTIVITY_NEW_TASK');
    expect(sdk).not.toContain('FLAG_ACTIVITY_NEW_TASK');
    expect(sdk).not.toContain('finishAndRemoveTask');
    expect(sdk).not.toContain('.setOnlySupportMainProcess(false)');
    expect(sourceAt('examples/hybrid-creator2/assets/Script/HybridTelemetrySample.ts')).toContain(
      'cc.director.once(cc.Director.EVENT_AFTER_DRAW',
    );
  });

  it.each(projects)('$root native host owns SDK startup and enables RUM links', (project) => {
    const android = sourceAt(`${project.root}/native-host/android/HybridSampleSdk.java`);
    const ios = sourceAt(`${project.root}/native-host/ios/HybridSampleSDK.m`);

    for (const expected of [
      'FTSdk.install(sdkConfig)',
      'FTSdk.initRUMWithConfig',
      'FTSdk.initLogWithConfig',
      'FTSdk.initTraceWithConfig',
      'FTSdk.initSessionReplayConfig',
      '.setEnableLinkRumData(true)',
      '.setEnableLinkRUMData(true)',
      project.sampleName,
    ]) {
      expect(android).toContain(expected);
    }
    for (const expected of [
      '[FTMobileAgent startWithConfigOptions:sdkConfig]',
      'startRumWithConfigOptions:rumConfig',
      'startLoggerWithConfigOptions:loggerConfig',
      'startTraceWithConfigOptions:traceConfig',
      'startWithSessionReplayConfig:replayConfig',
      'loggerConfig.enableLinkRumData = YES',
      'traceConfig.enableLinkRumData = YES',
      project.sampleName,
    ]) {
      expect(ios).toContain(expected);
    }
  });

  it.each([2, 3])('preserves Creator %i reflection rules across reinstall and regeneration', (creator) => {
    const project = temporaryRoot();
    const build = path.join(project, 'build/native');
    const extension = creator === 2 ? 'packages' : 'extensions';
    const activity = creator === 2 ? 'org.cocos2dx.javascript.AppActivity' : 'com.cocos.game.AppActivity';
    const install = () => execFileSync(process.execPath, [
      'scripts/install-hybrid-host.mjs', '--project', project,
      '--creator', String(creator), '--build-root', build,
    ], { cwd: process.cwd(), stdio: 'pipe' });
    const gradleFile = path.join(build, 'android/app/build.gradle');
    const rulesFile = path.join(build, 'android/app/cocos-hybrid-proguard.pro');
    const customFile = path.join(build, 'android/app/proguard-rules.pro');
    const customRules = '# Application rules\n-keep class example.Custom { *; }\n';
    for (const custom of [false, true]) {
      writeFixture(project, build, extension, activity, false);
      if (custom) {
        write(customFile, customRules);
        write(gradleFile, "android { buildTypes { release { minifyEnabled true; proguardFile 'proguard-rules.pro' } } }\n");
      }
      install();
      const gradle = readFileSync(gradleFile, 'utf8');
      const rules = readFileSync(rulesFile, 'utf8');
      expect(gradle).toContain("buildTypes { release { proguardFile 'cocos-hybrid-proguard.pro' } }");
      expect(rules).toContain('-keep class com.truewatch.cocos.sample.HybridSampleSdk {');
      expect(rules).toContain('public static void returnToNative();');
      expect(rules).toContain('public static boolean isNativePageVisible();');
      expect(rules).not.toContain('*');
      install();
      expect(readFileSync(gradleFile, 'utf8')).toBe(gradle);
      expect(readFileSync(rulesFile, 'utf8')).toBe(rules);
      if (custom) {
        expect(readFileSync(customFile, 'utf8')).toBe(customRules);
        expect(gradle).toContain("minifyEnabled true; proguardFile 'proguard-rules.pro'");
      }
      // Simulate a new Creator export replacing Gradle and the managed rules.
      writeFixture(project, build, extension, activity, false);
      write(rulesFile, '# stale generated file\n');
      install();
      expect(readFileSync(rulesFile, 'utf8')).toBe(rules);
      expect(count(readFileSync(gradleFile, 'utf8'), "proguardFile 'cocos-hybrid-proguard.pro'")).toBe(1);
      if (custom) expect(readFileSync(customFile, 'utf8')).toBe(customRules);
    }
  });

  it.each([
    { creator: 2, extensionDirectory: 'packages', cocosActivity: 'org.cocos2dx.javascript.AppActivity', legacyTask: false },
    { creator: 2, extensionDirectory: 'packages', cocosActivity: 'org.cocos2dx.javascript.AppActivity', legacyTask: true },
    { creator: 3, extensionDirectory: 'extensions', cocosActivity: 'com.cocos.game.AppActivity', legacyTask: false },
  ])('installs the Creator $creator native owner idempotently (legacy task: $legacyTask)', ({ creator, extensionDirectory, cocosActivity, legacyTask }) => {
    const project = temporaryRoot();
    const build = path.join(project, 'build/native');
    writeFixture(project, build, extensionDirectory, cocosActivity, legacyTask);

    const argumentsList = [
      'scripts/install-hybrid-host.mjs',
      '--project', project,
      '--creator', String(creator),
      '--build-root', build,
    ];
    execFileSync(process.execPath, argumentsList, { cwd: process.cwd(), stdio: 'pipe' });
    // Creator may serialize an empty game activity as a self-closing XML element.
    const manifestPath = path.join(build, 'android/app/AndroidManifest.xml');
    writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace(
      /(<activity\b[^>]*android:name="(?:com.cocos.game.AppActivity|org.cocos2dx.javascript.AppActivity)"[^>]*)>\s*<\/activity>/,
      '$1/>',
    ));
    execFileSync(process.execPath, argumentsList, { cwd: process.cwd(), stdio: 'pipe' });

    const cmake = readFileSync(path.join(build, 'android/CMakeLists.txt'), 'utf8');
    if (creator === 3) {
      expect(count(cmake, 'COCOS_HYBRID_ANDROID_PAGE_ALIGNMENT_BEGIN')).toBe(1);
      expect(cmake).toContain('-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384');
      expect(cmake.indexOf('set_property(TARGET')).toBeGreaterThan(cmake.indexOf('add_library('));
    } else {
      expect(cmake).not.toContain('PAGE_ALIGNMENT');
    }

    const iosCmake = readFileSync(path.join(build, 'ios/CMakeLists.txt'), 'utf8');
    expect(count(iosCmake, 'COCOS_SAMPLE_METAL_BEGIN')).toBe(creator === 3 ? 1 : 0);

    const activity = readFileSync(path.join(build, 'android/app/src/AppActivity.java'), 'utf8');
    const appDelegate = readFileSync(path.join(build, 'ios/AppDelegate.mm'), 'utf8');
    const gradle = readFileSync(path.join(build, 'android/app/build.gradle'), 'utf8');
    const rootGradle = readFileSync(path.join(build, 'android/build.gradle'), 'utf8');
    const manifest = readFileSync(path.join(build, 'android/app/AndroidManifest.xml'), 'utf8');
    const podfile = readFileSync(path.join(build, 'ios/Podfile'), 'utf8');
    expect(activity).toContain('import com.truewatch.cocos.sample.HybridSampleSdk;');
    expect(activity).toContain('HybridSampleSdk.start();');
    expect(count(activity, 'COCOS_HYBRID_STENCIL_BEGIN')).toBe(creator === 2 ? 1 : 0);
    if (creator === 2) expect(activity).toContain('view.setEGLConfigChooser(5, 6, 5, 0, 16, 8);');
    expect(appDelegate).toContain('#import <HybridSampleHost/HybridSampleSDK.h>');
    expect(appDelegate).toContain('[HybridSampleSDK start];');
    if (process.platform === 'darwin') {
      const imports = appDelegate.match(/^#if __has_include[\s\S]*?^#endif/m)?.[0];
      expect(imports).toBeDefined();
      for (const layout of ['cocoapods', 'spm']) {
        const headers = temporaryRoot();
        const header = layout === 'cocoapods'
          ? path.join(headers, 'HybridSampleHost/HybridSampleSDK.h')
          : path.join(headers, 'HybridSampleSDK.h');
        write(header, 'typedef int HostImport;');
        const output = execFileSync('/usr/bin/clang', ['-E', '-P', '-x', 'objective-c', '-I', headers, '-'], {
          input: imports,
          encoding: 'utf8',
        });
        expect(output).toContain('typedef int HostImport;');
      }
    }
    expect(gradle).toContain("sourceSets { main.java.srcDirs += ['");
    expect(gradle).toContain("apply plugin: 'ft-plugin'");
    expect(gradle).toContain("implementation 'com.squareup.okhttp3:okhttp:4.5.0'");
    expect(rootGradle).toContain(
      "classpath 'com.truewatch.ft.mobile.sdk.tracker.plugin:ft-plugin:1.3.9'",
    );
    expect(manifest).toContain('android:name="com.truewatch.cocos.sample.HybridSampleNativeActivity"');
    expect(manifest).toContain('android:name="com.truewatch.cocos.sample.HybridSampleApplication"');
    if (creator === 2) {
      expect(manifest).not.toContain('android:process=');
      const cocosTag = manifest.match(/<activity\b[^>]*android:name="org.cocos2dx.javascript.AppActivity"[^>]*>/)?.[0] || '';
      expect(cocosTag).toContain('android:taskAffinity=""');
      expect(cocosTag).toContain('android:launchMode="singleTask"');
      expect(count(cocosTag, 'android:taskAffinity=')).toBe(1);
      expect(count(cocosTag, 'android:launchMode=')).toBe(1);
      expect(manifest).not.toContain('com.ft.sdk.cocos.FTCocosBridgeProvider');
      const cocosElement = manifest.match(/<activity\b[^>]*android:name="org.cocos2dx.javascript.AppActivity"[\s\S]*?<\/activity>/)?.[0] || '';
      expect(cocosElement).toContain('android.intent.category.LAUNCHER');
      const nativeTag = manifest.match(/<activity\b[^>]*android:name="com.truewatch.cocos.sample.HybridSampleNativeActivity"[^>]*>/)?.[0] || '';
      expect(nativeTag).toContain('android:launchMode="standard"');
      expect(nativeTag).toContain('android:exported="false"');
    } else {
      expect(manifest).not.toContain('android:process=":cocos"');
      expect(manifest).not.toContain('android:taskAffinity="${applicationId}.cocos"');
      expect(manifest).not.toContain('android:name="com.ft.sdk.cocos.FTCocosBridgeProvider"');
    }
    expect(manifest.match(/android.intent.category.LAUNCHER/g)).toHaveLength(1);
    expect(podfile).toContain("pod 'HybridSampleHost', :path => '");
    expect(count(activity, 'COCOS_HYBRID_SAMPLE_BEGIN')).toBe(1);
    expect(count(appDelegate, 'COCOS_HYBRID_SAMPLE_BEGIN')).toBe(1);
    expect(count(gradle, 'COCOS_HYBRID_SAMPLE_BEGIN')).toBe(1);
    expect(count(rootGradle, 'COCOS_HYBRID_FT_PLUGIN_CLASSPATH_BEGIN')).toBe(1);
    expect(count(manifest, 'COCOS_HYBRID_NATIVE_PAGE_BEGIN')).toBe(1);
    expect(count(manifest, 'android:name="com.truewatch.cocos.sample.HybridSampleNativeActivity"')).toBe(1);
    expect(count(podfile, 'COCOS_HYBRID_SAMPLE_BEGIN')).toBe(1);
  });
  it('preserves Creator 2 custom surface creation and EGL attributes', () => {
    const project = temporaryRoot();
    const build = path.join(project, 'build/native');
    writeFixture(project, build, 'packages', 'org.cocos2dx.javascript.AppActivity', false);
    const file = path.join(build, 'android/app/src/AppActivity.java');
    const customView = [
      '  @Override public org.cocos2dx.lib.Cocos2dxGLSurfaceView onCreateView() {',
      '    org.cocos2dx.lib.Cocos2dxGLSurfaceView view = new org.cocos2dx.lib.Cocos2dxGLSurfaceView(this);',
      '    view.setEGLConfigChooser(8, 8, 8, 8, 24, 8);',
      '    return view;',
      '  }',
    ].join('\n');
    write(file, readFileSync(file, 'utf8').replace(/\}\s*$/, `${customView}\n}\n`));
    const args = ['scripts/install-hybrid-host.mjs', '--project', project, '--creator', '2', '--build-root', build];
    execFileSync(process.execPath, args, { cwd: process.cwd(), stdio: 'pipe' });
    execFileSync(process.execPath, args, { cwd: process.cwd(), stdio: 'pipe' });
    const activity = readFileSync(file, 'utf8');
    expect(activity).toContain(customView);
    expect(count(activity, 'onCreateView()')).toBe(1);
    expect(activity).not.toContain('COCOS_HYBRID_STENCIL_BEGIN');
  });
});

function writeFixture(
  project: string,
  build: string,
  extensionDirectory: string,
  cocosActivity: string,
  legacyTask: boolean,
): void {
  write(path.join(project, extensionDirectory, 'truewatch-cocos-sdk/install-native.cjs'), 'exports.installNative = () => {};\n');
  for (const relativePath of [
    'android/HybridSampleSdk.java',
    'android/HybridSampleEnvironment.java',
    'android/HybridSampleApplication.java',
    'android/HybridSampleNativeActivity.java',
    'ios/HybridSampleSDK.h',
    'ios/HybridSampleSDK.m',
    'ios/HybridSampleEnvironment.generated.h',
    'ios/HybridSampleHost.podspec',
  ]) {
    write(path.join(project, 'native-host', relativePath), `fixture: ${relativePath}\n`);
  }
  write(path.join(build, 'ios/CMakeLists.txt'), 'project(Sample)\n');
  if (extensionDirectory === 'extensions') {
    write(path.join(project, 'native-host/cmake/MetalVertexFormats.cmake'), '# Metal fixture\n');
  }
  write(path.join(build, 'android/build.gradle'), [
    'buildscript {',
    '  repositories {}',
    '  dependencies {}',
    '}',
    '',
  ].join('\n'));
  write(path.join(build, 'android/settings.gradle'), "rootProject.name = 'Sample'\n");
  write(path.join(build, 'android/app/build.gradle'), 'android {}\n');
  write(path.join(build, 'android/CMakeLists.txt'), 'set(CC_LIB_NAME cocos)\nadd_library(${CC_LIB_NAME} SHARED ${CC_ALL_SOURCES})\n');
  write(path.join(build, 'android/app/AndroidManifest.xml'), [
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
    '  <application>',
    `    <activity android:name="${cocosActivity}" android:exported="true"${legacyTask
      ? ' android:process=":old" android:taskAffinity="legacy.shared" android:launchMode="standard"' : ''}>`,
    ...(legacyTask ? [] : [
      '      <intent-filter>',
      '        <action android:name="android.intent.action.MAIN"/>',
      '        <category android:name="android.intent.category.LAUNCHER"/>',
      '      </intent-filter>',
    ]),
    '    </activity>',
    ...(legacyTask ? [
      '<!-- COCOS_HYBRID_NATIVE_PAGE_BEGIN -->',
      '<provider android:name="com.ft.sdk.cocos.FTCocosBridgeProvider" android:authorities="${applicationId}.ft.cocos.bridge" android:exported="false"/>',
      '<activity android:name="com.truewatch.cocos.sample.HybridSampleNativeActivity" android:launchMode="singleTask" android:exported="true">',
      '<intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>',
      '</activity>',
      '<!-- COCOS_HYBRID_NATIVE_PAGE_END -->',
    ] : []),
    '  </application>',
    '</manifest>',
    '',
  ].join('\n'));
  write(path.join(build, 'android/app/src/AppActivity.java'), [
    'package com.example;',
    'import android.os.Bundle;',
    'public class AppActivity {',
    '  protected void onCreate(Bundle state) {',
    '    super.onCreate(state);',
    '  }',
    '}',
    '',
  ].join('\n'));
  write(path.join(build, 'ios/Podfile'), "target 'Sample-mobile' do\nend\n");
  write(path.join(build, 'ios/AppDelegate.mm'), [
    '#import "AppDelegate.h"',
    '- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {',
    '    return YES;',
    '}',
    '',
  ].join('\n'));
}

function write(file: string, source: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
}

function temporaryRoot(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'cocos-hybrid-project-'));
  temporaryDirectories.push(directory);
  return directory;
}

function sourceAt(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function count(source: string, value: string): number {
  return source.split(value).length - 1;
}
