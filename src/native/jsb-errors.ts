import { observationState, type FTObservationGlobal } from '../core/observation.js';

type ErrorCallback = (location: string, message: string, stack: string) => unknown;
export interface FTJsbErrorObservation { timestampMs: number; context?: unknown; }
type ErrorObserver = (location: string, message: string, stack: string, observation: FTJsbErrorObservation) => void;

export interface FTJsbErrorSource {
  readonly protocol: 2;
  subscribe(callback: ErrorObserver, captureContext?: () => unknown): () => void;
}

export interface FTJsbErrorGlobal extends FTObservationGlobal {
  jsb?: { onError?: (callback: ErrorCallback) => unknown };
  __FT_COCOS_JSB_ERRORS__?: FTJsbErrorSource;
}

/** Run before the engine adapter registers its error callback. JSB has no getter. */
export function installJsbErrorSource(target: FTJsbErrorGlobal): void {
  const jsb = target.jsb;
  if (!jsb?.onError || target.__FT_COCOS_JSB_ERRORS__) return;
  const register = jsb.onError;
  let handler: ErrorCallback | undefined;
  const state = observationState(target);
  let observing = 0;
  const subscribers: Array<{ callback: ErrorObserver; captureContext?: () => unknown; active: boolean }> = [];
  const dispatch: ErrorCallback = function (this: unknown, location, message, stack): unknown {
    // Capture only local metadata before the original handler can change scenes.
    // Monitoring reentry suppresses observations, never the original handler.
    const observations: Array<{ subscriber: typeof subscribers[number]; observation: FTJsbErrorObservation }> = [];
    try {
      if (!state.reporting && !observing) {
        observing++;
        try {
          const timestampMs = Date.now();
          for (const subscriber of subscribers.slice()) {
            try {
              observations.push({ subscriber, observation: { timestampMs, context: subscriber.captureContext?.() } });
            } catch { /* A failed snapshot cannot change native error delivery. */ }
          }
        } finally { observing--; }
      }
    } catch { /* Preserve the original handler even if observation preparation fails. */ }
    try {
      return handler?.call(this, location, message, stack);
    } finally {
      for (const { subscriber, observation } of observations) {
        if (!subscriber.active) continue;
        observing++;
        try { subscriber.callback(location, message, stack, observation); } catch { /* Preserve the original outcome. */ }
        finally { observing--; }
      }
    }
  };
  jsb.onError = function (...args: unknown[]): unknown {
    // Preserve argument count as well as type validation (the native API expects exactly one argument).
    if (args.length !== 1 || typeof args[0] !== 'function') return register.apply(this, args as [ErrorCallback]);
    const callback = args[0] as ErrorCallback;
    const result = register.call(this, subscribers.length ? dispatch : callback);
    handler = callback;
    return result;
  };
  target.__FT_COCOS_JSB_ERRORS__ = {
    protocol: 2,
    subscribe(callback, captureContext): () => void {
      if (subscribers.length === 0) register.call(jsb, dispatch);
      const subscriber = { callback, captureContext, active: true };
      subscribers.push(subscriber);
      return () => {
        if (!subscriber.active) return;
        subscriber.active = false;
        const index = subscribers.indexOf(subscriber);
        if (index >= 0) subscribers.splice(index, 1);
        if (subscribers.length === 0 && handler) register.call(jsb, handler);
      };
    },
  };
}
