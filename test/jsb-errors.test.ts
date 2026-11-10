import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FTDefaultAutoTracking } from '../src/core/auto-tracking';
import { FTRUM, FTLogger, FTTrace } from '../src/core/modules';
import { FTCocosSDK } from '../src/core/client';
import { installJsbErrorSource, type FTJsbErrorGlobal } from '../src/native/jsb-errors';
import { replayError } from '../src/session-replay/core/internal-errors';

type Callback = (location: string, message: string, stack: string) => void;
const cleanups: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanups.splice(0).reverse().forEach(stop => stop()); vi.useRealTimers(); });

function fixture(initialViewId: string | null = 'native-root') {
  let callback: Callback;
  let viewId = initialViewId, nextView = 0;
  const register = vi.fn((handler: Callback) => { if (typeof handler !== 'function') throw new TypeError('expected function'); callback = handler; });
  const original = vi.fn();
  const calls: Array<{ method: string; payload: any }> = [];
  const transport = { platform: 'android' as const, invoke<T>(method: string, payload?: unknown): T | undefined {
    // Existing native SDKs do not implement the deferred View ID association protocol.
    if (method === 'rum.beginErrorObservation' || method === 'rum.endErrorObservation') {
      throw new Error('Native view association is not supported');
    }
    if (method === 'rum.getViewId') return (viewId || undefined) as T | undefined;
    if (method === 'rum.startView') viewId = `native-${++nextView}`;
    if (method === 'rum.stopView') viewId = null;
    calls.push({ method, payload });
    return undefined;
  } };
  const events = new EventTarget();
  const target = { jsb: { onError: register }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) } as FTJsbErrorGlobal & { addEventListener: typeof events.addEventListener; removeEventListener: typeof events.removeEventListener };
  installJsbErrorSource(target);
  target.jsb!.onError!(original);
  const create = () => {
    const tracking = new FTDefaultAutoTracking(new FTRUM(transport), new FTLogger(transport), new FTTrace(transport), {} as never, target);
    cleanups.push(() => tracking.stop());
    return tracking;
  };
  return { target, transport, calls, original, register, events, create, setViewId: (id: string | null) => { viewId = id; }, rum: new FTRUM(transport), createSDK: () => new FTCocosSDK(transport, create(), 'creator3'), fire: (...args: Parameters<Callback>) => callback(...args), errors: () => calls.filter(c => c.method === 'rum.addError') };
}

