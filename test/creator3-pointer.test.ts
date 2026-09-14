/// <reference path="../src/creator3/shims.d.ts" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FTReplayPointerEvent } from '../src/session-replay/core/replay';

const engine = vi.hoisted(() => ({
  dispatchers: [] as Array<{ priority: number; dispatchEvent(event: any): boolean; onThrowException(): void }>,
  global: new Map<string, Set<(event: any) => void>>(),
  sceneRegistered: false,
  ui: [] as string[],
  input: {} as any,
}));
vi.mock('cc', () => {
  const EventType = { TOUCH_START: 'down', TOUCH_MOVE: 'move', TOUCH_END: 'up', TOUCH_CANCEL: 'cancel' };
  return {
    Input: { EventType }, Node: { EventType }, input: engine.input,
    Director: { EVENT_AFTER_SCENE_LAUNCH: 'scene-launch' },
    director: { on() {}, off() {}, getScene: () => ({
      // Scene.on registers a pointer processor even with useCapture=true.
      // Scene has _uiProps but no UITransform: Creator 3.8.8 sorting then fails.
      on() { engine.sceneRegistered = true; }, off() { engine.sceneRegistered = false; },
    }) },
    view: { getVisibleSize: () => ({ width: 200, height: 100 }), getVisibleOrigin: () => ({ x: 10, y: 20 }) },
  };
});

let Source: typeof import('../src/session-replay/creator3/pointer').FTCreator3PointerSource;
beforeEach(async () => {
  engine.sceneRegistered = false;
  engine.ui = [];
  engine.global.clear();
  engine.dispatchers = [
    { priority: 1, onThrowException() {}, dispatchEvent(event) {
      if (engine.sceneRegistered) throw new TypeError("Cannot read properties of null (reading 'cameraPriority')");
      if (!event.uiHit) return true;
      engine.ui.push(event.type);
      event.propagationStopped = true;
      return false;
    } },
    { priority: 0, onThrowException() {}, dispatchEvent(event) {
      engine.global.get(event.type)?.forEach((callback) => callback(event)); return true;
    } },
  ];
  Object.assign(engine.input, {
    _registerEventDispatcher(dispatcher: typeof engine.dispatchers[number]) {
      engine.dispatchers.push(dispatcher);
      engine.dispatchers.sort((a, b) => b.priority - a.priority);
    },
    on(type: string, callback: (event: any) => void) {
      if (!engine.global.has(type)) engine.global.set(type, new Set());
      engine.global.get(type)!.add(callback);
    },
    off(type: string, callback: (event: any) => void) { engine.global.get(type)?.delete(callback); },
  });
  vi.resetModules();
  Source = (await import('../src/session-replay/creator3/pointer')).FTCreator3PointerSource;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function touch(type: string, uiHit = true, id = 1, x = 60, y = 45) {
  return { type, uiHit, getID: () => id, getUILocation: () => ({ x, y }), propagationStopped: false, preventSwallow: false };
}
function dispatch(event: ReturnType<typeof touch>): void {
  for (const dispatcher of engine.dispatchers) {
    if (!dispatcher.dispatchEvent(event)) break;
  }
}

describe('Creator 3 replay does not alter business input dispatch', () => {
  it('records UI down/up without registering the non-UI Scene or blocking the button', () => {
    vi.useFakeTimers(); vi.setSystemTime(1234);
    const records: FTReplayPointerEvent[] = [];
    const stop = new Source().onReplayPointer((event) => records.push(event));
    const down = touch('down');
    expect(() => dispatch(down)).not.toThrow();
    vi.setSystemTime(1250); dispatch(touch('up'));
    expect(engine.ui).toEqual(['down', 'up']);
    expect(engine.sceneRegistered).toBe(false);
    expect(records).toEqual([
      { eventType: 'down', pointerId: 1, normalizedX: .25, normalizedY: .75, timestamp: 1234 },
      { eventType: 'up', pointerId: 1, normalizedX: .25, normalizedY: .75, timestamp: 1250 },
    ]);
    expect(down.preventSwallow).toBe(false);
    stop();
  });

  it('preserves joystick moves/cancellation and global input outside UI without duplicates', () => {
    const records: FTReplayPointerEvent[] = [];
    const global = vi.fn(); engine.input.on('up', global);
    const stop = new Source().onReplayPointer((event) => records.push(event));
    dispatch(touch('down')); dispatch(touch('move', true, 1, 110, 70));
    dispatch(touch('down', false, 2)); dispatch(touch('cancel'));
    const outside = touch('up', false, 2); dispatch(outside);
    expect(records.map((event) => [event.eventType, event.pointerId])).toEqual([
      ['down', 1], ['move', 1], ['down', 2], ['up', 1], ['up', 2],
    ]);
    expect(engine.ui).toEqual(['down', 'move', 'cancel']);
    expect(global).toHaveBeenCalledExactlyOnceWith(outside);
    expect(outside).toMatchObject({ propagationStopped: false, preventSwallow: false });
    stop();
  });

  it('records every finger when the engine reuses EventTouch, and ignores non-touch events', () => {
    const records: FTReplayPointerEvent[] = [];
    const stop = new Source().onReplayPointer((event) => records.push(event));
    let id = 1;
    const event = { ...touch('down'), getID: () => id };
    dispatch(event); id = 2; dispatch(event);
    event.type = 'move'; dispatch(event); dispatch(event);
    dispatch(touch('key-down', false));
    expect(records.map((record) => [record.eventType, record.pointerId])).toEqual([
      ['down', 1], ['down', 2], ['move', 2], ['move', 2],
    ]);
    stop();
  });

  it('does not let replay exceptions stop UI or global listeners', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stop = new Source().onReplayPointer(() => { throw new Error('recorder failed'); });
    const global = vi.fn(); engine.input.on('up', global);
    expect(() => dispatch(touch('down'))).not.toThrow();
    expect(() => dispatch(touch('up', false))).not.toThrow();
    expect(engine.ui).toEqual(['down']); expect(global).toHaveBeenCalledOnce();
    stop();
  });

  it('reuses one passive dispatcher and releases recording callbacks on stop', () => {
    const first = vi.fn(), second = vi.fn();
    const source = new Source();
    const stopFirst = source.onReplayPointer(first);
    const stopSecond = new Source().onReplayPointer(second);
    expect(engine.dispatchers).toHaveLength(3);
    dispatch(touch('down')); stopFirst(); dispatch(touch('move'));
    expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledTimes(2);
    stopSecond(); dispatch(touch('up'));
    expect(second).toHaveBeenCalledTimes(2);
    const stopAgain = source.onReplayPointer(first);
    expect(engine.dispatchers).toHaveLength(3);
    dispatch(touch('down')); expect(first).toHaveBeenCalledTimes(2);
    stopAgain();
    expect(engine.ui).toEqual(['down', 'move', 'up', 'down']);
  });

  it('keeps business input working when the internal dispatcher hook is unavailable', () => {
    delete engine.input._registerEventDispatcher;
    const records: FTReplayPointerEvent[] = [];
    const stop = new Source().onReplayPointer((event) => records.push(event));
    dispatch(touch('down')); dispatch(touch('up'));
    expect(engine.ui).toEqual(['down', 'up']);
    dispatch(touch('down', false)); dispatch(touch('move', false)); dispatch(touch('up', false));
    expect(records.map((event) => event.eventType)).toEqual(['down', 'move', 'up']);
    stop(); dispatch(touch('down', false)); expect(records).toHaveLength(3);
    expect(engine.sceneRegistered).toBe(false);
  });
});
