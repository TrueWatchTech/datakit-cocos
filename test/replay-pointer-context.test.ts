import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTSessionReplay, type FTCanvasCapture, type FTReplayPointerEvent } from '../src/session-replay/core/replay';
import type { FTNativeTransport } from '../src/core/transport';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function fixture(hybrid = false) {
  vi.useFakeTimers();
  const original = { applicationId: 'app-A', sessionId: 'session-A', viewId: 'view-A' };
  let context: unknown = original;
  let contextError = false;
  let listener!: (event: FTReplayPointerEvent) => void;
  let color = 0;
  const segments: Array<{ applicationID: string; sessionID: string; viewID: string; records: any[] }> = [];
  const readContext = vi.fn(() => {
    if (contextError) throw new Error('context unavailable');
    return context;
  });
  const save = vi.fn<() => Promise<string | undefined>>(async () => 'image');
  const write = vi.fn((segment: string) => { segments.push(JSON.parse(segment)); });
  const transport = {
    platform: 'android',
    invoke(method: string, payload?: any) {
      if (method === 'replay.getContext') return readContext();
      if (method === 'replay.writeSegment') write(payload.segment);
    },
    invokeAsync: save,
  } as unknown as FTNativeTransport;
  const frame = () => ({ rgba: new Uint8Array(16).fill(color), width: 2, height: 2, timestamp: Date.now() });
  const capture = {
    capture: vi.fn(async () => frame()),
    persist: vi.fn(async (value, fingerprint) => ({ path: '/frame', width: value.width, height: value.height, timestamp: value.timestamp, fingerprint })),
    disposeStoredFrame: vi.fn(), setPrivacy() {}, dispose: vi.fn(),
  } satisfies FTCanvasCapture;
  const replay = new FTSessionReplay(transport, capture, {
    onReplayPointer(callback) { listener = callback; return () => {}; },
  });
  const start = () => {
    if (hybrid) { replay.attachHybrid({ touchPrivacy: 'show' }); replay.enterHybrid(); }
    else replay.start({ touchPrivacy: 'show' });
  };
  const stop = () => hybrid ? replay.leaveHybrid() : replay.stop();
  start();
  // Drive captureNow explicitly so deferred stages are deterministic.
  vi.clearAllTimers();
  return {
    original, replay, capture, save, write, segments, readContext, frame, start, stop,
    callback: () => listener,
    setContext: (value: unknown) => { context = value; },
    failContext: (value: boolean) => { contextError = value; },
    changePixels: () => { color = color === 0 ? 255 : 0; },
    touch(id: number) { listener({ eventType: 'down', pointerId: id, normalizedX: 0.5, normalizedY: 0.5, timestamp: Date.now() }); },
    pointers() {
      return segments.flatMap(segment => segment.records.filter(record => record.type === 11 && record.data.source === 9)
        .map(record => ({ id: record.data.pointerId, applicationId: segment.applicationID, sessionId: segment.sessionID, viewId: segment.viewID })));
    },
  };
}

