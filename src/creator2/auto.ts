import type { FTEngineTrackingHooks } from '../core/auto-tracking.js';
import type { FTAttributes } from '../core/types.js';

export class FTCreator2TrackingHooks implements FTEngineTrackingHooks {
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
