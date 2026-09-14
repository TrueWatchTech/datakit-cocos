import { Input, input, view } from 'cc';
import type { FTReplayPointerEvent, FTReplayPointerSource } from '../core/replay.js';

type PointerCallback = (event: FTReplayPointerEvent) => void;

// Creator has no dispatcher removal API. Install one passive observer per input
// instance and release all recording callbacks when replay stops.
const observers = new WeakMap<object, Set<PointerCallback>>();

export class FTCreator3PointerSource implements FTReplayPointerSource {
  onReplayPointer(callback: PointerCallback): () => void {
    const engineInput = input as typeof input & {
      _registerEventDispatcher?: (dispatcher: {
        priority: number;
        dispatchEvent(event: any): boolean;
        onThrowException(): void;
      }) => void;
    };
    if (typeof engineInput._registerEventDispatcher === 'function') {
      let callbacks = observers.get(engineInput);
      if (!callbacks) {
        callbacks = new Set<PointerCallback>();
        const active = callbacks;
        // This engine-internal hook is also used by Creator's UI dispatcher.
        // Observe before UI consumption without adding hit-testable nodes,
        // changing event flags, or interfering with the business input chain.
        engineInput._registerEventDispatcher({
          priority: Number.MAX_SAFE_INTEGER,
          dispatchEvent(event: any): boolean {
            if (active.size > 0) {
              const eventType = pointerType(event.type);
              if (eventType) {
                for (const listener of active) deliverPointer(listener, event, eventType);
              }
            }
            return true;
          },
          onThrowException(): void {},
        });
        observers.set(engineInput, callbacks);
      }
      callbacks.add(callback);
      return () => { callbacks.delete(callback); };
    }

    // Older engines without the dispatcher hook retain global input tracking.
    const listeners = [
      [Input.EventType.TOUCH_START, 'down'],
      [Input.EventType.TOUCH_MOVE, 'move'],
      [Input.EventType.TOUCH_END, 'up'],
      [Input.EventType.TOUCH_CANCEL, 'up'],
    ].map(([type, eventType]) => ({
      type,
      handler: (event: any): void => deliverPointer(callback, event, eventType as FTReplayPointerEvent['eventType']),
    }));
    for (const { type, handler } of listeners) input.on(type, handler);
    return () => {
      for (const { type, handler } of listeners) input.off(type, handler);
    };
  }
}

function pointerType(type: string): FTReplayPointerEvent['eventType'] | undefined {
  if (type === Input.EventType.TOUCH_START) return 'down';
  if (type === Input.EventType.TOUCH_MOVE) return 'move';
  if (type === Input.EventType.TOUCH_END || type === Input.EventType.TOUCH_CANCEL) return 'up';
  return undefined;
}

function deliverPointer(callback: PointerCallback, event: any, eventType: FTReplayPointerEvent['eventType']): void {
  try {
    callback(replayPointer(event, eventType));
  } catch (error) {
    // A replay failure must never abort Creator's remaining input dispatchers.
    console.error('[cocos-sdk] Session Replay pointer dropped:', error);
  }
}

function replayPointer(event: any, eventType: FTReplayPointerEvent['eventType']): FTReplayPointerEvent {
  const location = event.getUILocation?.() || event.getLocation?.() || { x: 0, y: 0 };
  const size = view.getVisibleSize?.() || { width: 1, height: 1 };
  const origin = view.getVisibleOrigin?.() || { x: 0, y: 0 };
  return {
    eventType,
    pointerId: event.getID?.() ?? event.touch?.getID?.() ?? 0,
    normalizedX: size.width > 0 ? (location.x - origin.x) / size.width : 0,
    normalizedY: size.height > 0 ? 1 - ((location.y - origin.y) / size.height) : 0,
    timestamp: Date.now(),
  };
}
