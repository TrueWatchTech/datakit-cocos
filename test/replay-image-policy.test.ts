import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTSessionReplay, type FTCanvasCapture } from '../src/session-replay/core/replay';
import { replayImagePolicy } from '../src/session-replay/core/validation';
import type { FTReplayDiagnosticEvent } from '../src/session-replay/core/replay-diagnostics';
import type { FTNativeTransport } from '../src/core/transport';
import type { FTHybridSessionReplayConfig, FTReplayImagePolicy } from '../src/session-replay/core/types';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('per-image replay policy', () => {
  it.each([
    ['low', 480, 0.35, 20 * 1024],
    ['medium', 720, 0.45, 40 * 1024],
    ['high', 960, 0.6, 80 * 1024],
  ] as const)('expands the %s preset without a rolling limit', (quality, dimension, compressionQuality, maxFrameBytes) => {
    expect(replayImagePolicy({ imagePolicy: { quality } })).toEqual({
      quality, maxImageDimension: dimension, compressionQuality, maxFrameBytes,
    });
  });

  it('preserves explicit dimension and byte limits', () => {
    expect(replayImagePolicy({ maxImageDimension: 640, imagePolicy: { quality: 'high', maxFrameBytes: 32 * 1024 } }))
      .toEqual({ quality: 'high', compressionQuality: 0.6, maxImageDimension: 640, maxFrameBytes: 32 * 1024 });
    expect(replayImagePolicy({})).toEqual(replayImagePolicy({ imagePolicy: { quality: 'medium' } }));
  });

  it('validates per-image limits independently', () => {
    expect(() => replayImagePolicy({ imagePolicy: { quality: 'ultra' as 'high' } })).toThrow(/quality/);
    for (const maxFrameBytes of [0, 1023, 1048577, 1024.5, NaN, Infinity]) {
      expect(() => replayImagePolicy({ imagePolicy: { maxFrameBytes } })).toThrow(/maxFrameBytes/);
    }
    for (const maxFrameBytes of [1024, 1048576]) {
      expect(replayImagePolicy({ imagePolicy: { maxFrameBytes } }).maxFrameBytes).toBe(maxFrameBytes);
    }
    expect(() => replayImagePolicy({ maxImageDimension: 2049 })).toThrow(/maxImageDimension/);
  });
});

function fixture(config: FTHybridSessionReplayConfig, options: { hybrid?: boolean; delay?: number; unavailable?: boolean; oversize?: boolean } = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const diagnostics: FTReplayDiagnosticEvent[] = [];
  vi.stubGlobal('__FT_COCOS_REPLAY_BENCHMARK_OBSERVER__', (event: FTReplayDiagnosticEvent) => diagnostics.push(event));
  const starts: number[] = [];
  const dimensions: number[] = [];
  const calls: Array<{ method: string; payload: any }> = [];
  let viewId = 'view';
  let saves = 0;
  const transport: FTNativeTransport = {
    platform: 'android',
    invoke<T>(method: string, payload?: unknown): T | undefined {
      calls.push({ method, payload });
      if (method === 'replay.getContext') return { applicationId: 'app', sessionId: 'session', viewId } as T;
      return undefined;
    },
    async invokeAsync<T>(method: string, payload?: unknown): Promise<T | undefined> {
      calls.push({ method, payload });
      if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
      if (method === 'replay.saveImageV2' && options.unavailable) return undefined;
      const resourceId = `image-${++saves}`;
      if (method === 'replay.saveImage') return resourceId as T;
      return { resourceId, width: 4, height: 4,
        byteSize: (payload as { maxFrameBytes: number }).maxFrameBytes + (options.oversize ? 1 : 0),
        mimeType: 'image/webp' } as T;
    },
  };
  const capture: FTCanvasCapture = {
    async capture(maxDimension) {
      starts.push(Date.now());
      dimensions.push(maxDimension);
      return { rgba: new Uint8Array(64).fill(starts.length % 2 ? 0 : 255), width: 4, height: 4, timestamp: Date.now() };
    },
    async persist(frame, fingerprint) { return { ...frame, fingerprint, path: '/fake/frame' }; },
    disposeStoredFrame() {}, setPrivacy() {},
  };
  const replay = new FTSessionReplay(transport, capture);
  if (options.hybrid) {
    replay.attachHybrid(config);
    replay.enterHybrid();
  } else replay.start(config);
  return { replay, calls, starts, dimensions, diagnostics, setView: (id: string) => { viewId = id; },
    stop: () => options.hybrid ? replay.leaveHybrid() : replay.stop() };
}

