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
  let detach = () => {};
  const bind = (): void => {
    detach();
    const scene = cc.director.getScene();
    if (!scene) { detach = () => {}; return; }
    // Capture descendant events without installing a native hit-test listener on Scene.
    const dispatchOnly = typeof scene._onDispatch === 'function' && typeof scene._offDispatch === 'function';
    const on = dispatchOnly ? scene._onDispatch : scene.on;
    const off = dispatchOnly ? scene._offDispatch : scene.off;
    on.call(scene, type, handler, undefined, true);
    detach = () => off.call(scene, type, handler, undefined, true);
  };
  cc.director.on(cc.Director.EVENT_AFTER_SCENE_LAUNCH, bind);
  bind();
  return () => {
    cc.director.off(cc.Director.EVENT_AFTER_SCENE_LAUNCH, bind);
    detach();
  };
}

function replayPointer(event: any, eventType: 'down' | 'up'): FTReplayPointerEvent {
  const location = event.getLocation?.() || { x: 0, y: 0 };
  const size = cc.view.getCanvasSize();
  const viewport = cc.view.getViewportRect();
  // Creator 2 has already removed the viewport offset and scale from touches.
  // Convert back to the full canvas used by Replay, including letterboxing.
  const x = location.x * cc.view.getScaleX() + viewport.x;
  const y = location.y * cc.view.getScaleY() + viewport.y;
  return {
    eventType,
    pointerId: event.getID?.() ?? event.touch?.getID?.() ?? 0,
    normalizedX: size.width > 0 ? x / size.width : 0,
    normalizedY: size.height > 0 ? 1 - y / size.height : 0,
    timestamp: Date.now(),
  };
}
