import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const targets = [
  'src', 'native', 'installer', 'integrations',
  'packages/cocos/package.json', 'packages/cocos/README.md',
  'packages/cocos-session-replay/package.json', 'packages/cocos-session-replay/README.md',
  'packages/cocos-session-replay/native-integration.json',
  'scripts/publish-npm-token.mjs', '.github/workflows', 'README.md', 'LICENSE',
  'examples/hybrid-creator2/assets/Script/HybridTelemetrySample.ts',
  'examples/hybrid-creator3/assets/HybridTelemetrySample.ts',
  ...[2, 3].flatMap(creator => ['android/HybridSampleSdk.java', 'ios/HybridSampleSDK.m', 'ios/Package.swift', 'ios/HybridSampleHost.podspec'].map(file => `examples/hybrid-creator${creator}/native-host/${file}`)),
];

describe('TrueWatch distribution boundary', () => {
  it('uses TrueWatch public APIs, packages and native dependency identities', () => {
    const findings = targets.flatMap(collectFiles).filter(file => {
      const source = readFileSync(file, 'utf8');
      return /guance|cloudcare|jiagouyun|Shanghai TRUEWATCH/i.test(source);
    });
    expect(findings).toEqual([]);
  });
});

function collectFiles(target: string): string[] {
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target).filter(entry => entry !== '.DS_Store')
    .flatMap(entry => collectFiles(join(target, entry)));
}
