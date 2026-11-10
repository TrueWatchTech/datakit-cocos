import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTSessionReplay, type FTCanvasCapture } from '../src/session-replay/core/replay';
import type { FTCapturedFrame, FTStoredFrame } from '../src/session-replay/core/types';
import { invokeReplayAsync } from '../src/session-replay/core/replay-async-transport';
import { persistReplayFrame, disposeReplayFrame } from '../src/session-replay/core/replay-file';
import type { FTNativeTransport } from '../src/core/transport';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup() {
  const save = deferred<string | undefined>();
  const cleanup = deferred<void>();
  const invoke = vi.fn((method: string) => method === 'replay.getContext'
    ? { applicationId: 'app', sessionId: 'session', viewId: 'view' } : undefined);
  const transport = { platform: 'ios', invoke, invokeAsync: vi.fn(() => save.promise) } as unknown as FTNativeTransport;
  const capture: FTCanvasCapture = {
    capture: vi.fn(async () => ({ rgba: new Uint8Array(16), width: 2, height: 2, timestamp: 1 })),
    persist: vi.fn(async () => ({ path: '/frame', width: 2, height: 2, timestamp: 1, fingerprint: 'fp' })),
    disposeStoredFrame: vi.fn(() => cleanup.promise),
    dispose: vi.fn(),
    setPrivacy() {},
  };
  return { save, cleanup, invoke, transport, capture, replay: new FTSessionReplay(transport, capture) };
}

