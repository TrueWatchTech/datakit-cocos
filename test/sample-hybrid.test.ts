import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const runnableHybridSamples = [
  'examples/hybrid-creator2/assets/Script/HybridTelemetrySample.ts',
  'examples/hybrid-creator3/assets/HybridTelemetrySample.ts',
];

describe('Hybrid sample Replay privacy', () => {
  it.each(runnableHybridSamples)('%s includes an explicit Replay mask probe', (relativePath) => {
    const source = readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    expect(source).toContain("this.panel(replayNode, 'PrivacyMaskProbe'");
    expect(source).toContain("truewatchSdk.replay.setPrivacy(this.privacyMaskProbe, 'mask')");
    expect(source).toContain('MASK-ME-8391');
  });
});
