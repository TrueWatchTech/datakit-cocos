import type { FTReplayPointerEvent, FTReplayPointerSource } from '../core/replay.js';

export class FTCreator2PointerSource implements FTReplayPointerSource {
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
