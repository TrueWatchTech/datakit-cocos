import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTDefaultAutoTracking, type FTEngineTrackingHooks } from '../src/core/auto-tracking';
import { FTLogger, FTRUM, FTTrace } from '../src/core/modules';
import type { FTNativeTransport } from '../src/core/transport';

const NativeHeaders = globalThis.Headers;
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function headerEntries(source: HeadersInit): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  new NativeHeaders(source).forEach((value, name) => entries.push([name, value]));
  return entries;
}

function setup(propertyEvents = false) {
  const failures = new Set<string>();
  const sdkError = new Error('SDK observation failed');
  const traceHeaders: Record<string, string> = { traceparent: 'sdk-trace', 'x-sdk-trace': 'sdk-id' };
  const calls: Array<{ method: string; payload?: unknown }> = [];
  const transport: FTNativeTransport = {
    platform: 'android',
    invoke<T>(method: string, payload?: unknown): T | undefined {
      calls.push({ method, payload });
      if (failures.has(method)) throw sdkError;
      return method === 'trace.getHeaders' ? traceHeaders as T : undefined;
    },
  };
  const control: { listenerFailure?: 'before' | 'after'; sendError?: unknown; responseHeadersError?: unknown } = {};
  const nativeOpen = vi.fn();
  const nativeSend = vi.fn();
  const nativeHeader = vi.fn();
  class Xhr extends EventTarget {
    status = 200;
    timeout = 0;
    withCredentials = false;
    responseType = '';
    headers: Array<[string, string]> = [];
    onloadend: ((this: Xhr, ...events: Event[]) => unknown) | null = null;
    open(...args: unknown[]): void { nativeOpen.apply(this, args); this.headers = []; }
    setRequestHeader(...args: [string, string]): void {
      nativeHeader.apply(this, args);
      if (args[0] === 'x-sdk-rejected') throw sdkError;
      this.headers.push(args);
    }
    send(...args: unknown[]): void {
      nativeSend.apply(this, args);
      if (control.sendError) throw control.sendError;
    }
    override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
      if (control.listenerFailure === 'before') throw sdkError;
      if (propertyEvents && type === 'loadend') this.onloadend = listener as EventListener;
      else super.addEventListener(type, listener, options);
      if (control.listenerFailure === 'after') throw sdkError;
    }
    override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
      if (propertyEvents && type === 'loadend') this.onloadend = null;
      else super.removeEventListener(type, listener, options);
    }
    getAllResponseHeaders(): string {
      if (control.responseHeadersError) throw control.responseHeadersError;
      return 'content-type: application/json\r\n';
    }
    finish(...events: Event[]): unknown {
      if (propertyEvents) return this.onloadend?.apply(this, events);
      this.onloadend?.apply(this, events);
      this.dispatchEvent(new Event('loadend'));
    }
  }
  const response = new Response('response body');
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
  const target = { fetch, XMLHttpRequest: Xhr as unknown as typeof XMLHttpRequest };
  const tracking = new FTDefaultAutoTracking(new FTRUM(transport), new FTLogger(transport), new FTTrace(transport),
    {} as FTEngineTrackingHooks, target);
  tracking.start({ network: true }, undefined, 'network');
  cleanups.push(() => tracking.stop());
  return { target, tracking, fetch, response, Xhr, nativeOpen, nativeSend, nativeHeader, failures, traceHeaders, calls, control };
}

