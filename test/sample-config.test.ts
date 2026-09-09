import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const generatedTargets = [
  'examples/hybrid-creator3/native-host/android/HybridSampleEnvironment.java',
  'examples/hybrid-creator3/native-host/ios/HybridSampleEnvironment.generated.h',
];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('Sample environment configuration', () => {
  it('generates native-host configuration without printing credentials', () => {
    const outputRoot = temporaryRoot();
    const environment = cleanEnvironment({
      SAMPLE_DATAWAY_URL: 'https://openway.example.test',
      SAMPLE_CLIENT_TOKEN: 'sample-client-token',
      SAMPLE_ANDROID_APP_ID: 'android-sample-app',
      SAMPLE_IOS_APP_ID: 'ios-sample-app',
      SAMPLE_ENV: 'integration',
      SAMPLE_DEBUG: 'false',
    });

    const output = execFileSync(
      process.execPath,
      ['scripts/configure-sample.mjs', '--output-root', outputRoot],
      { cwd: process.cwd(), encoding: 'utf8', env: environment },
    );

    const [android, ios] = generatedTargets.map((target) => readFileSync(path.join(outputRoot, target), 'utf8'));
    expect(android).toContain('DATAWAY_URL = "https://openway.example.test"');
    expect(android).toContain('CLIENT_TOKEN = "sample-client-token"');
    expect(android).toContain('ANDROID_RUM_APP_ID = "android-sample-app"');
    expect(android).toContain('ENV = "integration"');
    expect(android).toContain('DEBUG = false');
    expect(ios).toContain('FTHybridSampleDatawayURL = @"https://openway.example.test"');
    expect(ios).toContain('FTHybridSampleClientToken = @"sample-client-token"');
    expect(ios).toContain('FTHybridSampleIOSRumAppID = @"ios-sample-app"');
    expect(ios).toContain('FTHybridSampleEnv = @"integration"');
    expect(ios).toContain('FTHybridSampleDebug = NO');
    expect(output).not.toContain('sample-client-token');
  });

  it('requires one endpoint mode and at least one platform app ID', () => {
    const outputRoot = temporaryRoot();
    expect(() => execFileSync(
      process.execPath,
      ['scripts/configure-sample.mjs', '--output-root', outputRoot],
      { cwd: process.cwd(), stdio: 'pipe', env: cleanEnvironment() },
    )).toThrow();
  });

  it('can generate credentials directly inside an independent sample project', () => {
    const outputRoot = temporaryRoot();
    execFileSync(
      process.execPath,
      [
        'scripts/configure-sample.mjs',
        '--output-root', outputRoot,
        '--native-host-dir', 'native-host',
      ],
      {
        cwd: process.cwd(),
        stdio: 'pipe',
        env: cleanEnvironment({
          SAMPLE_DATAWAY_URL: 'https://openway.example.test',
          SAMPLE_CLIENT_TOKEN: 'sample-client-token',
          SAMPLE_ANDROID_APP_ID: 'android-sample-app',
        }),
      },
    );

    expect(readFileSync(path.join(outputRoot, 'native-host/android/HybridSampleEnvironment.java'), 'utf8'))
      .toContain('ANDROID_RUM_APP_ID = "android-sample-app"');
    expect(readFileSync(path.join(outputRoot, 'native-host/ios/HybridSampleEnvironment.generated.h'), 'utf8'))
      .toContain('FTHybridSampleIOSRumAppID = nil');
  });
});

function temporaryRoot(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'cocos-sdk-sample-'));
  temporaryDirectories.push(directory);
  return directory;
}

function cleanEnvironment(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('SAMPLE_')) delete environment[key];
  }
  return { ...environment, ...overrides };
}
