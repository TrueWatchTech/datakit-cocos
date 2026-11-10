import { describe, expect, it, vi } from 'vitest';
import { FT_INTERNAL_ERROR_MARKER, isInternalErrorText } from '../src/core/internal-errors';
import { replayError } from '../src/session-replay/core/internal-errors';
import { parseTransportResponse } from '../src/core/transport';
import { FTDefaultAutoTracking } from '../src/core/auto-tracking';
import { FTLogger, FTRUM, FTTrace } from '../src/core/modules';

describe('internal runtime error marker', () => {
  it.each([Error, TypeError, RangeError])('preserves %s type and a marked stack across package boundaries', ErrorType => {
    const error = replayError('runtime failed', ErrorType);
    expect(error).toBeInstanceOf(ErrorType);
    expect(error.message).toBe(`${FT_INTERNAL_ERROR_MARKER} runtime failed`);
    expect(isInternalErrorText(error.stack)).toBe(true);
    expect(isInternalErrorText(`Uncaught (in promise) ${error}`)).toBe(true);
    expect(isInternalErrorText(`Error: business failure\n at ${FT_INTERNAL_ERROR_MARKER}/game.js:1`)).toBe(false);
  });

  it('tags native bridge failures without changing successful responses', () => {
    expect(() => parseTransportResponse({ ok: false, error: 'bridge worker failed' }))
      .toThrow(`${FT_INTERNAL_ERROR_MARKER} bridge worker failed`);
    expect(parseTransportResponse({ ok: true, value: 'result' })).toBe('result');
  });

  it('filters tagged error and rejection events in the non-JSB fallback without suppressing business errors', () => {
    const events = new EventTarget();
    const target = {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    };
    const invoke = vi.fn();
    const transport = { platform: 'android' as const, invoke };
    const tracking = new FTDefaultAutoTracking(new FTRUM(transport), new FTLogger(transport), new FTTrace(transport), {} as never, target);
    tracking.start({ errors: true });
    try {
      const error = replayError('Missing Replay privacy skinned bounds');
      events.dispatchEvent(Object.assign(new Event('error'), { message: error.message, error }));
      events.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: error }));
      events.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: error.message }));
      expect(invoke).not.toHaveBeenCalled();
      events.dispatchEvent(Object.assign(new Event('error'), { message: 'Missing Replay privacy skinned bounds' }));
      events.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('business failure') }));
      expect(invoke.mock.calls.filter(([method]) => method === 'rum.addError')).toHaveLength(2);
    } finally { tracking.stop(); }
  });
});
