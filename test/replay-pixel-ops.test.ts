import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { frameFingerprint } from '../src/session-replay/core/replay';
import { makeRgbaOpaque } from '../src/session-replay/core/replay-pixels';

const target = globalThis as { __ftCocosReplayFile?: { fingerprint?(bytes: Uint8Array): string; makeOpaque?(bytes: Uint8Array): void } };
const original = target.__ftCocosReplayFile;
afterEach(() => {
  if (original === undefined) delete target.__ftCocosReplayFile;
  else target.__ftCocosReplayFile = original;
});

it('matches JS full-buffer hashes natively and changes only alpha within the supplied view', () => {
  delete target.__ftCocosReplayFile;
  const root = mkdtempSync(join(tmpdir(), 'cocos-replay-pixels-'));
  try {
    const binary = join(root, 'pixel-test');
    execFileSync(process.env.CXX || 'c++', ['-std=c++11', resolve('test/native/replay-pixel-ops.cpp'), '-o', binary],
      { maxBuffer: 100_000, timeout: 30_000 });
    const hashes = execFileSync(binary, [], { encoding: 'utf8', maxBuffer: 10_000, timeout: 10_000 }).trim().split('\n');
    expect(hashes).toEqual([0, 1, 3, 4, 9, 257, 953280].map(size => {
      const storage = new Uint8Array(size + 2);
      const bytes = storage.subarray(1, size + 1);
      for (let i = 0; i < size; i++) bytes[i] = (i * 73 + 19) % 256;
      return frameFingerprint(bytes);
    }));
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 40_000);

it('uses native operations on the exact typed-array view when supported', () => {
  const bytes = new Uint8Array(16).subarray(4, 12);
  const fingerprint = vi.fn(() => 'native-hash');
  const makeOpaque = vi.fn();
  target.__ftCocosReplayFile = { fingerprint, makeOpaque };
  expect(frameFingerprint(bytes)).toBe('native-hash');
  makeRgbaOpaque(bytes);
  expect(fingerprint).toHaveBeenCalledWith(bytes);
  expect(makeOpaque).toHaveBeenCalledWith(bytes);
});

it('preserves the JS fallback with older native bridges', () => {
  target.__ftCocosReplayFile = {};
  const pixels = new Uint8Array([1, 2, 3, 0, 4, 5, 6, 191]);
  const before = frameFingerprint(pixels);
  makeRgbaOpaque(pixels);
  expect([...pixels]).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  expect(frameFingerprint(pixels)).not.toBe(before);
});
