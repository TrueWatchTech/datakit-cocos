import { Director, Input, director, input } from 'cc';
import type { FTEngineTrackingHooks } from '../core/auto-tracking.js';
import type { FTAttributes } from '../core/types.js';

export class FTCreator3TrackingHooks implements FTEngineTrackingHooks {
  onSceneChanged(callback: (name: string) => void, includeCurrent = true): () => void {
    const handler = (): void => callback(director.getScene()?.name || 'UnknownScene');
    director.on(Director.EVENT_AFTER_SCENE_LAUNCH, handler);
    if (includeCurrent && director.getScene()) handler();
    return () => director.off(Director.EVENT_AFTER_SCENE_LAUNCH, handler);
  }

  onAction(callback: (name: string, attributes?: FTAttributes) => void): () => void {
    const handler = (event: any): void => {
      const location = event.getUILocation?.() || event.getLocation?.();
      callback(event.target?.name || 'CocosTouch', location ? { x: location.x, y: location.y } : undefined);
    };
    return onTouch(Input.EventType.TOUCH_END, handler);
  }
}

function onTouch(type: string, callback: (event: any) => void): () => void {
  // UI nodes consume touches before the global input dispatcher in Creator 3.
  // Capture those at the scene root, retaining global input for non-UI touches.
  // One EventTouch can contain several fingers and pass through multiple nodes.
  const seen = new WeakMap<object, Set<number>>();
  const handler = (event: any): void => {
    const id = event.getID?.() ?? event.touch?.getID?.() ?? 0;
    let pointers = seen.get(event);
    if (pointers?.has(id)) return;
    if (!pointers) seen.set(event, pointers = new Set());
    pointers.add(id);
    callback(event);
  };
  let scene: any;
  const bind = (): void => {
    scene?.off(type, handler, undefined, true);
    scene = director.getScene();
    scene?.on(type, handler, undefined, true);
  };
  director.on(Director.EVENT_AFTER_SCENE_LAUNCH, bind);
  input.on(type, handler);
  bind();
  return () => {
    director.off(Director.EVENT_AFTER_SCENE_LAUNCH, bind);
    scene?.off(type, handler, undefined, true);
    input.off(type, handler);
  };
}
