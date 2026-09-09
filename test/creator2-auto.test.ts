/// <reference path="../src/creator2/shims.d.ts" />

import { describe, expect, it } from 'vitest';
import { FTCreator2TrackingHooks } from '../src/creator2/auto';

type TouchHandler = (event: unknown) => void;

class RecordingScene {
  readonly handlers = new Map<string, TouchHandler>();
  readonly registrations: Array<{ type: string; capture: boolean }> = [];

  on(type: string, handler: TouchHandler, _target: unknown, capture: boolean): void {
    this.handlers.set(type, handler);
    this.registrations.push({ type, capture });
  }

  off(type: string, handler: TouchHandler): void {
    if (this.handlers.get(type) === handler) this.handlers.delete(type);
  }

  emit(type: string, event: unknown): void {
    this.handlers.get(type)?.(event);
  }
}

describe('Creator 2 touch tracking', () => {
  it('captures replay touches from the scene root and rebinds after a scene change', () => {
    const firstScene = new RecordingScene();
    const secondScene = new RecordingScene();
    let currentScene = firstScene;
    const afterSceneLaunch = new Set<() => void>();
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
        getVisibleSize: () => ({ width: 200, height: 100 }),
        getVisibleOrigin: () => ({ x: 0, y: 0 }),
      },
    };

    const events: unknown[] = [];
    const stop = new FTCreator2TrackingHooks().onReplayPointer((event) => events.push(event));
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

    stop();
    expect(secondScene.handlers.size).toBe(0);
    expect(afterSceneLaunch.size).toBe(0);
  });
});