const keys = ['applicationId', 'sessionId', 'viewId'] as const;
describe('Replay pointer context ownership', () => {
  for (const key of keys) {
    it.each(['capture', 'persist', 'encode'] as const)(`retains new ${key} touches while old %s work completes`, async stage => {
      const f = fixture();
      const next = { ...f.original, [key]: 'B' };
      const captured = deferred<ReturnType<typeof f.frame>>();
      const persisted = deferred<Awaited<ReturnType<typeof f.capture.persist>>>();
      const saved = deferred<string>();
      if (stage === 'capture') f.capture.capture.mockReturnValueOnce(captured.promise);
      if (stage === 'persist') f.capture.persist.mockReturnValueOnce(persisted.promise);
      if (stage === 'encode') f.save.mockReturnValueOnce(saved.promise);
      try {
        f.touch(1);
        const pending = f.replay.captureNow();
        await vi.advanceTimersByTimeAsync(0);
        expect(stage === 'capture' ? f.capture.capture : stage === 'persist' ? f.capture.persist : f.save).toHaveBeenCalledOnce();
        f.setContext(next);
        f.touch(2);
        captured.resolve(f.frame());
        persisted.resolve({ path: '/frame', width: 2, height: 2, timestamp: 0, fingerprint: 'fp' });
        saved.resolve('old-image');
        await expect(pending).resolves.toBe(true);
        expect(f.pointers()).toEqual([{ id: 1, ...f.original }]);
        await expect(f.replay.captureNow()).resolves.toBe(true);
        expect(f.pointers()).toEqual([{ id: 1, ...f.original }, { id: 2, ...next }]);
        await expect(f.replay.captureNow()).resolves.toBe(false);
        expect(f.pointers()).toHaveLength(2);
        expect(f.capture.disposeStoredFrame).toHaveBeenCalledTimes(2);
      } finally { f.stop(); }
    });

    it(`drops unsent old ${key} touches before capturing the new context`, async () => {
      const f = fixture();
      const next = { ...f.original, [key]: 'B' };
      try {
        f.touch(1);
        f.setContext(next);
        f.touch(2);
        await f.replay.captureNow();
        expect(f.pointers()).toEqual([{ id: 2, ...next }]);
      } finally { f.stop(); }
    });
  }

  it.each(['dedupe', 'rejected', 'error'] as const)('keeps pointer-only %s output scoped and retains the next view queue', async outcome => {
    const f = fixture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await f.replay.captureNow();
      f.touch(1);
      if (outcome !== 'dedupe') f.changePixels();
      const captured = deferred<ReturnType<typeof f.frame>>();
      f.capture.capture.mockReturnValueOnce(captured.promise);
      if (outcome === 'rejected') f.save.mockResolvedValueOnce(undefined);
      if (outcome === 'error') f.save.mockRejectedValueOnce(new Error('encode failed'));
      const pending = f.replay.captureNow();
      const next = { ...f.original, viewId: 'B' };
      f.setContext(next); f.touch(2);
      captured.resolve(f.frame());
      await expect(pending).resolves.toBe(true);
      expect(f.segments[1]!.records.map(record => record.type)).toEqual([11]);
      expect(f.pointers()).toEqual([{ id: 1, ...f.original }]);
      await f.replay.captureNow();
      expect(f.pointers()).toEqual([{ id: 1, ...f.original }, { id: 2, ...next }]);
    } finally { f.stop(); }
  });

  it.each(['missing', 'malformed', 'throws'] as const)('drops touches when context %s without interrupting input, then recovers', async failure => {
    const f = fixture();
    try {
      f.setContext(failure === 'missing' ? undefined : { viewId: 'only-view' });
      f.failContext(failure === 'throws');
      expect(() => f.touch(1)).not.toThrow();
      f.failContext(false); f.setContext(f.original);
      f.touch(2);
      await f.replay.captureNow();
      expect(f.pointers()).toEqual([{ id: 2, ...f.original }]);
    } finally { f.stop(); }
  });

  it.each([false, true])('discards stopped-generation callbacks and touches on restart (hybrid: %s)', async hybrid => {
    const f = fixture(hybrid);
    try {
      const stale = f.callback();
      f.touch(1); f.stop(); f.start(); vi.clearAllTimers();
      stale({ eventType: 'down', pointerId: 9, normalizedX: 0.5, normalizedY: 0.5, timestamp: 0 });
      f.touch(2);
      await f.replay.captureNow();
      expect(f.pointers()).toEqual([{ id: 2, ...f.original }]);
    } finally { f.stop(); }
  });

  it('removes only the sent events when native writing delivers another input event', async () => {
    const f = fixture();
    try {
      f.touch(1);
      f.write.mockImplementationOnce(segment => { f.segments.push(JSON.parse(segment)); f.touch(2); });
      await f.replay.captureNow();
      await f.replay.captureNow();
      expect(f.pointers()).toEqual([{ id: 1, ...f.original }, { id: 2, ...f.original }]);
    } finally { f.stop(); }
  });

  it('retains interleaved new-context events when the old context is flushed', async () => {
    const f = fixture();
    const next = { ...f.original, viewId: 'B' };
    const saved = deferred<string>();
    f.save.mockReturnValueOnce(saved.promise);
    try {
      f.touch(1);
      const pending = f.replay.captureNow();
      await vi.advanceTimersByTimeAsync(0);
      f.setContext(next); f.touch(2);
      f.setContext(f.original); f.touch(3);
      f.setContext(next); f.touch(4);
      saved.resolve('old-image');
      await pending;
      expect(f.pointers()).toEqual([{ id: 1, ...f.original }, { id: 3, ...f.original }]);
      await f.replay.captureNow();
      expect(f.pointers()).toEqual([
        { id: 1, ...f.original }, { id: 3, ...f.original }, { id: 2, ...next }, { id: 4, ...next },
      ]);
    } finally { f.stop(); }
  });

  it('retains unsent touches after a segment write failure and sends them once on retry', async () => {
    const f = fixture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      f.touch(1);
      f.write.mockImplementationOnce(() => { throw new Error('segment unavailable'); });
      await expect(f.replay.captureNow()).resolves.toBe(false);
      expect(f.pointers()).toEqual([]);
      await expect(f.replay.captureNow()).resolves.toBe(true);
      await expect(f.replay.captureNow()).resolves.toBe(false);
      expect(f.pointers()).toEqual([{ id: 1, ...f.original }]);
    } finally { f.stop(); }
  });
});
