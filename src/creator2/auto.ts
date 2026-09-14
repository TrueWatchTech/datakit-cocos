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
