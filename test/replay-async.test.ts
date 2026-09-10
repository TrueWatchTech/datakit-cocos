import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTSessionReplay, type FTCanvasCapture } from '../src/core/replay';
import { invokeReplayAsync } from '../src/core/replay-async-transport';
import { persistReplayFrame, disposeReplayFrame } from '../src/core/replay-file';
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
    setPrivacy() {},
  };
  return { save, cleanup, invoke, transport, capture, replay: new FTSessionReplay(transport, capture) };
}

describe('asynchronous Replay lifecycle', () => {
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