describe('asynchronous Replay lifecycle', () => {
  it('holds captured pixels without starting storage until the display yield completes', async () => {
    const state = setup();
    const gate = deferred<void>();
    state.capture.deferProcessing = vi.fn(() => gate.promise);
    const pending = state.replay.captureNow();
    await vi.waitFor(() => expect(state.capture.deferProcessing).toHaveBeenCalledOnce());
    expect(state.capture.persist).not.toHaveBeenCalled();
    expect(state.transport.invokeAsync).not.toHaveBeenCalled();
    gate.resolve();
    state.save.resolve('image');
    state.cleanup.resolve();
    await expect(pending).resolves.toBe(true);
    expect(state.capture.persist).toHaveBeenCalledOnce();
  });

  it('discards a captured frame when stopped during the display yield', async () => {
    vi.useFakeTimers();
    const state = setup();
    const gate = deferred<void>();
    state.capture.deferProcessing = vi.fn(() => gate.promise);
    vi.mocked(state.capture.dispose!).mockImplementation(() => gate.resolve());
    state.replay.start();
    const pending = state.replay.captureNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.capture.deferProcessing).toHaveBeenCalledOnce();
    state.replay.stop();
    await expect(pending).resolves.toBe(false);
    expect(state.capture.persist).not.toHaveBeenCalled();
    expect(state.transport.invokeAsync).not.toHaveBeenCalled();
    expect(state.capture.dispose).toHaveBeenCalledOnce();
  });

  it.each(['capture', 'persist', 'encode'] as const)(
    'discards pending %s work across standalone stop/restart and can capture again', async stage => {
      vi.useFakeTimers();
      const state = setup();
      const frame = { rgba: new Uint8Array(16), width: 2, height: 2, timestamp: 1 };
      const stored = { path: '/frame', width: 2, height: 2, timestamp: 1, fingerprint: 'fp' };
      const captured = deferred<FTCapturedFrame>();
      const persisted = deferred<FTStoredFrame>();
      if (stage === 'capture') vi.mocked(state.capture.capture).mockReturnValueOnce(captured.promise);
      if (stage === 'persist') vi.mocked(state.capture.persist).mockReturnValueOnce(persisted.promise);
      state.replay.start();
      const pending = state.replay.captureNow();
      await vi.advanceTimersByTimeAsync(0);
      expect(state.capture.capture).toHaveBeenCalledOnce();
      expect(state.capture.persist).toHaveBeenCalledTimes(stage === 'capture' ? 0 : 1);
      expect(state.transport.invokeAsync).toHaveBeenCalledTimes(stage === 'encode' ? 1 : 0);
      state.replay.stop();
      state.replay.start();
      captured.resolve(frame);
      persisted.resolve(stored);
      state.save.resolve('stale-image');
      state.cleanup.resolve();
      await expect(pending).resolves.toBe(false);
      expect(state.capture.disposeStoredFrame).toHaveBeenCalledTimes(stage === 'capture' ? 0 : 1);
      expect(state.invoke.mock.calls.some(([method]) => method === 'replay.writeSegment')).toBe(false);
      vi.mocked(state.transport.invokeAsync!).mockResolvedValue('fresh-image');
      await expect(state.replay.captureNow()).resolves.toBe(true);
      expect(state.invoke.mock.calls.filter(([method]) => method === 'replay.writeSegment')).toHaveLength(1);
      state.replay.stop();
    },
  );

  it.each(['viewId', 'sessionId'] as const)(
    'keeps pending image attribution and initializes the next %s even for identical pixels', async key => {
      const state = setup();
      const original = { applicationId: 'app', sessionId: 'session', viewId: 'view' };
      let context = original;
      state.invoke.mockImplementation(method => method === 'replay.getContext' ? context : undefined);
      const segments: Array<{ viewId: string; segment: string }> = [];
      const invoke = state.transport.invoke.bind(state.transport);
      state.transport.invoke = ((method, payload) => {
        if (method === 'replay.writeSegment') segments.push(payload as typeof segments[number]);
        return invoke(method, payload);
      }) as FTNativeTransport['invoke'];
      const pending = state.replay.captureNow();
      await vi.waitFor(() => expect(state.transport.invokeAsync).toHaveBeenCalledOnce());
      context = { ...original, [key]: 'next' };
      state.save.resolve('old-context-image');
      state.cleanup.resolve();
      await expect(pending).resolves.toBe(true);
      vi.mocked(state.transport.invokeAsync!).mockResolvedValue('new-context-image');
      await expect(state.replay.captureNow()).resolves.toBe(true);
      expect(segments).toHaveLength(2);
      for (const [index, expected] of [original, context].entries()) {
        const segment = segments[index]!;
        const envelope = JSON.parse(segment.segment);
        expect(segment.viewId).toBe(expected.viewId);
        expect(envelope).toMatchObject({ applicationID: expected.applicationId, sessionID: expected.sessionId, viewID: expected.viewId });
        expect(envelope.records.map((record: { type: number }) => record.type)).toEqual([4, 6, 10]);
        expect(envelope.records[2].data.wireframes[0].resourceId).toBe(index ? 'new-context-image' : 'old-context-image');
      }
    },
  );

  it.each(['standalone', 'hybrid', 'rollback'] as const)('releases capture resources on %s shutdown', mode => {
    vi.useFakeTimers();
    const { replay, capture } = setup();
    if (mode === 'standalone') {
      replay.start();
      replay.stop();
    } else {
      replay.attachHybrid({});
      if (mode === 'hybrid') {
        replay.enterHybrid();
        replay.leaveHybrid();
      } else replay.detachHybrid();
    }
    expect(capture.dispose).toHaveBeenCalledOnce();
  });

  it('holds one frame and its file until encoding and cleanup complete', async () => {
    const state = setup();
    const pending = state.replay.captureNow();
    await vi.waitFor(() => expect(state.transport.invokeAsync).toHaveBeenCalled());
    expect(state.invoke.mock.calls.some(([method]) => method === 'replay.saveImage')).toBe(false);
    expect(state.capture.disposeStoredFrame).not.toHaveBeenCalled();
    await expect(state.replay.captureNow()).resolves.toBe(false);
    state.save.resolve('image');
    await vi.waitFor(() => expect(state.capture.disposeStoredFrame).toHaveBeenCalledOnce());
    await expect(state.replay.captureNow()).resolves.toBe(false);
    state.cleanup.resolve();
    await expect(pending).resolves.toBe(true);
    expect(state.capture.capture).toHaveBeenCalledOnce();
    expect(state.invoke.mock.calls.filter(([method]) => method === 'replay.writeSegment')).toHaveLength(1);
  });

  it.each(['resolve', 'reject'] as const)('discards an encoding %s after leaving Hybrid', async (completion) => {
    vi.useFakeTimers();
    const state = setup();
    state.replay.attachHybrid({});
    state.replay.enterHybrid();
    const pending = state.replay.captureNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.transport.invokeAsync).toHaveBeenCalledOnce();
    state.replay.leaveHybrid();
    state.replay.enterHybrid();
    if (completion === 'resolve') state.save.resolve('stale-image');
    else state.save.reject(new Error('failed after leaving'));
    state.cleanup.resolve();
    await expect(pending).resolves.toBe(false);
    expect(state.capture.disposeStoredFrame).toHaveBeenCalledOnce();
    expect(state.invoke.mock.calls.some(([method]) => method === 'replay.writeSegment')).toBe(false);
    state.replay.leaveHybrid();
  });

  it('cleans a file after an encoder error and releases busy even if cleanup fails', async () => {
    const state = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = state.replay.captureNow();
    await vi.waitFor(() => expect(state.transport.invokeAsync).toHaveBeenCalled());
    state.save.reject(new Error('encoding failed'));
    await vi.waitFor(() => expect(state.capture.disposeStoredFrame).toHaveBeenCalled());
    state.cleanup.reject(new Error('cleanup failed'));
    await expect(pending).rejects.toThrow('cleanup failed');
    (state.capture.capture as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await expect(state.replay.captureNow()).resolves.toBe(false);
    expect(state.capture.capture).toHaveBeenCalledTimes(2);
  });
});

