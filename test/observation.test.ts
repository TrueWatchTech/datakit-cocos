import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTObservationQueue, observationState } from '../src/core/observation';
import { installJsbErrorSource, type FTJsbErrorGlobal } from '../src/native/jsb-errors';
import { FTDefaultAutoTracking } from '../src/core/auto-tracking';
import { FTLogger, FTRUM, FTTrace } from '../src/core/modules';
import { replayError } from '../src/session-replay/core/internal-errors';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function source() {
  let callback: (...args: any[]) => unknown;
  const returns = {};
  const register = vi.fn(function (...args: any[]) {
    if (args.length !== 1 || typeof args[0] !== 'function') throw new TypeError('one callback required');
    callback = args[0];
    return returns;
  });
  const target: FTJsbErrorGlobal = { jsb: { onError: register } };
  installJsbErrorSource(target);
  const receiver = {};
  return { target, register, returns, receiver, fire: (...args: any[]) => callback.apply(receiver, args) };
}

describe('non-interfering JSB delivery', () => {
  it('preserves finite nested delivery, the receiver and the handler result', () => {
    const f = source(), original: string[] = [], observed: string[] = [];
    const result = {};
    const handler = vi.fn(function (this: unknown, location: string, message: string, stack: string) {
      expect(this).toBe(f.receiver);
      expect(location).toBe('game.js:9');
      expect(stack).toBe('raw stack');
      original.push(message);
      if (message === 'outer') f.fire(location, 'nested', stack);
      return result;
    });
    expect(f.target.jsb!.onError!(handler)).toBe(f.returns);
    const stop = f.target.__FT_COCOS_JSB_ERRORS__!.subscribe((_l, m) => observed.push(m));
    expect(f.fire('game.js:9', 'outer', 'raw stack')).toBe(result);
    expect(original).toEqual(['outer', 'nested']);
    expect(observed).toEqual(['nested', 'outer']);
    stop();
  });

  it('does not replace the exact object thrown by the original handler', () => {
    const f = source(), failure = {}, observed = vi.fn(() => { throw new Error('observer failed'); });
    f.target.jsb!.onError!(() => { throw failure; });
    f.target.__FT_COCOS_JSB_ERRORS__!.subscribe(observed);
    let caught;
    try { f.fire('', 'error', 'stack'); } catch (error) { caught = error; }
    expect(caught).toBe(failure);
    expect(observed).toHaveBeenCalledOnce();
  });

  it('leaves original delivery intact when local context capture fails', () => {
    const f = source(), original = vi.fn(), observed = vi.fn();
    f.target.jsb!.onError!(original);
    f.target.__FT_COCOS_JSB_ERRORS__!.subscribe(observed, () => { throw new Error('snapshot failed'); });
    expect(() => f.fire('', 'error', '')).not.toThrow();
    expect(original).toHaveBeenCalledExactlyOnceWith('', 'error', '');
    expect(observed).not.toHaveBeenCalled();
  });

  it('forwards all invalid registration arguments to the native validator unchanged', () => {
    const f = source(), original = vi.fn();
    f.target.jsb!.onError!(original);
    f.target.__FT_COCOS_JSB_ERRORS__!.subscribe(() => {});
    const registrar = f.target.jsb!.onError! as (...args: any[]) => unknown;
    for (const args of [[], [null], [original, 'extra']]) {
      expect(() => registrar(...args)).toThrow(TypeError);
      expect(f.register.mock.calls[f.register.mock.calls.length - 1]).toEqual(args);
    }
    f.fire('', 'still original', '');
    expect(original).toHaveBeenCalledExactlyOnceWith('', 'still original', '');
  });

  it('captures local context before the original handler changes it', () => {
    const f = source(), observed = vi.fn();
    let context = 'Scene A';
    f.target.jsb!.onError!(() => { context = 'Scene B'; });
    f.target.__FT_COCOS_JSB_ERRORS__!.subscribe(observed, () => context);
    f.fire('', 'error', 'stack');
    expect(observed).toHaveBeenCalledWith('', 'error', 'stack', expect.objectContaining({ context: 'Scene A' }));
  });

  it('always forwards observer-induced callbacks while suppressing recursive observations', () => {
    const f = source(), original = vi.fn(), observed = vi.fn(() => { f.fire('', 'observer nested', ''); });
    f.target.jsb!.onError!(original);
    f.target.__FT_COCOS_JSB_ERRORS__!.subscribe(observed);
    f.fire('', 'outer', '');
    expect(original.mock.calls.map(c => c[1])).toEqual(['outer', 'observer nested']);
    expect(observed).toHaveBeenCalledOnce();
  });
});