describe('native JSB automatic errors', () => {
  it('excludes tagged SDK exceptions and early Promise notifications while preserving original delivery and manual errors', () => {
    const f = fixture(); f.create().start({ errors: true });
    const error = replayError('Missing Replay privacy skinned bounds');
    f.fire('sdk.js:1', error.message, error.stack!);
    f.fire('', 'unhandledRejectedPromise', `${error}\nstacktrace:\n[0]capture@sdk.js:1`);
    f.fire('', 'handlerAddedAfterPromiseRejected', 'stacktrace:\n[0]capture@sdk.js:1');
    vi.runOnlyPendingTimers();
    expect(f.errors()).toEqual([]);
    expect(f.original).toHaveBeenCalledTimes(3);
    // Identical untagged text from an application still belongs to the application.
    f.fire('', 'unhandledRejectedPromise', 'Error: Missing Replay privacy skinned bounds\nframe');
    vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(1);
    expect(f.errors()[0]!.payload.type).toBe('unhandled_promise_rejection');
    f.rum.addError(error.message, error.stack!);
    expect(f.errors()).toHaveLength(2);
  });

  it.each([
    ['TypeError: null', 'update@game.js:4', 'cocos_error'],
    ['unhandledRejectedPromise', 'Error: rejected\nframe', 'unhandled_promise_rejection'],
  ])('deduplicates %s across bursts and frames without starving a different error', (message, stack, type) => {
    const f = fixture(); f.create().start({ errors: true });
    for (let frame = 0; frame < 10; frame++) {
      for (let i = 0; i < 200; i++) f.fire('game.js:4', message!, stack!);
      f.fire('game.js:9', 'ReferenceError: missing', 'click@game.js:9');
      vi.runOnlyPendingTimers();
    }
    expect(f.errors()).toHaveLength(2);
    expect(f.errors()[0]!.payload.type).toBe(type);
    expect(f.errors()[1]!.payload.message).toBe('ReferenceError: missing');
    expect(f.original).toHaveBeenCalledTimes(2010);
  });

  it('distinguishes normalized type, message, stack and fallback location within a view', () => {
    const f = fixture(); f.create().start({ errors: true });
    const errors: Parameters<Callback>[] = [
      ['', 'failed', 'frame A'], ['', 'different', 'frame A'], ['', 'failed', 'frame B'],
      ['', 'unhandledRejectedPromise', 'Error: rejected\nframe'], ['', 'rejected', 'Error: rejected\nframe'],
      ['game.js:1', 'missing stack', ''], ['game.js:2', 'missing stack', ''],
    ];
    for (const error of errors.concat(errors)) f.fire(...error);
    vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(errors.length);
  });

  it('reports both error types again on new native view IDs even with identical view names', () => {
    const f = fixture(); f.create().start({ errors: true });
    for (let view = 0; view < 2; view++) {
      f.rum.startView('Game');
      for (let repeat = 0; repeat < 2; repeat++) {
        f.fire('', 'failed', 'frame');
        f.fire('', 'unhandledRejectedPromise', 'Error: rejected\nframe');
      }
      vi.runOnlyPendingTimers();
    }
    expect(f.errors().map(error => error.payload.type)).toEqual([
      'cocos_error', 'unhandled_promise_rejection', 'cocos_error', 'unhandled_promise_rejection',
    ]);
    // Host-driven view changes must also be observed without a Cocos startView call.
    f.setViewId('host-view');
    f.fire('', 'failed', 'frame'); vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(5);
  });

  it('uses the captured view for deduplication when the original handler changes views', () => {
    const f = fixture(); f.create().start({ errors: true });
    f.fire('', 'failed', 'frame'); vi.runOnlyPendingTimers();
    f.target.jsb!.onError!(() => { f.setViewId('new-native-view'); });
    f.fire('', 'failed', 'frame'); vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(1);
    f.fire('', 'failed', 'frame'); vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(2);
  });

  it('never deduplicates manual errors even when their content matches automatic errors', () => {
    const f = fixture(); f.create().start({ errors: true });
    for (const type of ['cocos_error', 'unhandled_promise_rejection']) {
      f.rum.addError('failed', 'frame', type);
      f.rum.addError('failed', 'frame', type);
    }
    f.fire('', 'failed', 'frame'); f.fire('', 'failed', 'frame'); vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(5);
  });

  it.each(['missing', 'throwing'])('keeps reporting without deduplication when view lookup is %s', mode => {
    const f = fixture(null); f.create().start({ errors: true });
    const invoke = f.transport.invoke.bind(f.transport);
    if (mode === 'throwing') vi.spyOn(f.transport, 'invoke').mockImplementation((method, payload) => {
      if (method === 'rum.getViewId') throw new Error('unsupported bridge method');
      return invoke(method, payload);
    });
    f.fire('', 'failed', 'frame'); f.fire('', 'failed', 'frame'); vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(2);
    expect(f.original).toHaveBeenCalledTimes(2);
  });

  it('uses the existing addError payload without requiring native View ID capabilities', () => {
    const f = fixture(null), tracking = f.create();
    expect(() => tracking.start({ errors: true })).not.toThrow();
    expect(f.calls).toEqual([]);
    f.fire('game.js:4', 'failed', 'original stack');
    expect(f.calls).toEqual([]);
    vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(1);
    expect(f.errors()[0]!.payload).toMatchObject({
      message: 'failed', stack: 'original stack', type: 'cocos_error', state: 'run',
    });
    expect(Object.keys(f.errors()[0]!.payload).sort()).toEqual(['attributes', 'message', 'stack', 'state', 'type']);
    expect(f.errors()[0]!.payload.attributes).not.toHaveProperty('view_id');
    expect(() => tracking.stop()).not.toThrow();
    expect(f.calls.map(call => call.method)).toEqual(['rum.addError']);
  });

  it('bounds queued errors while preserving every original callback and allowing later occurrences', () => {
    const f = fixture(null); f.create().start({ errors: true });
    for (let i = 0; i < 140; i++) f.fire('game.js:4', 'failed', 'frame');
    expect(f.errors()).toHaveLength(0);
    vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(128);
    f.fire('game.js:4', 'failed', 'frame');
    vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(129);
    expect(f.original).toHaveBeenCalledTimes(141);
  });

  it('releases cancelled errors but retains delivered identities across listener restarts', () => {
    const f = fixture(), tracking = f.create(); tracking.start({ errors: true });
    f.fire('', 'delivered', 'frame'); vi.runOnlyPendingTimers();
    f.fire('', 'cancelled', 'frame'); tracking.stop(); vi.runOnlyPendingTimers();
    tracking.start({ errors: true });
    f.fire('', 'delivered', 'frame'); f.fire('', 'cancelled', 'frame'); vi.runOnlyPendingTimers();
    expect(f.errors().map(error => error.payload.message)).toEqual(['delivered', 'cancelled']);
  });

  it('isolates a bridge failure and continues reporting later errors through the legacy method', () => {
    const f = fixture(); f.create().start({ errors: true });
    const invoke = f.transport.invoke.bind(f.transport);
    let fail = true;
    vi.spyOn(f.transport, 'invoke').mockImplementation((method, payload) => {
      if (method === 'rum.addError' && fail) throw new Error('bridge unavailable');
      return invoke(method, payload);
    });
    f.fire('', 'failed', 'frame');
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
    expect(f.errors()).toHaveLength(0);
    fail = false;
    f.fire('', 'failed', 'frame'); vi.runOnlyPendingTimers();
    f.fire('', 'failed', 'frame'); vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(1);
  });

  it('accepts later errors after the shared observation queue has drained', () => {
    const f = fixture();
    const target = Object.assign(f.target, { console: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    f.create().start({ errors: true, console: true });
    for (let i = 0; i < 128; i++) target.console.log('queued log');
    f.fire('', 'failed', 'frame'); vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(0);
    f.fire('', 'failed', 'frame'); vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(1);
  });

  it('continues reporting after a scheduling failure', () => {
    const f = fixture();
    const target = Object.assign(f.target, { setTimeout: (() => { throw new Error('scheduler unavailable'); }) as unknown as typeof setTimeout });
    f.create().start({ errors: true });
    f.fire('', 'failed', 'frame');
    target.setTimeout = setTimeout;
    f.fire('', 'failed', 'frame'); vi.runOnlyPendingTimers();
    expect(f.errors()).toHaveLength(1);
  });

  it('preserves the engine handler and collects real native callback arguments without window events', () => {
    const f = fixture();
    const tracking = f.create();
    tracking.start({ errors: true });
    f.fire('game.js:4', 'Error: timer failed', 'original stack');
    expect(f.original).toHaveBeenCalledExactlyOnceWith('game.js:4', 'Error: timer failed', 'original stack');
    vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(1);
    expect(f.errors()[0]!.payload).toMatchObject({ message: 'Error: timer failed', stack: 'original stack', type: 'cocos_error' });
    // A runtime that also forwards a window event must not double count it.
    f.events.dispatchEvent(Object.assign(new Event('error'), { message: 'Error: timer failed' }));
    vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(1);
  });

  it('keeps business callbacks installed before or after start and restores the latest on stop', () => {
    const f = fixture();
    const before = vi.fn(), after = vi.fn();
    f.target.jsb!.onError!(before);
    const tracking = f.create(); tracking.start({ errors: true });
    f.fire('', 'first', 'stack');
    expect(before).toHaveBeenCalledOnce();
    f.target.jsb!.onError!(after);
    f.fire('', 'second', 'stack');
    vi.runOnlyPendingTimers(); tracking.stop(); f.fire('', 'after stop', 'stack');
    expect(after).toHaveBeenCalledTimes(2);
    expect(before).toHaveBeenCalledOnce();
    vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(2);
    expect(f.register.mock.calls[f.register.mock.calls.length - 1]![0]).toBe(after);
  });

  it('normalizes Creator 2 Promise rejection and ignores its non-error notifications', () => {
    const f = fixture(); f.create().start({ errors: true });
    f.fire('', 'unhandledRejectedPromise', 'Error: rejected\nstacktrace:\nframe');
    for (const message of ['handlerAddedAfterPromiseRejected', 'rejectAfterPromiseResolved', 'resolveAfterPromiseResolved']) f.fire('', message, 'bookkeeping');
    vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(1);
    expect(f.errors()[0]!.payload).toMatchObject({ message: 'rejected', type: 'unhandled_promise_rejection', stack: 'Error: rejected\nstacktrace:\nframe' });
    expect(f.original).toHaveBeenCalledTimes(4);
  });

  it('handles shared instances, repeat starts and disabled errors without replacing the registrar twice', () => {
    const f = fixture(); const wrapped = f.target.jsb!.onError;
    installJsbErrorSource(f.target); expect(f.target.jsb!.onError).toBe(wrapped);
    const a = f.create(), b = f.create();
    a.start({ errors: true }); a.start({ errors: true }); b.start({ errors: true });
    f.fire('', 'both', 'stack'); vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(1);
    a.stop(); f.fire('', 'only b', 'stack'); vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(2);
    b.start({ errors: false }); f.fire('', 'disabled', 'stack'); vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(2);
    a.start({ errors: true }); f.fire('', 'restarted', 'stack'); vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(3);
    expect(f.original).toHaveBeenCalledTimes(4);
  });

  it('reports even when a business handler throws and isolates collector failures and reentry', () => {
    const f = fixture(); const tracking = f.create(); tracking.start({ errors: true });
    f.target.jsb!.onError!(() => { throw new Error('business handler'); });
    expect(() => f.fire('', 'original error', 'stack')).toThrow('business handler');
    vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(1);
    f.target.jsb!.onError!((_location, message) => { if (message === 'outer') f.fire('', 'recursive', 'stack'); });
    f.fire('', 'outer', 'stack'); vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(3);
    const stop = f.target.__FT_COCOS_JSB_ERRORS__!.subscribe(() => { throw new Error('monitoring failure'); });
    expect(() => f.fire('', 'collector failure', 'stack')).not.toThrow(); stop();
    vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(4);
  });

  it('refuses unsafe late installation and leaves an existing handler untouched', () => {
    const register = vi.fn();
    const tracking = new FTDefaultAutoTracking({} as never, {} as never, {} as never, {} as never, { jsb: { onError: register } });
    expect(() => tracking.start({ errors: true })).toThrow('Rerun the SDK installer');
    expect(register).not.toHaveBeenCalled();
  });

  it('rejects an older bootstrap without replacing its handler', () => {
    const register = vi.fn();
    const tracking = new FTDefaultAutoTracking({} as never, {} as never, {} as never, {} as never, {
      jsb: { onError: register }, __FT_COCOS_JSB_ERRORS__: { subscribe: vi.fn() } as never,
    });
    expect(() => tracking.start({ errors: true })).toThrow('Rerun the SDK installer');
    expect(register).not.toHaveBeenCalled();
  });

  it('keeps native API validation and a failed registration from changing the business callback', () => {
    const f = fixture();
    expect(() => f.target.jsb!.onError!(null as never)).toThrow(TypeError);
    f.fire('', 'original still active', 'stack'); expect(f.original).toHaveBeenCalledOnce();
  });

  it('keeps native Hybrid errors page-scoped across leave, reentry and detach', () => {
    const f = fixture(), sdk = f.createSDK();
    sdk.attach({ autoTrack: { errors: true } });
    f.fire('', 'outside before', 'stack'); vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(0);
    sdk.enterCocos({ viewName: 'Game' });
    f.fire('', 'entered', 'stack'); vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(1);
    sdk.leaveCocos();
    f.fire('', 'outside after', 'stack'); vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(1);
    sdk.enterCocos({ viewName: 'GameAgain' });
    f.fire('', 'reentered', 'stack'); vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(2);
    sdk.detach();
    f.fire('', 'detached', 'stack'); vi.runOnlyPendingTimers(); expect(f.errors()).toHaveLength(2);
    expect(f.original).toHaveBeenCalledTimes(5);
  });
});