describe('native async protocols', () => {
  it('polls without calling synchronous image encoding and preserves native error envelopes', async () => {
    vi.useFakeTimers();
    let polls = 0;
    const invoke = vi.fn((method: string) => method === 'replay.beginSaveImage' ? 'job'
      : ++polls === 1 ? { pending: true } : { pending: false, response: '{"ok":false,"error":"encode failed"}' });
    const promise = invokeReplayAsync({ invoke } as unknown as FTNativeTransport, 'replay.saveImage', { path: '/frame' });
    const assertion = expect(promise).rejects.toThrow('encode failed');
    await vi.advanceTimersByTimeAsync(32);
    await assertion;
    expect(invoke.mock.calls.map(([method]) => method)).toEqual([
      'replay.beginSaveImage', 'replay.pollSaveImage', 'replay.pollSaveImage',
    ]);
  });

  it('waits for native file completion and keeps the file until explicitly disposed', async () => {
    vi.useFakeTimers();
    const native = { write: vi.fn(() => true), poll: vi.fn(() => 'pending'), remove: vi.fn(() => true) };
    vi.stubGlobal('__ftCocosReplayFile', native);
    const frame = { rgba: new Uint8Array(16), width: 2, height: 2, timestamp: 1 };
    const saved = persistReplayFrame(frame, 'fp', '/tmp/');
    let completed = false;
    void saved.then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(32);
    expect(completed).toBe(false);
    native.poll.mockReturnValue('written');
    await vi.advanceTimersByTimeAsync(16);
    expect((await saved).path).toMatch(/^\/tmp\/cocos-sdk-replay-.*-fp.rgba$/);
    expect(native.remove).not.toHaveBeenCalled();
    const removed = disposeReplayFrame(await saved);
    native.poll.mockReturnValue('removed');
    await vi.advanceTimersByTimeAsync(16);
    await removed;
    expect(native.remove).toHaveBeenCalledOnce();
  });

  it('fails explicitly when a native rebuild is missing', async () => {
    vi.stubGlobal('__ftCocosReplayFile', undefined);
    await expect(persistReplayFrame({ rgba: new Uint8Array(4), width: 1, height: 1, timestamp: 0 }, 'fp', '/tmp/'))
      .rejects.toThrow(/Rebuild the native project/);
  });
});