describe('bounded asynchronous observation queue', () => {
  it('imports without timers and starts scheduling once the runtime installs them', () => {
    vi.useFakeTimers();
    vi.stubGlobal('setTimeout', undefined);
    vi.stubGlobal('clearTimeout', undefined);
    const queue = new FTObservationQueue({}), task = vi.fn();
    expect(() => queue.enqueue(task)).not.toThrow();
    expect(task).not.toHaveBeenCalled();
    expect(queue.dropped).toBe(1);
    vi.unstubAllGlobals();
    queue.enqueue(task);
    vi.runAllTimers();
    expect(task).toHaveBeenCalledOnce();
  });

  it('runs outside the caller stack, isolates task failures and suppresses only SDK observations', () => {
    vi.useFakeTimers();
    const f = source(), original = vi.fn(), observed = vi.fn();
    f.target.jsb!.onError!(original);
    f.target.__FT_COCOS_JSB_ERRORS__!.subscribe(observed);
    const queue = new FTObservationQueue(f.target), completed = vi.fn();
    queue.enqueue(() => { f.fire('', 'SDK bridge failure', ''); queue.enqueue(completed); throw new Error('failure'); });
    queue.enqueue(completed);
    expect(original).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(original).toHaveBeenCalledOnce();
    expect(observed).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledOnce();
    expect(observationState(f.target).reporting).toBe(0);
  });

  it('cancels pending and in-flight generations without affecting a later restart', () => {
    vi.useFakeTimers();
    const queue = new FTObservationQueue({}), stale = vi.fn(), fresh = vi.fn();
    queue.enqueue(stale); queue.stop(); vi.runAllTimers();
    queue.enqueue(() => queue.stop()); queue.enqueue(stale); vi.runAllTimers();
    queue.enqueue(fresh); vi.runAllTimers();
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledOnce();
  });

  it('bounds count and retained string size and never falls back to synchronous work', () => {
    vi.useFakeTimers();
    const task = vi.fn(), queue = new FTObservationQueue({});
    for (let i = 0; i < 140; i++) queue.enqueue(task);
    expect(task).not.toHaveBeenCalled();
    expect(queue.dropped).toBe(12);
    vi.runAllTimers();
    expect(task).toHaveBeenCalledTimes(128);
    queue.enqueue(task, 1024 * 1024 + 1);
    expect(queue.dropped).toBe(13);
    queue.stop();
    const broken = new FTObservationQueue({ setTimeout: (() => { throw new Error('scheduler failed'); }) as never });
    expect(() => broken.enqueue(task)).not.toThrow();
    expect(broken.dropped).toBe(1);
    expect(task).toHaveBeenCalledTimes(128);
  });
});

