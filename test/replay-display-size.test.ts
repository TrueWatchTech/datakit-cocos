import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FTNativeTransport } from '../src/core/transport';
import { FTSessionReplay, type FTCanvasCapture, type FTReplayPointerEvent } from '../src/session-replay/core/replay';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fixture(v2 = false, viewportAvailable = true) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let viewport = { width: 1280, height: 720 };
  let viewId = 'view-0';
  let emitPointer: (event: FTReplayPointerEvent) => void = () => {};
  let color = 0;
  let encodedScale = 1;
  let rejectImage = false;
  let failImage = false;
  let storedSize = { width: 720, height: 405 };
  const capturedSizes: Array<{ width: number; height: number }> = [];
  const segments: Array<{ records: Array<{ type: number; data: any }> }> = [];
  const transport: FTNativeTransport = {
    platform: 'android',
    invoke<T>(method: string, payload?: unknown): T | undefined {
      if (method === 'replay.getContext') return { applicationId: 'app', sessionId: 'session', viewId } as T;
      if (method === 'replay.writeSegment') segments.push(JSON.parse((payload as { segment: string }).segment));
      if (method === 'replay.saveImage' || method === 'replay.saveImageV2') {
        if (failImage) throw new Error('encoder unavailable');
        if (method === 'replay.saveImage') return `image-${color}` as T;
        if (rejectImage) return { accepted: false } as T;
        return { resourceId: `image-${color}`, byteSize: 1024,
          width: Math.round(storedSize.width * encodedScale),
          height: Math.round(storedSize.height * encodedScale), mimeType: 'image/webp' } as T;
      }
      return undefined;
    },
  };
  const capture: FTCanvasCapture = {
    ...(viewportAvailable ? { getViewportSize: () => viewport } : {}),
    async capture(maxDimension) {
      const scale = Math.min(1, maxDimension / Math.max(viewport.width, viewport.height));
      const size = { width: Math.round(viewport.width * scale), height: Math.round(viewport.height * scale) };
      capturedSizes.push(size);
      return { ...size, rgba: new Uint8Array(size.width * size.height * 4).fill(color), timestamp: Date.now() };
    },
    async persist(frame, fingerprint) {
      storedSize = { width: frame.width, height: frame.height };
      return { ...storedSize, fingerprint, timestamp: frame.timestamp, path: '/fake/frame.rgba' };
    },
    disposeStoredFrame() {},
    setPrivacy() {},
  };
  const replay = new FTSessionReplay(transport, capture, {
    onReplayPointer(callback) { emitPointer = callback; return () => {}; },
  });
  replay.start({ touchPrivacy: 'show', ...(v2 ? { imagePolicy: {} } : {}) });
  return {
    replay, segments, capturedSizes,
    setViewport: (width: number, height: number) => { viewport = { width, height }; },
    setView: (value: string) => { viewId = value; },
    setEncodedScale: (value: number) => { encodedScale = value; },
    rejectImage: () => { rejectImage = true; },
    acceptImage: () => { rejectImage = false; },
    failImage: () => { failImage = true; },
    async frame(time: number, change = true) {
      vi.setSystemTime(time);
      if (change) color = color === 20 ? 230 : 20;
      emitPointer({ eventType: 'move', pointerId: 1, normalizedX: 0.5, normalizedY: 0.5, timestamp: time });
      await replay.captureNow();
      return segments[segments.length - 1]!.records;
    },
  };
}

const image = (records: Array<{ type: number; data: any }>) => records.find(r => r.type === 10)?.data.wireframes[0];
const pointer = (records: Array<{ type: number; data: any }>) => records.find(r => r.type === 11)?.data;

describe('replay display coordinates', () => {
  it.each([true, false])('keeps V1 display and pointers stable beyond the former budget (viewport API: %s)', async viewportAvailable => {
    const f = fixture(false, viewportAvailable);
    try {
      // More than 1.5 MiB under the old V1 estimate, all within 60 seconds.
      for (let i = 0; i < 45; i++) {
        if (i < 5) f.setView(`view-${i}`);
        const records = await f.frame(i * 500);
        expect(image(records)).toMatchObject({ width: 720, height: 405 });
        expect(pointer(records)).toMatchObject({ x: 360, y: 203 });
      }
      expect(f.capturedSizes).toHaveLength(45);
      expect(f.capturedSizes.every(s => s.width === 720 && s.height === 405)).toBe(true);
      f.setView('next-view');
      const next = await f.frame(22_500);
      expect(next[0]).toMatchObject({ type: 4, data: { width: 720, height: 405 } });
      expect(image(next)).toMatchObject({ width: 720, height: 405 });
      const staticFrame = await f.frame(23_000, false);
      expect(staticFrame.map(r => r.type)).toEqual([11]);
      expect(pointer(staticFrame)).toMatchObject({ x: 360, y: 203 });
    } finally { f.replay.stop(); }
  });

  it('uses logical dimensions even when the native encoder shrinks the first image', async () => {
    const f = fixture(true);
    try {
      f.setEncodedScale(0.75);
      const first = await f.frame(0);
      expect(first[0]).toMatchObject({ type: 4, data: { width: 720, height: 405 } });
      expect(image(first)).toMatchObject({ width: 720, height: 405 });
      expect(pointer(first)).toMatchObject({ x: 360, y: 203 });
      f.setEncodedScale(1);
      const next = await f.frame(3000);
      expect(image(next)).toMatchObject({ width: 720, height: 405 });
      expect(next.map(r => r.type)).toEqual([10, 11]);
    } finally { f.replay.stop(); }
  });

  it('updates canvas metadata before the image when the actual viewport rotates within a view', async () => {
    const f = fixture(true);
    try {
      await f.frame(0);
      f.setViewport(720, 1280);
      const rotated = await f.frame(3000);
      expect(rotated.map(r => r.type)).toEqual([4, 10, 11]);
      expect(rotated[0]?.data).toEqual({ width: 405, height: 720 });
      expect(image(rotated)).toMatchObject({ width: 405, height: 720 });
      expect(pointer(rotated)).toMatchObject({ x: 203, y: 360 });
    } finally { f.replay.stop(); }
  });

  it.each(['dedupe', 'rejected', 'error'] as const)('preserves touch coordinates on %s after native resizing', async reason => {
    const f = fixture(true);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      f.setEncodedScale(0.75);
      await f.frame(0);
      if (reason === 'rejected') f.rejectImage();
      if (reason === 'error') f.failImage();
      const records = await f.frame(3000, reason !== 'dedupe');
      expect(records.map(r => r.type)).toEqual([11]);
      expect(pointer(records)).toMatchObject({ x: 360, y: 203 });
      expect(errors).toHaveBeenCalledTimes(reason === 'error' ? 1 : 0);
    } finally { f.replay.stop(); }
  });

  it('retains touches until a rotated viewport has a successfully saved image', async () => {
    const f = fixture(true);
    try {
      await f.frame(0);
      f.setViewport(720, 1280);
      f.rejectImage();
      await f.frame(3000);
      expect(f.segments).toHaveLength(1);
      f.acceptImage();
      const records = await f.frame(6000);
      expect(records.map(r => r.type)).toEqual([4, 10, 11, 11]);
      expect(records[0]?.data).toEqual({ width: 405, height: 720 });
      for (const r of records.filter(r => r.type === 11)) {
        expect(r.data).toMatchObject({ x: 203, y: 360 });
      }
    } finally { f.replay.stop(); }
  });
});
