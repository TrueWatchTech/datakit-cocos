/// <reference path="../src/creator2/shims.d.ts" />

import { describe, expect, it, vi } from 'vitest';
import { FTCreator2TrackingHooks } from '../src/creator2/auto';
import { FTCreator2PointerSource } from '../src/session-replay/creator2/pointer';

type TouchHandler = (event: unknown) => void;

class RecordingScene {
  readonly handlers = new Map<string, Set<TouchHandler>>();
  readonly registrations: Array<{ type: string; capture: boolean }> = [];

  on(type: string, handler: TouchHandler, _target: unknown, capture: boolean): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    this.registrations.push({ type, capture });
  }

  off(type: string, handler: TouchHandler): void {
    const handlers = this.handlers.get(type);
    handlers?.delete(handler);
    if (!handlers?.size) this.handlers.delete(type);
  }

  emit(type: string, event: unknown): void {
    this.handlers.get(type)?.forEach(handler => handler(event));
  }
}

describe('Creator 2 touch tracking', () => {
  it('captures child touches without installing a native hit-test listener on the Scene', () => {
    class LegacyScene extends RecordingScene {
      readonly scenePropertyRead = vi.fn();

      get activeInHierarchy(): boolean { this.scenePropertyRead(); return true; }

      override on(type: string, handler: TouchHandler, target: unknown, capture: boolean): void {
        // Node.on registers a scene-graph hit-test listener and reads this property.
        void this.activeInHierarchy;
        super.on(type, handler, target, capture);
      }

      _onDispatch(type: string, handler: TouchHandler, target: unknown, capture: boolean): void {
        super.on(type, handler, target, capture);
      }

      _offDispatch(type: string, handler: TouchHandler): void { super.off(type, handler); }
    }

    const first = new LegacyScene();
    const second = new LegacyScene();
    let current = first;
    const sceneChanges = new Set<() => void>();
    (globalThis as unknown as { cc: unknown }).cc = {
      director: {
        getScene: () => current,
        on: (_type: string, handler: () => void) => sceneChanges.add(handler),
        off: (_type: string, handler: () => void) => sceneChanges.delete(handler),
      },
      Director: { EVENT_AFTER_SCENE_LAUNCH: 'after-scene-launch' },
      Node: { EventType: { TOUCH_START: 'touchstart', TOUCH_END: 'touchend', TOUCH_CANCEL: 'touchcancel' } },
      view: {
        getCanvasSize: () => ({ width: 100, height: 100 }),
        getViewportRect: () => ({ x: 0, y: 0 }),
        getScaleX: () => 1, getScaleY: () => 1,
      },
    };
    const existing = vi.fn();
    first._onDispatch('touchend', existing, undefined, true);
    const pointers = vi.fn();
    const actions = vi.fn();
    const stopPointers = new FTCreator2PointerSource().onReplayPointer(pointers);
    const stopActions = new FTCreator2TrackingHooks().onAction(actions);
    const touch = { target: { name: 'Button' }, getID: () => 3, getLocation: () => ({ x: 25, y: 50 }) };

    first.emit('touchstart', touch);
    first.emit('touchend', touch);
    expect(pointers.mock.calls.map(([event]) => event.eventType)).toEqual(['down', 'up']);
    expect(pointers).toHaveBeenLastCalledWith(expect.objectContaining({ pointerId: 3, normalizedX: 0.25, normalizedY: 0.5 }));
    expect(actions).toHaveBeenLastCalledWith('Button', { x: 25, y: 50 });
    expect(existing).toHaveBeenCalledOnce();

    current = second;
    sceneChanges.forEach(handler => handler());
    expect(first.handlers.get('touchend')).toEqual(new Set([existing]));
    second.emit('touchcancel', touch);
    second.emit('touchend', touch);
    expect(pointers).toHaveBeenCalledTimes(4);
    expect(actions).toHaveBeenCalledTimes(2);
    expect([...first.registrations, ...second.registrations].every(item => item.capture)).toBe(true);

    stopPointers();
    stopActions();
    expect(second.handlers.size).toBe(0);
    expect(sceneChanges.size).toBe(0);
    expect(first.scenePropertyRead).not.toHaveBeenCalled();
    expect(second.scenePropertyRead).not.toHaveBeenCalled();
  });

  it('captures replay touches from the scene root and rebinds after a scene change', () => {
    const firstScene = new RecordingScene();
    const secondScene = new RecordingScene();
    let currentScene = firstScene;
    const afterSceneLaunch = new Set<() => void>();
    let canvas = { width: 200, height: 100 };
    let viewport = { x: 0, y: 0 };
    let scale = 1;
    const director = {
      getScene: () => currentScene,
      on: (_type: string, handler: () => void) => { afterSceneLaunch.add(handler); },
      off: (_type: string, handler: () => void) => { afterSceneLaunch.delete(handler); },
    };
    (globalThis as unknown as { cc: unknown }).cc = {
      director,
      Director: { EVENT_AFTER_SCENE_LAUNCH: 'after-scene-launch' },
      Node: {
        EventType: {
          TOUCH_START: 'touchstart',
          TOUCH_END: 'touchend',
          TOUCH_CANCEL: 'touchcancel',
        },
      },
      view: {
        getScaleX: () => scale, getScaleY: () => scale,
        getCanvasSize: () => canvas,
        getViewportRect: () => viewport,
      },
    };

    const events: unknown[] = [];
    const stop = new FTCreator2PointerSource().onReplayPointer((event) => events.push(event));
    expect(firstScene.registrations).toEqual([
      { type: 'touchstart', capture: true },
      { type: 'touchend', capture: true },
      { type: 'touchcancel', capture: true },
    ]);

    firstScene.emit('touchstart', { getLocation: () => ({ x: 50, y: 25 }), getID: () => 4 });
    expect(events[0]).toMatchObject({
      eventType: 'down',
      pointerId: 4,
      normalizedX: 0.25,
      normalizedY: 0.75,
    });

    currentScene = secondScene;
    afterSceneLaunch.forEach((handler) => handler());
    expect(firstScene.handlers.size).toBe(0);
    secondScene.emit('touchcancel', { getLocation: () => ({ x: 100, y: 50 }), getID: () => 4 });
    expect(events[1]).toMatchObject({
      eventType: 'up',
      pointerId: 4,
      normalizedX: 0.5,
      normalizedY: 0.5,
    });

    // SHOW_ALL keeps a 200x100 design area while the native canvas rotates.
    // Touch locations are already in design space; Replay includes the margins.
    for (const size of [{ width: 300, height: 600 }, { width: 600, height: 300 }, { width: 300, height: 600 }]) {
      canvas = size;
      scale = Math.min(size.width / 200, size.height / 100);
      viewport = { x: (size.width - 200 * scale) / 2, y: (size.height - 100 * scale) / 2 };
      secondScene.emit('touchstart', { getLocation: () => ({ x: 50, y: 25 }), getID: () => 4 });
      expect(events[events.length - 1]).toMatchObject({
        normalizedX: 0.25,
        normalizedY: size.height > size.width ? 0.5625 : 0.75,
      });
    }

    stop();
    expect(secondScene.handlers.size).toBe(0);
    expect(afterSceneLaunch.size).toBe(0);
  });
});