describe('replay capture without a rolling traffic limit', () => {
  it.each([false, true])('sustains 3 FPS across two minutes with 80 ms encoding (hybrid: %s)', async hybrid => {
    // Old JS configuration must not reactivate removed limits.
    const imagePolicy = { quality: 'medium', maxBytesPerMinute: 16 * 1024, adaptiveCapture: true } as FTReplayImagePolicy;
    const f = fixture({ captureFps: 3, imagePolicy }, { hybrid, delay: 80 });
    try {
      await vi.advanceTimersByTimeAsync(120_000);
      const images = f.diagnostics.filter(e => e.type === 'image_saved');
      expect(images.length).toBeGreaterThanOrEqual(359);
      expect(images.length).toBeLessThanOrEqual(361);
      const gaps = f.starts.slice(1).map((t, i) => t - f.starts[i]!);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(334);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(332);
      expect(f.dimensions.every(d => d === 720)).toBe(true);
      expect(f.diagnostics.some(e => e.type === 'capture_skipped')).toBe(false);
      expect(images.every(e => e.byteSize === 40 * 1024 && e.byteSizeSource === 'native')).toBe(true);
    } finally { f.stop(); }
  });

  it('keeps legacy captures running without inventing image byte counts', async () => {
    const f = fixture({ captureFps: 2 });
    try {
      await vi.advanceTimersByTimeAsync(65_000);
      const images = f.diagnostics.filter(e => e.type === 'image_saved');
      expect(images).toHaveLength(131);
      expect(images.every(e => e.byteSize === undefined && e.byteSizeSource === 'unavailable')).toBe(true);
    } finally { f.stop(); }
  });

  it('applies explicit per-image limits to both first frames and later frames', async () => {
    const f = fixture({ captureFps: 2, maxImageDimension: 640, imagePolicy: { quality: 'high', maxFrameBytes: 4096 } });
    try {
      await vi.advanceTimersByTimeAsync(500);
      f.setView('next');
      await vi.advanceTimersByTimeAsync(500);
      const saves = f.calls.filter(c => c.method === 'replay.saveImageV2');
      expect(saves).toHaveLength(3);
      expect(saves.every(c => c.payload.maxFrameBytes === 4096 && c.payload.quality === 0.6)).toBe(true);
      expect(f.dimensions).toEqual([640, 640, 640]);
    } finally { f.stop(); }
  });

  it.each([{ unavailable: true }, { oversize: true }])('does not fall back to unbounded storage for %j', async options => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fixture({ imagePolicy: { maxFrameBytes: 1024 } }, options);
    try {
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.calls.some(c => c.method === 'replay.saveImage')).toBe(false);
      expect(f.calls.some(c => c.method === 'replay.writeSegment')).toBe(false);
      expect(error).toHaveBeenCalled();
      expect(f.diagnostics.some(e => e.type === 'capture_skipped' && e.reason === 'error')).toBe(true);
    } finally { f.stop(); }
  });

  it('skips missed slots when encoding is slow without concurrent captures or a catch-up burst', async () => {
    const f = fixture({ captureFps: 3 }, { delay: 800 });
    try {
      await vi.advanceTimersByTimeAsync(3100);
      expect(f.starts).toEqual([0, 1000, 2000, 3000]);
      expect(f.diagnostics.filter(e => e.type === 'image_saved')).toHaveLength(3);
      expect(f.diagnostics.some(e => e.type === 'capture_skipped' && e.reason === 'busy')).toBe(false);
    } finally { f.stop(); }
  });
});