describe('fetch application behavior', () => {
  it.each(['trace.getHeaders', 'rum.startResource', 'rum.stopResource', 'rum.addResource'])('preserves successful fetch when %s throws', async method => {
    const f = setup();
    f.failures.add(method);
    const body = new Uint8Array([1, 2, 3]);
    await expect(f.target.fetch('https://example.test/data', { method: 'POST', body })).resolves.toBe(f.response);
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(f.fetch.mock.calls[0]?.[1]?.body).toBe(body);
    expect(f.response.bodyUsed).toBe(false);
  });

  it.each(['trace.getHeaders', 'rum.startResource', 'rum.stopResource', 'rum.addError'])('preserves the original fetch rejection when %s throws', async method => {
    const f = setup();
    f.failures.add(method);
    const error = new Error('original network failure');
    f.fetch.mockRejectedValueOnce(error);
    await expect(f.target.fetch('https://example.test/data')).rejects.toBe(error);
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it('preserves a synchronous fetch exception without retrying', () => {
    const f = setup();
    f.failures.add('rum.stopResource');
    const error = new Error('original synchronous failure');
    f.fetch.mockImplementationOnce(() => { throw error; });
    let thrown: unknown;
    try { f.target.fetch('https://example.test/data'); } catch (failure) { thrown = failure; }
    expect(thrown).toBe(error);
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  describe.each([true, false])('global Headers available: %s', available => {
    it.each(['record', 'tuples', 'Headers'])('preserves existing %s headers and same-name trace values', async kind => {
      const f = setup();
      const tuples: Array<[string, string]> = [
        ['Authorization', 'Bearer business'], ['X-Tag', 'one'], ['x-tag', 'two'], ['TraceParent', 'business-trace'],
      ];
      const headers: HeadersInit = kind === 'record'
        ? { Authorization: 'Bearer business', 'X-Tag': 'one, two', TraceParent: 'business-trace' }
        : kind === 'Headers' ? new NativeHeaders(tuples) : tuples;
      const before = headerEntries(headers);
      if (!available) vi.stubGlobal('Headers', undefined);
      await f.target.fetch('https://example.test/data', { headers });
      const actual = new NativeHeaders(f.fetch.mock.calls[0]?.[1]?.headers);
      for (const [name, value] of before) expect(actual.get(name)).toBe(value);
      expect(actual.get('x-sdk-trace')).toBe('sdk-id');
      expect(headerEntries(headers)).toEqual(before);
      expect(f.fetch).toHaveBeenCalledOnce();
    });

    it('falls back to the original request for an invalid SDK header', async () => {
      const f = setup();
      f.traceHeaders['invalid header name'] = 'invalid\r\nvalue';
      if (!available) vi.stubGlobal('Headers', undefined);
      const init = { headers: { Authorization: 'Bearer business' } };
      await expect(f.target.fetch('https://example.test/data', init)).resolves.toBe(f.response);
      expect(f.fetch).toHaveBeenCalledExactlyOnceWith('https://example.test/data', init);
      expect(f.fetch.mock.calls[0]?.[1]).toBe(init);
    });
  });

  it('preserves inherited and non-enumerable options and getter receivers', async () => {
    const f = setup();
    const controller = new AbortController();
    class Options {
      #body = 'original body';
      get body(): string { return this.#body; }
      get signal(): AbortSignal { return controller.signal; }
    }
    Object.defineProperty(Options.prototype, 'method', { value: 'POST', enumerable: false });
    const init: RequestInit = new Options();
    Object.defineProperty(init, 'credentials', { value: 'include', enumerable: false });
    await f.target.fetch('https://example.test/data', init);
    const forwarded = f.fetch.mock.calls[0]?.[1];
    const request = new Request('https://example.test/data', forwarded);
    expect(request.method).toBe('POST');
    expect(await request.text()).toBe('original body');
    expect(request.credentials).toBe('include');
    expect(request.headers.get('x-sdk-trace')).toBe('sdk-id');
    expect(forwarded?.signal).toBe(controller.signal);
    controller.abort();
    expect(request.signal.aborted).toBe(true);
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it('leaves header and method accessors to the original fetch without reading them early', async () => {
    const f = setup();
    const headers = vi.fn(() => ({ Authorization: 'Bearer business' }));
    const method = vi.fn(() => 'POST');
    const init = { get headers() { return headers(); }, get method() { return method(); }, body: 'body' };
    f.fetch.mockImplementationOnce(async (input, options) => {
      expect(headers).not.toHaveBeenCalled();
      expect(method).not.toHaveBeenCalled();
      const request = new Request(input, options);
      expect(request.headers.get('authorization')).toBe('Bearer business');
      expect(request.method).toBe('POST');
      expect(await request.text()).toBe('body');
      return f.response;
    });
    await expect(f.target.fetch('https://example.test/data', init)).resolves.toBe(f.response);
    expect(f.fetch.mock.calls[0]?.[1]).toBe(init);
    expect(headers).toHaveBeenCalledOnce();
    expect(method).toHaveBeenCalledOnce();
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it('sends the original request once if SDK metadata creation fails', async () => {
    const f = setup();
    vi.spyOn(Date, 'now').mockImplementationOnce(() => { throw new Error('clock unavailable'); });
    const init = { method: 'POST', body: 'body', headers: { Authorization: 'Bearer business' } };
    await expect(f.target.fetch('https://example.test/data', init)).resolves.toBe(f.response);
    expect(f.fetch.mock.calls[0]?.[1]).toBe(init);
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it('leaves custom URL conversion to the original fetch', async () => {
    const f = setup();
    const toString = vi.fn(() => 'https://example.test/data');
    const input = { toString } as unknown as URL;
    f.fetch.mockImplementationOnce(async value => {
      expect(toString).not.toHaveBeenCalled();
      expect(new Request(value).url).toBe('https://example.test/data');
      return f.response;
    });
    await expect(f.target.fetch(input)).resolves.toBe(f.response);
    expect(toString).toHaveBeenCalledOnce();
    expect(f.fetch).toHaveBeenCalledExactlyOnceWith(input);
  });

  it('preserves the receiver and ordinary options, including streaming bodies', async () => {
    const f = setup();
    const receiver = {};
    const signal = new AbortController().signal;
    const body = new ReadableStream();
    const init = { method: 'POST', body, signal, credentials: 'include' as const, cache: 'no-store' as const,
      redirect: 'manual' as const, referrerPolicy: 'no-referrer' as const, keepalive: false, duplex: 'half' };
    await f.target.fetch.call(receiver, 'https://example.test/data', init);
    const forwarded = f.fetch.mock.calls[0]?.[1];
    for (const key of Object.keys(init) as Array<keyof typeof init>) expect((forwarded as typeof init)[key]).toBe(init[key]);
    expect(body.locked).toBe(false);
    expect(f.fetch.mock.contexts).toEqual([receiver]);
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it('does not consume or mutate a Request input', async () => {
    const f = setup();
    const input = new Request('https://example.test/data', { method: 'POST', body: 'original body', headers: { Authorization: 'Bearer business' } });
    await f.target.fetch(input);
    expect(f.fetch.mock.calls[0]?.[0]).toBe(input);
    expect(input.bodyUsed).toBe(false);
    expect(input.headers.has('x-sdk-trace')).toBe(false);
    const forwarded = new Request(input, f.fetch.mock.calls[0]?.[1]);
    expect(await forwarded.text()).toBe('original body');
    expect(forwarded.headers.get('authorization')).toBe('Bearer business');
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it('keeps the original arguments when tracing has no additional headers', async () => {
    const f = setup();
    for (const name of Object.keys(f.traceHeaders)) delete f.traceHeaders[name];
    await f.target.fetch('https://example.test/data');
    expect(f.fetch.mock.calls).toEqual([['https://example.test/data']]);
  });

  it('keeps the original arguments when header preparation fails', async () => {
    const f = setup();
    const init = new Proxy({ method: 'POST', body: 'body' }, { ownKeys() { throw new Error('descriptor unavailable'); } });
    await expect(f.target.fetch('https://example.test/data', init)).resolves.toBe(f.response);
    expect(f.fetch.mock.calls[0]?.[1]).toBe(init);
    expect(f.fetch).toHaveBeenCalledOnce();
  });
});

describe.each([false, true])('XHR application behavior, property events: %s', propertyEvents => {
  it.each(['trace.getHeaders', 'rum.startResource', 'rum.stopResource', 'rum.addResource'])('preserves one send and the business callback when %s throws', method => {
    const f = setup(propertyEvents);
    f.failures.add(method);
    const xhr = new f.Xhr();
    const business = vi.fn();
    xhr.onloadend = business;
    xhr.open('POST', 'https://example.test/data?q=1', false, 'user', 'password');
    xhr.timeout = 333;
    xhr.withCredentials = true;
    xhr.responseType = 'arraybuffer';
    xhr.setRequestHeader('Authorization', 'Bearer business');
    const body = new Uint8Array([1, 2, 3]);
    expect(() => { xhr.send(body); xhr.finish(); }).not.toThrow();
    expect(f.nativeOpen).toHaveBeenCalledExactlyOnceWith('POST', 'https://example.test/data?q=1', false, 'user', 'password');
    expect(f.nativeSend).toHaveBeenCalledExactlyOnceWith(body);
    expect(new NativeHeaders(xhr.headers).get('authorization')).toBe('Bearer business');
    expect([xhr.timeout, xhr.withCredentials, xhr.responseType]).toEqual([333, true, 'arraybuffer']);
    expect(business).toHaveBeenCalledOnce();
    expect(business.mock.contexts).toEqual([xhr]);
    expect(business.mock.calls).toEqual([[]]);
  });

  it('preserves repeated business headers and skips existing trace headers case-insensitively', () => {
    const f = setup(propertyEvents);
    const xhr = new f.Xhr();
    xhr.open('GET', 'https://example.test/data');
    xhr.setRequestHeader('TraceParent', 'business-trace');
    xhr.setRequestHeader('X-Tag', 'one');
    xhr.setRequestHeader('x-tag', 'two');
    xhr.send();
    expect(xhr.headers).toEqual([
      ['TraceParent', 'business-trace'], ['X-Tag', 'one'], ['x-tag', 'two'], ['x-sdk-trace', 'sdk-id'],
    ]);
    expect(f.nativeSend.mock.calls).toEqual([[]]);
  });

  it('sends once when an injected header is rejected', () => {
    const f = setup(propertyEvents);
    f.traceHeaders['x-sdk-rejected'] = 'rejected';
    const xhr = new f.Xhr();
    xhr.open('GET', 'https://example.test/data');
    xhr.setRequestHeader('Authorization', 'Bearer business');
    expect(() => xhr.send()).not.toThrow();
    expect(f.nativeSend).toHaveBeenCalledOnce();
    expect(new NativeHeaders(xhr.headers).get('authorization')).toBe('Bearer business');
  });

  it('does not convert a custom XHR URL before the native open call', () => {
    const f = setup(propertyEvents);
    const toString = vi.fn(() => 'https://example.test/data');
    const input = { toString };
    f.nativeOpen.mockImplementation((_method, url) => { String(url); });
    const xhr = new f.Xhr();
    xhr.open('GET', input);
    xhr.send();
    expect(toString).toHaveBeenCalledOnce();
    expect(f.nativeOpen).toHaveBeenCalledExactlyOnceWith('GET', input);
    expect(f.nativeSend).toHaveBeenCalledOnce();
  });

  it.each(['before', 'after'] as const)('sends once and preserves the callback when listener installation fails %s assignment', when => {
    const f = setup(propertyEvents);
    f.control.listenerFailure = when;
    const xhr = new f.Xhr();
    const business = vi.fn();
    xhr.onloadend = business;
    xhr.open('GET', 'https://example.test/data');
    expect(() => { xhr.send(); xhr.finish(); }).not.toThrow();
    expect(f.nativeSend).toHaveBeenCalledOnce();
    expect(business).toHaveBeenCalledOnce();
  });

  it('does not expose response-header collection failures to the application', () => {
    const f = setup(propertyEvents);
    f.control.responseHeadersError = new Error('unavailable response headers');
    const xhr = new f.Xhr();
    const business = vi.fn();
    xhr.onloadend = business;
    xhr.open('GET', 'https://example.test/data');
    xhr.send();
    expect(() => xhr.finish()).not.toThrow();
    expect(business).toHaveBeenCalledOnce();
    expect(f.nativeSend).toHaveBeenCalledOnce();
  });

  it('preserves a native send exception and removes the failed observation before reuse', () => {
    const f = setup(propertyEvents);
    const error = new Error('original send failure');
    f.control.sendError = error;
    f.failures.add('rum.stopResource');
    const xhr = new f.Xhr();
    const business = vi.fn();
    xhr.onloadend = business;
    xhr.open('GET', 'https://example.test/data');
    let thrown: unknown;
    try { xhr.send(); } catch (failure) { thrown = failure; }
    expect(thrown).toBe(error);
    expect(f.nativeSend).toHaveBeenCalledOnce();
    expect(xhr.onloadend).toBe(business);
    f.control.sendError = undefined;
    xhr.open('GET', 'https://example.test/retry');
    xhr.send();
    xhr.finish();
    expect(f.nativeSend).toHaveBeenCalledTimes(2);
    expect(business).toHaveBeenCalledOnce();
    expect(f.calls.filter(call => call.method === 'rum.addResource')).toHaveLength(1);
  });
});

it('preserves a Creator 2 business callback exception when SDK reporting also fails', () => {
  const f = setup(true);
  f.failures.add('rum.addResource');
  const error = new Error('original business callback failure');
  const xhr = new f.Xhr();
  xhr.open('GET', 'https://example.test/data');
  xhr.onloadend = () => { throw error; };
  xhr.send();
  let thrown: unknown;
  try { xhr.finish(); } catch (failure) { thrown = failure; }
  expect(thrown).toBe(error);
  expect(f.nativeSend).toHaveBeenCalledOnce();
});

it('keeps a fetch-to-XHR polyfill to one native request', async () => {
  const f = setup(true);
  f.fetch.mockImplementationOnce((input, init) => new Promise(resolve => {
    const xhr = new f.Xhr();
    xhr.open(init?.method || 'GET', String(input));
    new NativeHeaders(init?.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
    xhr.onloadend = () => resolve(f.response);
    xhr.send(init?.body);
    xhr.finish();
    expect(new NativeHeaders(xhr.headers).get('traceparent')).toBe('sdk-trace');
    expect(new NativeHeaders(xhr.headers).get('authorization')).toBe('Bearer business');
  }));
  const body = new Uint8Array([1, 2, 3]);
  await expect(f.target.fetch('https://example.test/data', { method: 'POST', body,
    headers: { Authorization: 'Bearer business' } })).resolves.toBe(f.response);
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.nativeOpen).toHaveBeenCalledOnce();
  expect(f.nativeSend).toHaveBeenCalledExactlyOnceWith(body);
});

it('does not overwrite later application hooks on stop', async () => {
  const f = setup();
  const fetch = f.target.fetch;
  const send = f.Xhr.prototype.send;
  const laterFetch = vi.fn<typeof globalThis.fetch>((...args) => fetch(...args));
  const laterSend = vi.fn(function (this: InstanceType<typeof f.Xhr>, ...args: unknown[]) { return send.apply(this, args); });
  f.target.fetch = laterFetch;
  f.Xhr.prototype.send = laterSend;
  f.tracking.stop();
  expect(f.target.fetch).toBe(laterFetch);
  expect(f.Xhr.prototype.send).toBe(laterSend);
  await f.target.fetch('https://example.test/data');
  const xhr = new f.Xhr();
  xhr.open('GET', 'https://example.test/data');
  xhr.send();
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.nativeSend).toHaveBeenCalledOnce();
  expect(f.calls).toHaveLength(0);
});
