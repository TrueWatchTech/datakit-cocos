import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('package distribution', () => {
  it('keeps the root private and publishes the coordinated SDK and Replay packages', () => {
    const metadata = JSON.parse(readFileSync('packages/cocos/package.json', 'utf8'));
    expect(metadata.name).toBe('@truewatchtech/cocos-sdk');
    expect(metadata.private).not.toBe(true);
    expect(JSON.parse(readFileSync('package.json', 'utf8')).private).toBe(true);
    const publish = readFileSync('.github/workflows/publish.yml', 'utf8');
    expect(publish).toContain("github.repository == 'TrueWatchTech/datakit-cocos'");
    expect(publish).toContain('needs: verify');
    expect(publish).toContain('node scripts/publish-npm-token.mjs --ci');
    expect(publish).toContain('id-token: write');
    const replay = JSON.parse(readFileSync('packages/cocos-session-replay/package.json', 'utf8'));
    expect(replay.name).toBe('@truewatchtech/cocos-session-replay');
    expect(replay.peerDependencies[metadata.name]).toBe(metadata.version);
    const verify = readFileSync('.github/workflows/verify.yml', 'utf8');
    expect(verify).not.toMatch(/npm\s+publish|id-token:\s*write/);
  });
});
