import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FTSessionReplay, frameFingerprint, replayFramesLookSimilar, sampleReplayFrame,
  type FTCanvasCapture,
} from '../src/session-replay/core/replay';
import type { FTNativeTransport } from '../src/core/transport';

afterEach(() => vi.useRealTimers());

describe('local replay motion', () => {
  it.each([0, 1, 2])('preserves real Battle screenshot pair %i previously rejected as static', (index) => {
    const load = (state: string) => gunzipSync(readFileSync(
      new URL(`./fixtures/replay-motion/battle-${index}-${state}.rgba.gz`, import.meta.url),
    ));
    const previous = sampleReplayFrame(load('saved'), 720, 405);
    const current = sampleReplayFrame(load('rejected'), 720, 405);
    // These pairs all pass the old whole-screen static thresholds.
    const differences = current.luminance.map((value, i) => Math.abs(value - previous.luminance[i]!));
    expect(differences.reduce((sum, value) => sum + value, 0) / differences.length).toBeLessThan(2.5);
    expect(differences.filter((value) => value >= 12).length / differences.length).toBeLessThanOrEqual(0.01);
    expect(replayFramesLookSimilar(previous, current)).toBe(false);
  });

  it('recognizes a local color change with unchanged luminance', () => {
    const before = new Uint8Array(320 * 180 * 4);
    for (let i = 0; i < before.length; i += 4) before.set([183, 0, 0, 255], i);
    const after = before.slice();
    for (let y = 40; y < 56; y++) {
      for (let x = 40; x < 56; x++) after.set([0, 54, 0, 255], (y * 320 + x) * 4);
    }
    const previous = sampleReplayFrame(before, 320, 180);
    const current = sampleReplayFrame(after, 320, 180);
    expect(current.luminance).toEqual(previous.luminance);
    expect(replayFramesLookSimilar(previous, current)).toBe(false);
  });

  it('fingerprints changes between the old sparse hash samples', () => {
    const before = new Uint8Array(720 * 405 * 4);
    const after = before.slice();
    after[4] = 255; // Old stride=142 only examined bytes 0, 142, 284, ...
    expect(frameFingerprint(after)).not.toBe(frameFingerprint(before));
  });

  it('hashes all channels, trailing bytes and unaligned views consistently', () => {
    const bytes = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255, 7]);
    const buffer = new Uint8Array(bytes.length + 1);
    buffer.set(bytes, 1);
    expect(frameFingerprint(buffer.subarray(1))).toBe(frameFingerprint(bytes));
    for (let i = 0; i < bytes.length; i++) {
      const changed = bytes.slice();
      changed[i]! ^= 1;
      expect(frameFingerprint(changed)).not.toBe(frameFingerprint(bytes));
    }
  });

  it('bounds approximate suppression without periodically uploading identical images', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const rgba = new Uint8Array(100 * 100 * 4).fill(100);
    let saves = 0;
    const transport: FTNativeTransport = {
      platform: 'ios',
      invoke<T>(method: string): T | undefined {
        if (method === 'replay.getContext') return { applicationId: 'app', sessionId: 'session', viewId: 'view' } as T;
        if (method === 'replay.saveImage') return `image-${++saves}` as T;
        return undefined;
      },
    };
    const capture: FTCanvasCapture = {
      async capture() { return { rgba, width: 100, height: 100, timestamp: Date.now() }; },
      async persist(frame, fingerprint) { return { ...frame, path: '/fake/frame', fingerprint }; },
      disposeStoredFrame() {}, setPrivacy() {},
    };
    const replay = new FTSessionReplay(transport, capture);
    replay.start();
    try {
      await expect(replay.captureNow()).resolves.toBe(true);
      rgba[4] = 101;
      vi.setSystemTime(1_999);
      await expect(replay.captureNow()).resolves.toBe(false);
      vi.setSystemTime(2_000);
      await expect(replay.captureNow()).resolves.toBe(true);
      vi.setSystemTime(20_000);
      await expect(replay.captureNow()).resolves.toBe(false);
      expect(saves).toBe(2);
    } finally {
      replay.stop();
    }
  });
});
