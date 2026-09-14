import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { installNative, readIosDependencyManager } = require('../integrations/shared/install-native.cjs');
const { readProject, installSwiftPackage } = require('../integrations/shared/install-spm.cjs');
const roots: string[] = [];
const quiet = { info() {}, warn() {} };
const targetID = 'A10000000000000000000005';

afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cocos spm '));
  roots.push(root);
  const project = join(root, 'project');
  const build = join(project, 'build', 'ios');
  cpSync(resolve('test/fixtures/ios-spm'), build, { recursive: true });
  const config = join(project, 'cocos-sdk.config.json');
  writeFileSync(config, '{"ios":{"dependencyManager":"spm"}}');
  return { root, project, build, config, pbx: join(build, 'Smoke.xcodeproj', 'project.pbxproj') };
}

describe('iOS dependency manager configuration', () => {
  it('finds a persistent project setting and rejects unsupported values', () => {
    const f = fixture();
    expect(readIosDependencyManager(f.build, resolve('.'))).toBe('spm');
    writeFileSync(f.config, '{"ios":{"dependencyManager":"unknown"}}');
    expect(() => installNative(f.build, resolve('.'), quiet)).toThrow('expected spm or cocoapods');
    expect(existsSync(join(f.build, 'cocos-sdk-native'))).toBe(false);
  });

  it.each([2, 3])('saves the CLI selection for Creator %s and preserves it on reinstall', (creator) => {
    const f = fixture();
    const pkg = join(f.root, 'package');
    mkdirSync(join(f.project, 'assets'));
    mkdirSync(join(pkg, 'bin'), { recursive: true });
    mkdirSync(join(pkg, 'native'));
    mkdirSync(join(pkg, 'extensions', `creator${creator}`), { recursive: true });
    cpSync(resolve('src/session-replay/components'), join(pkg, 'components'), { recursive: true });
    cpSync(resolve('installer/cli.cjs'), join(pkg, 'bin', 'cli.cjs'));
    for (const helper of ['managed-assets.cjs', 'legacy-asset-hashes.json']) cpSync(resolve('integrations/shared', helper), join(pkg, 'bin', helper));
    writeFileSync(join(pkg, 'package.json'), '{"name":"test-sdk"}');
    writeFileSync(f.config, '{"custom":42,"ios":{"other":true}}');
    const args = [join(pkg, 'bin', 'cli.cjs'), '--project', f.project, '--creator', String(creator)];
    execFileSync(process.execPath, [...args, '--ios-dependency-manager', 'spm'], { maxBuffer: 4000 });
    execFileSync(process.execPath, args, { maxBuffer: 4000 });
    expect(JSON.parse(readFileSync(f.config, 'utf8'))).toEqual({ custom: 42, ios: { other: true, dependencyManager: 'spm' } });
  });
});

