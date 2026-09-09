import type { FTEngineTrackingHooks } from '../core/auto-tracking.js';
import type { FTReplayPointerEvent, FTReplayPointerSource } from '../core/replay.js';
import type { FTAttributes } from '../core/types.js';

export class FTCreator2TrackingHooks implements FTEngineTrackingHooks, FTReplayPointerSource {
  onSceneChanged(callback: (name: string) => void, includeCurrent = true): () => void {
    const handler = (): void => callback(cc.director.getScene()?.name || 'UnknownScene');
    cc.director.on(cc.Director.EVENT_AFTER_SCENE_LAUNCH, handler);
    if (includeCurrent && cc.director.getScene()) handler();
    return () => cc.director.off(cc.Director.EVENT_AFTER_SCENE_LAUNCH, handler);
  }

  onAction(callback: (name: string, attributes?: FTAttributes) => void): () => void {
    const handler = (event: any): void => {
      const location = event.getLocation?.();
      callback(event.target?.name || 'CocosTouch', location ? { x: location.x, y: location.y } : undefined);
    };
    return onSceneTouch(cc.Node.EventType.TOUCH_END, handler);
  }

  onReplayPointer(callback: (event: FTReplayPointerEvent) => void): () => void {
    const onStart = (event: any): void => callback(replayPointer(event, 'down'));
    const onEnd = (event: any): void => callback(replayPointer(event, 'up'));
    const stops = [
      onSceneTouch(cc.Node.EventType.TOUCH_START, onStart),
      onSceneTouch(cc.Node.EventType.TOUCH_END, onEnd),
      onSceneTouch(cc.Node.EventType.TOUCH_CANCEL, onEnd),
    ];
    return () => {
      stops.reverse().forEach((stop) => stop());
    };
  }
}

function onSceneTouch(type: string, handler: (event: any) => void): () => void {
  let scene: any;
  const bind = (): void => {
    scene?.off(type, handler, undefined, true);
    scene = cc.director.getScene();
    scene?.on(type, handler, undefined, true);
  };
  cc.director.on(cc.Director.EVENT_AFTER_SCENE_LAUNCH, bind);
  bind();
  return () => {
    cc.director.off(cc.Director.EVENT_AFTER_SCENE_LAUNCH, bind);
    scene?.off(type, handler, undefined, true);
  };
}

function replayPointer(event: any, eventType: 'down' | 'up'): FTReplayPointerEvent {
  const location = event.getLocation?.() || { x: 0, y: 0 };
  const size = cc.view.getVisibleSize?.() || { width: 1, height: 1 };
  const origin = cc.view.getVisibleOrigin?.() || { x: 0, y: 0 };
  return {
    eventType,
    pointerId: event.getID?.() ?? event.touch?.getID?.() ?? 0,
    normalizedX: size.width > 0 ? (location.x - origin.x) / size.width : 0,
    normalizedY: size.height > 0 ? 1 - ((location.y - origin.y) / size.height) : 0,
    timestamp: Date.now(),
  };
}
