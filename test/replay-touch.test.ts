/// <reference path="../src/creator3/shims.d.ts" />

import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTCreator3PointerSource } from '../src/session-replay/creator3/pointer';
import { FTCreator3TrackingHooks } from '../src/creator3/auto';
import { FTSessionReplay, type FTCanvasCapture } from '../src/session-replay/core/replay';
import { FTRUM } from '../src/core/modules';
import type { FTNativeTransport } from '../src/core/transport';
import type { FTReplayDiagnosticEvent } from '../src/session-replay/core/replay-diagnostics';

const inputState = vi.hoisted(() => ({ handlers: new Map<string, Set<(event: unknown) => void>>() }));
vi.mock('cc', () => ({
  Director: { EVENT_AFTER_SCENE_LAUNCH: 'scene-launch' },
  director: { getScene: () => undefined, on() {}, off() {} },
  Node: { EventType: { TOUCH_START: 'down', TOUCH_MOVE: 'move', TOUCH_END: 'up', TOUCH_CANCEL: 'cancel' } },
  Input: { EventType: { TOUCH_START: 'down', TOUCH_MOVE: 'move', TOUCH_END: 'up', TOUCH_CANCEL: 'cancel' } },
  input: {
    on(type: string, handler: (event: unknown) => void) {
      if (!inputState.handlers.has(type)) inputState.handlers.set(type, new Set());
      inputState.handlers.get(type)!.add(handler);
    },
    off(type: string, handler: (event: unknown) => void) { inputState.handlers.get(type)?.delete(handler); },
  },
  view: { getVisibleSize: () => ({ width: 100, height: 100 }) },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  inputState.handlers.clear();
});

type InputPattern = 'none' | 'held' | 'repeated' | 'burst';

// Runs the real Creator 3 touch hooks, replay scheduler, deduplication and
// encoding. GPU readback and native I/O use deterministic asynchronous fakes;
// this does not simulate iOS run-loop modes or device CPU/GPU contention.
async function run(pattern: InputPattern, motion: 'large' | 'small' = 'large') {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const diagnostics: FTReplayDiagnosticEvent[] = [];
  vi.stubGlobal('__FT_COCOS_REPLAY_BENCHMARK_OBSERVER__', (event: FTReplayDiagnosticEvent) => diagnostics.push(event));
  const times: number[] = [];
  const records: Array<{ type: number; timestamp: number }> = [];
  let actionCount = 0;
  let frameIndex = 0;
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const transport: FTNativeTransport = {
    platform: 'ios',
    invoke<T>(method: string, payload?: unknown): T | undefined {
      if (method === 'replay.getContext') return { applicationId: 'app', sessionId: 'session', viewId: 'view' } as T;
      if (method === 'rum.startAction') actionCount++;
      if (method === 'replay.writeSegment') records.push(...JSON.parse((payload as { segment: string }).segment).records);
      return undefined;
    },
    async invokeAsync<T>(method: string): Promise<T | undefined> {
      await delay(16);
      if (method === 'replay.saveImageV2') return {
        resourceId: `image-${frameIndex}`, byteSize: 4096, width: 100, height: 100, mimeType: 'image/jpeg',
      } as T;
      return `image-${frameIndex}` as T;
    },
  };
  const capture: FTCanvasCapture = {
    async capture() {
      times.push(Date.now());
      await delay(8);
      frameIndex++;
      const rgba = new Uint8Array(100 * 100 * 4).fill(motion === 'large' ? (frameIndex % 2 ? 20 : 230) : 20);
      for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
      if (motion === 'small') {
        // Four bright pixels move on every capture, below the 1% static threshold.
        const start = (100 + frameIndex * 13) * 4;
        rgba.fill(255, start, start + 16);
      }
      return { rgba, width: 100, height: 100, timestamp: Date.now() };
    },
    async persist(frame, fingerprint) {
      await delay(4);
      return { path: '/fake/frame.rgba', width: frame.width, height: frame.height, timestamp: frame.timestamp, fingerprint };
    },
    async disposeStoredFrame() { await delay(4); },
    setPrivacy() {},
  };
  const hooks = new FTCreator3TrackingHooks();
  const rum = new FTRUM(transport);
  const stopActions = hooks.onAction((name, attributes) => rum.startAction(name, 'click', attributes));
  const replay = new FTSessionReplay(transport, capture, new FTCreator3PointerSource());
  const emit = (type: string) => inputState.handlers.get(type)?.forEach((handler) => handler({
    target: { name: 'Attack' }, getID: () => 1, getUILocation: () => ({ x: 50, y: 50 }),
  }));
  replay.start({ captureFps: 2, touchPrivacy: 'show', imagePolicy: {} });
  let inputTimer: ReturnType<typeof setInterval> | undefined;
  if (pattern === 'held') emit('down');
  if (pattern === 'repeated') inputTimer = setInterval(() => { emit('down'); emit('up'); }, 50);
  if (pattern === 'burst') for (let i = 0; i < 600; i++) { emit('down'); emit('up'); }
  try {
    await vi.advanceTimersByTimeAsync(10_000);
    return { times, images: records.filter((record) => record.type === 10), pointers: records.filter((record) => record.type === 11), actionCount, diagnostics };
  } finally {
    if (inputTimer !== undefined) clearInterval(inputTimer);
    replay.stop();
    stopActions();
    vi.clearAllTimers();
  }
}

describe('touch input versus replay capture', () => {
  it.each(['held', 'repeated', 'burst'] as const)('preserves image timing and count with %s input', async (pattern) => {
    const baseline = await run('none');
    const touched = await run(pattern);
    expect(baseline.images).toHaveLength(20);
    expect(touched.images).toEqual(baseline.images);
    expect(touched.times).toEqual(baseline.times);
    expect(touched.pointers.length).toBeGreaterThan(0);
    expect(touched.actionCount).toBe(pattern === 'repeated' ? 200 : pattern === 'burst' ? 600 : 0);
    expect(touched.diagnostics.filter((event) => event.type === 'capture_skipped')).toEqual([]);
    if (pattern === 'burst') expect(touched.pointers).toHaveLength(512);
  });

  it('refreshes sub-threshold motion within two seconds plus one capture interval, even during repeated clicks', async () => {
    const baseline = await run('none', 'small');
    const touched = await run('repeated', 'small');
    expect(baseline.times.length).toBeGreaterThan(18);
    expect(touched.times).toEqual(baseline.times);
    expect(baseline.images.length).toBeGreaterThanOrEqual(5);
    const imageTimes = baseline.images.map((image) => image.timestamp);
    expect(Math.max(...imageTimes.slice(1).map((time, i) => time - imageTimes[i]!))).toBeLessThan(2_600);
    expect(touched.images).toEqual(baseline.images);
    const skips = (events: FTReplayDiagnosticEvent[]) => events.filter((event) => event.type === 'capture_skipped');
    expect(skips(baseline.diagnostics).length).toBeGreaterThan(0);
    expect(skips(baseline.diagnostics).every((event) => event.type === 'capture_skipped' && event.reason === 'approx_static')).toBe(true);
    expect(skips(touched.diagnostics)).toEqual(skips(baseline.diagnostics));
    expect(touched.pointers.length).toBeGreaterThan(0);
  });
});