describe('console observation preserves the application call', () => {
  function consoleFixture(invoke = vi.fn()) {
    const f = source();
    const original = vi.fn();
    const target = Object.assign(f.target, { console: {
      log: original, info: original, warn: original, error: original,
    } as unknown as Console });
    const transport = { platform: 'android' as const, invoke<T>(method: string, payload?: unknown): T | undefined {
      return invoke(method, payload) as T;
    } };
    const tracking = new FTDefaultAutoTracking(new FTRUM(transport), new FTLogger(transport), new FTTrace(transport), {} as never, target);
    return { ...f, target, original, tracking, invoke };
  }

  it('keeps this, arguments, result and original function identity after stop', () => {
    vi.useFakeTimers();
    const f = consoleFixture(), receiver = {}, argument = {}, result = {};
    f.original.mockReturnValue(result);
    f.tracking.start({ console: true });
    expect(f.target.console.error.call(receiver, argument)).toBe(result);
    expect(f.original).toHaveBeenCalledExactlyOnceWith(argument);
    expect(f.original.mock.contexts[0]).toBe(receiver);
    expect(f.invoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(f.invoke).toHaveBeenCalledOnce();
    f.tracking.stop();
    expect(f.target.console.error).toBe(f.original);
  });

  it('preserves the original thrown object and isolates delayed serialization and bridge failures', () => {
    vi.useFakeTimers();
    const f = consoleFixture(vi.fn(() => { throw new Error('bridge failed'); })), failure = {};
    f.original.mockImplementation(() => { throw failure; });
    f.tracking.start({ console: true });
    let caught;
    try { f.target.console.error('app error'); } catch (error) { caught = error; }
    expect(caught).toBe(failure);
    expect(() => vi.runAllTimers()).not.toThrow();
    f.original.mockImplementation(() => {});
    const hostile = { toJSON() { throw new Error('serialize'); }, toString() { throw new Error('stringify'); } };
    expect(() => f.target.console.error(hostile)).not.toThrow();
    expect(() => vi.runAllTimers()).not.toThrow();
    f.tracking.stop();
  });

  it.each(['log', 'info', 'warn', 'error'] as const)('keeps SDK %s diagnostics in the console without enqueueing logs', method => {
    vi.useFakeTimers();
    const f = consoleFixture();
    f.tracking.start({ console: true });
    const errors = [
      new Error('Missing Replay privacy skinned bounds'),
      new Error('Missing Replay privacy perspective projection'),
    ];
    for (const error of errors) {
      f.target.console[method]('[cocos-sdk] Session Replay frame dropped:', error);
      expect(f.original).toHaveBeenLastCalledWith('[cocos-sdk] Session Replay frame dropped:', error);
    }
    f.target.console[method]('[cocos-sdk] Session Replay pointer dropped:', errors[0]);
    f.target.console[method]('[cocos-sdk] Session Replay pointer segment dropped:', errors[1]);
    expect(f.original).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
    expect(f.invoke).not.toHaveBeenCalled();

    // Error text alone and mentions of the SDK in business content are not internal diagnostics.
    f.target.console[method]('business failure', errors[0]);
    f.target.console[method]('business mentions [cocos-sdk]');
    f.target.console[method]('[HybridTelemetrySample] Unable to enter Hybrid mode', errors[1]);
    vi.runAllTimers();
    expect(f.invoke).toHaveBeenCalledTimes(3);
    expect(f.invoke).toHaveBeenCalledWith('logger.log', expect.objectContaining({
      content: expect.stringContaining('business failure Missing Replay privacy skinned bounds'),
      level: method === 'warn' ? 'warning' : method === 'error' ? 'error' : 'info',
    }));
    f.tracking.stop();
  });

  it('does not filter explicit logger calls with the internal console prefix', () => {
    const invoke = vi.fn();
    const logger = new FTLogger({ platform: 'android', invoke });
    logger.log('[cocos-sdk] explicitly requested log', 'error');
    expect(invoke).toHaveBeenCalledWith('logger.log', expect.objectContaining({
      content: '[cocos-sdk] explicitly requested log', level: 'error',
    }));
  });

  it('filters both RUM and the engine console echo of a tagged JSB error before the outer catch runs', () => {
    vi.useFakeTimers();
    const f = consoleFixture();
    f.target.jsb!.onError!((_location, message, stack) => f.target.console.error('[ERROR]', message, stack));
    f.tracking.start({ errors: true, console: true });
    const error = replayError('Missing Replay privacy perspective projection');
    f.fire('', 'unhandledRejectedPromise', `${error}\nstacktrace:\nframe`);
    f.target.console.error(error);
    f.target.console.error('[cocos-sdk] Session Replay frame dropped:', error);
    vi.runAllTimers();
    expect(f.original).toHaveBeenCalledTimes(3);
    expect(f.invoke.mock.calls.filter(([method]) => method === 'rum.addError' || method === 'logger.log')).toEqual([]);
    f.target.console.error(new Error('business failure'));
    f.fire('', 'business failure', 'frame');
    vi.runAllTimers();
    expect(f.invoke.mock.calls.filter(([method]) => method === 'rum.addError')).toHaveLength(1);
    expect(f.invoke.mock.calls.filter(([method]) => method === 'logger.log')).toHaveLength(2);
    f.tracking.stop();
  });

  it('forwards JSB callbacks triggered by SDK reporting without feeding error or log collection back into itself', () => {
    vi.useFakeTimers();
    const f = consoleFixture();
    f.target.jsb!.onError!((_l, m, s) => f.target.console.error(m, s));
    f.tracking.start({ console: true, errors: true });
    f.invoke.mockImplementation((method: string) => {
      if (method === 'rum.getViewId') return 'native-view';
      f.fire('', 'SDK failure', ''); throw new Error('bridge failed');
    });
    expect(() => f.fire('', 'application failure', 'raw stack')).not.toThrow();
    expect(f.original).toHaveBeenCalledExactlyOnceWith('application failure', 'raw stack');
    expect(f.invoke).toHaveBeenCalledExactlyOnceWith('rum.getViewId', undefined);
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(f.invoke).toHaveBeenCalledTimes(3);
    expect(f.original.mock.calls).toEqual([
      ['application failure', 'raw stack'], ['SDK failure', ''], ['SDK failure', ''],
    ]);
    expect(vi.getTimerCount()).toBe(0);
    f.tracking.stop();
  });

  it('isolates context lookup failures and their console/JSB callbacks from automatic collection', () => {
    vi.useFakeTimers();
    const f = consoleFixture();
    f.target.jsb!.onError!((_l, m, s) => f.target.console.error(m, s));
    f.tracking.start({ console: true, errors: true });
    f.invoke.mockImplementation((method: string) => {
      if (method !== 'rum.getViewId') return;
      f.fire('', 'context lookup failed', '');
      throw new Error('context unavailable');
    });
    f.fire('', 'application failure', 'stack');
    vi.runAllTimers();
    expect(f.invoke.mock.calls.map(call => call[0])).toEqual(['rum.getViewId', 'logger.log', 'rum.addError']);
    expect(f.original.mock.calls).toEqual([['context lookup failed', ''], ['application failure', 'stack']]);
    expect(vi.getTimerCount()).toBe(0);
    f.tracking.stop();
  });

  it('cancels queued console observations on leave and keeps forwarding console calls', () => {
    vi.useFakeTimers();
    const f = consoleFixture();
    f.tracking.start({ console: true });
    f.target.console.error('pending');
    f.tracking.stop();
    f.target.console.error('outside');
    vi.runAllTimers();
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.original.mock.calls).toEqual([['pending'], ['outside']]);
  });

  it('does not overwrite a later business console wrapper or reactivate a retained SDK wrapper', () => {
    vi.useFakeTimers();
    const f = consoleFixture();
    f.tracking.start({ console: true });
    const installed = f.target.console.error;
    const business = vi.fn((message: unknown) => installed(message));
    f.target.console.error = business;
    f.tracking.stop();
    expect(f.target.console.error).toBe(business);
    f.target.console.error('after stop');
    vi.runAllTimers();
    expect(business).toHaveBeenCalledOnce();
    expect(f.original).toHaveBeenCalledExactlyOnceWith('after stop');
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it('does not enqueue after the original console function stops tracking', () => {
    vi.useFakeTimers();
    const f = consoleFixture();
    f.original.mockImplementation(() => f.tracking.stop());
    f.tracking.start({ console: true });
    f.target.console.error('stop from original');
    vi.runAllTimers();
    expect(f.invoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