describe.skipIf(process.platform !== 'darwin')('SPM Xcode integration', () => {
  it('adds a local package and linked product idempotently while preserving linker flags', () => {
    const f = fixture();
    installNative(f.build, resolve('.'), quiet);
    const first = readFileSync(f.pbx, 'utf8');
    installNative(f.build, resolve('.'), quiet);
    expect(readFileSync(f.pbx, 'utf8')).toBe(first);
    expect(existsSync(join(f.build, 'Podfile'))).toBe(false);
    const project = readProject(f.pbx);
    const objects = project.objects;
    const target = objects[targetID];
    expect(target.packageProductDependencies).toHaveLength(1);
    const productID = target.packageProductDependencies[0];
    expect(objects[productID].productName).toBe('FTCocosBridge');
    expect(Object.values(objects).some((o: any) => o.isa === 'PBXBuildFile' && o.productRef === productID)).toBe(true);
    const packageID = objects[project.rootObject].packageReferences[0];
    expect(objects[packageID].relativePath).toBe('cocos-sdk-native/FTCocosBridge');
    for (const id of objects[target.buildConfigurationList].buildConfigurations) {
      const settings = objects[id].buildSettings;
      expect(settings.OTHER_LDFLAGS).toContain('-lz');
      expect(settings.OTHER_LDFLAGS).toContain('-ObjC');
      expect(settings.CLANG_ENABLE_MODULES).toBe('YES');
    }
  });

  it('reapplies integration after a Cocos project regeneration', () => {
    const f = fixture();
    installNative(f.build, resolve('.'), quiet);
    const first = readFileSync(f.pbx, 'utf8');
    cpSync(resolve('test/fixtures/ios-spm/Smoke.xcodeproj/project.pbxproj'), f.pbx);
    installNative(f.build, resolve('.'), quiet);
    expect(readFileSync(f.pbx, 'utf8')).toBe(first);
  });

  it('restores packages after CMake ZERO_CHECK regenerates the project', () => {
    const f = fixture();
    const original = readProject(f.pbx);
    const objects = original.objects;
    const source = join(f.project, 'native', 'ios');
    mkdirSync(source, { recursive: true });
    objects[original.rootObject].projectDirPath = source;
    objects['ZERO'] = { isa: 'PBXAggregateTarget', name: 'ZERO_CHECK', buildPhases: ['CHECK'] };
    objects['CHECK'] = { isa: 'PBXShellScriptBuildPhase', shellScript: 'true\n' };
    objects['A1000000000000000000000D'].buildSettings.SYMROOT = '/legacy/build';
    objects['A1000000000000000000000D'].buildSettings.CONFIGURATION_BUILD_DIR = '/engine/archives';
    writeFileSync(f.pbx, JSON.stringify(original));
    const pkg = join(f.build, 'cocos-sdk-native', 'FTCocosBridge');
    cpSync(resolve('native/ios'), pkg, { recursive: true });
    installSwiftPackage(f.pbx, pkg, 'FTCocosBridge', 'Smoke-mobile');
    const installed = readProject(f.pbx);
    const packageID = installed.objects[installed.rootObject].packageReferences[0];
    expect(installed.objects[packageID].relativePath).toBe('../../build/ios/cocos-sdk-native/FTCocosBridge');
    expect(installed.objects['A1000000000000000000000D'].buildSettings.SYMROOT).toBeUndefined();
    expect(installed.objects['A1000000000000000000000D'].buildSettings.CONFIGURATION_BUILD_DIR).toBe('/engine/archives');
    const script = installed.objects.CHECK.shellScript;
    writeFileSync(f.pbx, JSON.stringify(original));
    execFileSync('/bin/sh', ['-c', script], { maxBuffer: 4000 });
    expect(readProject(f.pbx).objects[targetID].packageProductDependencies).toHaveLength(1);
    expect(readProject(f.pbx).objects.CHECK.shellScript.match(/COCOS_SDK_SPM_RESTORE_BEGIN/g)).toHaveLength(1);
    // Regeneration can remove package references before the installer disables SPM.
    writeFileSync(f.pbx, JSON.stringify(original));
    writeFileSync(f.config, '{"ios":{"dependencyManager":"cocoapods"}}');
    installNative(f.build, resolve('.'), quiet);
    expect(existsSync(join(f.build, 'Smoke.xcodeproj', 'cocos-sdk-spm.json'))).toBe(false);
    expect(readProject(f.pbx).objects['A1000000000000000000000D'].buildSettings.SYMROOT).toBe('/legacy/build');
    expect(readProject(f.pbx).objects.CHECK.shellScript).not.toContain('COCOS_SDK_SPM_RESTORE_BEGIN');
  });

  it('removes only managed Pod blocks and refuses manually declared SDK Pods', () => {
    const f = fixture();
    const podfile = join(f.build, 'Podfile');
    writeFileSync(podfile, "target 'Smoke-mobile' do\n# COCOS_SDK_BEGIN\npod 'FTCocosBridge', :path => '.'\n# COCOS_SDK_END\npod 'OtherSDK'\nend\n");
    installNative(f.build, resolve('.'), quiet);
    expect(readFileSync(podfile, 'utf8')).toContain("pod 'OtherSDK'");
    expect(readFileSync(podfile, 'utf8')).not.toContain("pod 'FTCocosBridge'");
    writeFileSync(podfile, "target 'Smoke-mobile' do\npod 'TrueWatchSDK/Agent'\nend\n");
    expect(() => installNative(f.build, resolve('.'), quiet)).toThrow('manually declared native SDK Pod');
  });

  it('switches back to CocoaPods without keeping package product references', () => {
    const f = fixture();
    installNative(f.build, resolve('.'), quiet);
    writeFileSync(f.config, '{"ios":{"dependencyManager":"cocoapods"}}');
    installNative(f.build, resolve('.'), quiet);
    installNative(f.build, resolve('.'), quiet);
    expect(readProject(f.pbx).objects[targetID].packageProductDependencies).toEqual([]);
    expect(readFileSync(join(f.build, 'Podfile'), 'utf8')).toContain("pod 'FTCocosBridge'");
  });

  it.each([2, 3])('uses project configuration from the Creator %s build hook', async creator => {
    const f = fixture();
    const extension = join(f.project, creator === 2 ? 'packages' : 'extensions', 'truewatch-cocos-sdk');
    cpSync(resolve(`integrations/creator${creator}`), extension, { recursive: true });
    for (const file of ['install-native.cjs', 'install-spm.cjs', 'managed-assets.cjs', 'legacy-asset-hashes.json']) cpSync(resolve('integrations/shared', file), join(extension, file));
    cpSync(resolve('native'), join(extension, 'native'), { recursive: true });
    const previousEditor = (globalThis as any).Editor;
    let callback: any;
    (globalThis as any).Editor = { ...quiet, error() {}, Project: { path: f.project }, Builder: { on(_event: string, cb: any) { callback = cb; } } };
    try {
      if (creator === 2) {
        require(join(extension, 'main.js')).load();
        await new Promise<void>((resolve, reject) => callback({ dest: f.build }, (error: any) => error ? reject(error) : resolve()));
      } else {
        await require(join(extension, 'dist', 'hooks.js')).onAfterBuild({ dest: f.build }, {});
      }
      expect(readProject(f.pbx).objects[targetID].packageProductDependencies).toHaveLength(1);
      expect(existsSync(join(f.build, 'Podfile'))).toBe(false);
    } finally { (globalThis as any).Editor = previousEditor; }
  });
});
