/// <reference path="../src/creator3/shims.d.ts" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FTCreator3TrackingHooks } from '../src/creator3/auto';

type Handler = (event: any) => void;
class Events {
  handlers = new Map<string, Set<Handler>>();
  on(type: string, handler: Handler): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
  }
  off(type: string, handler: Handler): void { this.handlers.get(type)?.delete(handler); }
  emit(type: string, event?: any): void { this.handlers.get(type)?.forEach((handler) => handler(event)); }
  count(): number { return [...this.handlers.values()].reduce((n, handlers) => n + handlers.size, 0); }
}
class Scene extends Events {
  override on(type: string, handler: Handler, _target?: unknown, capture?: boolean): void {
    // A button stops bubbling; only ancestors registered for capture observe it.
    if (capture) super.on(type, handler);
  }
}
const state = vi.hoisted(() => ({ scene: undefined as any, input: undefined as any, director: undefined as any }));
vi.mock('cc', () => ({
  Director: { EVENT_AFTER_SCENE_LAUNCH: 'scene' },
  Input: { EventType: { TOUCH_START: 'start', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' } },
  director: {
    getScene: () => state.scene,
    on: (...args: any[]) => state.director.on(...args),
    off: (...args: any[]) => state.director.off(...args),
  },
  input: {
    on: (...args: any[]) => state.input.on(...args),
    off: (...args: any[]) => state.input.off(...args),
  },
  view: { getVisibleSize: () => ({ width: 200, height: 100 }), getVisibleOrigin: () => ({ x: 10, y: 20 }) },
}));
function touch(id = 4) {
  return { getID: () => id, getUILocation: () => ({ x: 60, y: 45 }), target: { name: 'Button' } };
}
beforeEach(() => { state.scene = new Scene(); state.input = new Events(); state.director = new Events(); });
describe('Creator 3 touch tracking', () => {
  it('records UI touches swallowed before global input and preserves normalized coordinates', () => {
    const events: unknown[] = [];
    new FTCreator3TrackingHooks().onReplayPointer((event) => events.push(event));
    state.scene.emit('start', touch());
    state.scene.emit('end', touch());
    expect(events).toEqual([
      expect.objectContaining({ eventType: 'down', pointerId: 4, normalizedX: 0.25, normalizedY: 0.75 }),
      expect.objectContaining({ eventType: 'up', pointerId: 4, normalizedX: 0.25, normalizedY: 0.75 }),
    ]);
  });
  it('keeps non-UI input, deduplicates shared UI events, and preserves every finger', () => {
    const callback = vi.fn();
    new FTCreator3TrackingHooks().onReplayPointer(callback);
    let id = 1;
    const event = { getID: () => id };
    state.scene.emit('start', event);
    state.input.emit('start', event);
    id = 2;
    state.scene.emit('start', event);
    state.input.emit('start', event);
    state.input.emit('end', touch(1));
    expect(callback.mock.calls.map(([event]) => [event.eventType, event.pointerId])).toEqual([
      ['down', 1], ['down', 2], ['up', 1],
    ]);
  });
  it('tracks button actions, rebinds scenes and removes all listeners on stop', () => {
    const action = vi.fn();
    const pointer = vi.fn();
    const hooks = new FTCreator3TrackingHooks();
    const stops = [hooks.onAction(action), hooks.onReplayPointer(pointer)];
    const previous = state.scene;
    state.scene = new Scene();
    state.director.emit('scene');
    expect(previous.count()).toBe(0);
    state.scene.emit('end', touch());
    state.scene.emit('cancel', touch());
    expect(action).toHaveBeenCalledExactlyOnceWith('Button', { x: 60, y: 45 });
    expect(pointer).toHaveBeenCalledTimes(2);
    stops.forEach((stop) => stop());
    expect(state.scene.count()).toBe(0);
    expect(state.input.count()).toBe(0);
    expect(state.director.count()).toBe(0);
  });
});
