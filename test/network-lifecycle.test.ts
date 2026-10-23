import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTDefaultAutoTracking, type FTEngineTrackingHooks } from '../src/core/auto-tracking';
import { FTCocosSDK } from '../src/core/client';
import { FTLogger, FTRUM, FTTrace } from '../src/core/modules';
import type { FTNativeTransport } from '../src/core/transport';
import type { FTAutoTrackingConfig } from '../src/core/types';
import { FT_COCOS_SDK_VERSION } from '../src/core/version';

class Transport implements FTNativeTransport {
  readonly platform = 'android' as const;
  readonly calls: Array<{ method: string; payload: any }> = [];
  fail: string | undefined;
  invoke<T>(method: string, payload?: unknown): T | undefined {
    this.calls.push({ method, payload });
    if (method === this.fail) throw new Error(`failed: ${method}`);
    if (method === 'trace.getHeaders') return { 'x-test-trace': 'trace-id' } as T;
    return undefined;
  }
}

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); });

function setup(engine: 'creator2' | 'creator3' = 'creator2', propertyEvents = false) {
  // A fresh prototype per test prevents one SDK instance from wrapping another.
  class Xhr extends EventTarget {
    status = 0;
    headers: Record<string, string> = {};
    sends = 0;
    onloadend: ((event: Event) => void) | null = null;
    override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
      if (propertyEvents && type === 'loadend') this.onloadend = listener as EventListener | null;
      else super.addEventListener(type, listener, options);
    }
    open(_method: string, _url: string): void {}
    setRequestHeader(name: string, value: string): void { this.headers[name] = value; }
    send(): void { this.sends += 1; }
    getAllResponseHeaders(): string { return 'content-type: application/json\r\n'; }
    finish(status = 200): void {
      this.status = status;
      if (propertyEvents) this.onloadend?.call(this, new Event('loadend'));
      else this.dispatchEvent(new Event('loadend'));
    }
  }
  const original = { open: Xhr.prototype.open, send: Xhr.prototype.send, header: Xhr.prototype.setRequestHeader };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { status: 200 }));
  const events = new EventTarget();
  const target = {
    XMLHttpRequest: Xhr as unknown as typeof XMLHttpRequest,
    fetch,
    console: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Console,
    addEventListener: events.addEventListener.bind(events) as typeof globalThis.addEventListener,
    removeEventListener: events.removeEventListener.bind(events) as typeof globalThis.removeEventListener,
  };
  let sceneChanged: ((name: string) => void) | undefined;
  let action: ((name: string) => void) | undefined;
  const hooks: FTEngineTrackingHooks = {
    onSceneChanged(callback) { sceneChanged = callback; return () => { sceneChanged = undefined; }; },
    onAction(callback) { action = callback; return () => { action = undefined; }; },
  };
  const transport = new Transport();
  const tracking = new FTDefaultAutoTracking(new FTRUM(transport), new FTLogger(transport), new FTTrace(transport), hooks, target);
  const sdk = new FTCocosSDK(transport, tracking, engine);
  cleanups.push(() => tracking.stop());
  const calls = (method: string) => transport.calls.filter(call => call.method === method);
  const request = (url = 'https://example.test/data') => {
    const xhr = new Xhr();
    xhr.open('GET', url);
    xhr.send();
    return xhr;
  };
  return { sdk, transport, tracking, target, Xhr, original, fetch, events, calls, request,
    scene: (name: string) => sceneChanged?.(name), action: () => action?.('button') };
}

describe.each(['creator2', 'creator3'] as const)('%s Hybrid network lifecycle', engine => {
  it('collects XHR and fetch before entry and after leave without creating a Cocos view', async () => {
    const f = setup(engine);
    f.sdk.attach({ autoTrack: { network: true } });
    f.request().finish();
    await f.target.fetch('https://example.test/before');
    expect(f.calls('rum.addResource')).toHaveLength(2);
    expect(f.calls('rum.startView')).toHaveLength(0);

    f.sdk.enterCocos({ viewName: 'Game' });
    f.sdk.leaveCocos();
    f.request().finish(404);
    await f.target.fetch('https://example.test/after');
    expect(f.calls('rum.addResource')).toHaveLength(4);
    expect(f.calls('rum.startView')).toHaveLength(1);
    expect(f.calls('rum.stopView')).toHaveLength(1);
    expect(f.calls('rum.addResource')[2]?.payload.content.statusCode).toBe(404);
    const init = f.fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('x-test-trace')).toBe('trace-id');
    expect(f.calls('trace.getHeaders')).toHaveLength(4);
  });

  it('keeps hooks stable and reports once across duplicate calls and page transitions', () => {
    const f = setup(engine);
    f.sdk.attach({ autoTrack: { network: true } });
    const open = f.Xhr.prototype.open;
    const send = f.Xhr.prototype.send;
    const fetch = f.target.fetch;
    const xhr = new f.Xhr();
    xhr.open('POST', 'https://example.test/cross-page');
    for (let i = 0; i < 3; i += 1) {
      f.sdk.attach({ autoTrack: { network: false } });
      f.sdk.enterCocos({ viewName: 'Game' });
      f.sdk.enterCocos({ viewName: 'Duplicate' });
      f.sdk.leaveCocos();
      f.sdk.leaveCocos();
    }
    expect(f.Xhr.prototype.open).toBe(open);
    expect(f.Xhr.prototype.send).toBe(send);
    expect(f.target.fetch).toBe(fetch);
    xhr.send();
    expect(xhr.headers['x-test-trace']).toBe('trace-id');
    xhr.finish();
    xhr.finish();
    expect(xhr.sends).toBe(1);
    expect(f.calls('rum.startResource')).toHaveLength(1);
    expect(f.calls('rum.stopResource')).toHaveLength(1);
    expect(f.calls('rum.addResource')).toHaveLength(1);
  });

  it('restores hooks on detach and permits reattachment with new configuration', async () => {
    const f = setup(engine);
    f.sdk.detach();
    f.sdk.attach({ autoTrack: { network: true } });
    f.sdk.enterCocos({ viewName: 'Game' });
    f.sdk.detach();
    f.sdk.detach();
    expect(f.Xhr.prototype.open).toBe(f.original.open);
    expect(f.Xhr.prototype.send).toBe(f.original.send);
    expect(f.Xhr.prototype.setRequestHeader).toBe(f.original.header);
    expect(f.target.fetch).toBe(f.fetch);
    f.request().finish();
    await f.target.fetch('https://example.test/detached');
    expect(f.calls('rum.startResource')).toHaveLength(0);
    expect(f.calls('rum.stopView')).toHaveLength(1);
    expect(f.calls('sdk.shutdown')).toHaveLength(0);
    expect(() => f.sdk.enterCocos({ viewName: 'Game' })).toThrow('Call attach()');
    expect(() => f.sdk.shutdown()).toThrow('native host');
    expect(() => f.sdk.mobile.shutdown()).toThrow('native host');
    expect(() => f.sdk.start({ sdk: { datakitUrl: 'http://localhost' } })).toThrow('mutually exclusive');

    f.sdk.attach({ autoTrack: { network: false } });
    f.sdk.enterCocos({ viewName: 'Game' });
    f.request().finish();
    expect(f.calls('rum.startResource')).toHaveLength(0);
    f.sdk.detach();
    f.sdk.attach({ autoTrack: { network: true } });
    f.request().finish();
    expect(f.calls('rum.addResource')).toHaveLength(1);
  });

  it('finishes in-flight XHR and fetch once after leave, detach and reattach', async () => {
    const f = setup(engine);
    let resolve!: (response: Response) => void;
    f.fetch.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    f.sdk.attach({ autoTrack: { network: true } });
    f.sdk.enterCocos({ viewName: 'Game' });
    const xhr = f.request();
    const pending = f.target.fetch('https://example.test/pending');
    f.sdk.leaveCocos();
    f.sdk.detach();
    f.sdk.attach({ autoTrack: { network: true } });
    xhr.finish();
    resolve(new Response('{}'));
    await pending;
    expect(f.calls('rum.startResource')).toHaveLength(2);
    expect(f.calls('rum.stopResource')).toHaveLength(2);
    expect(f.calls('rum.addResource')).toHaveLength(2);
    const keys = f.calls('rum.startResource').map(call => call.payload.key);
    expect(f.calls('rum.addResource').map(call => call.payload.key).sort()).toEqual(keys.sort());
  });
});

describe('network lifecycle isolation and failure recovery', () => {
  it('preserves Creator 2 property-backed loadend callbacks across XHR reuse', () => {
    const f = setup('creator2', true);
    f.sdk.attach({ autoTrack: { network: true } });
    const xhr = new f.Xhr();
    const business = vi.fn();
    xhr.addEventListener('loadend', business);
    for (let i = 0; i < 2; i += 1) {
      xhr.open('GET', 'https://example.test/reused');
      xhr.send();
      xhr.finish();
      expect(xhr.onloadend).toBe(business);
    }
    expect(business).toHaveBeenCalledTimes(2);
    expect(business.mock.contexts).toEqual([xhr, xhr]);
    expect(f.calls('rum.addResource')).toHaveLength(2);
    expect(new Set(f.calls('rum.addResource').map(call => call.payload.key)).size).toBe(2);
  });

  it('finishes reporting if a Creator 2 business loadend handler throws after detach', () => {
    const f = setup('creator2', true);
    f.sdk.attach({ autoTrack: { network: true } });
    const xhr = new f.Xhr();
    xhr.onloadend = () => { throw new Error('business error'); };
    xhr.open('GET', 'https://example.test/error');
    xhr.send();
    f.sdk.detach();
    expect(() => xhr.finish()).toThrow('business error');
    expect(f.calls('rum.addResource')).toHaveLength(1);
  });

  it('keeps scene, action, error and console tracking page-scoped', () => {
    const f = setup();
    const config: FTAutoTrackingConfig = { network: true, scenes: true, actions: true, errors: true, console: true };
    const error = () => f.events.dispatchEvent(Object.assign(new Event('error'), { message: 'test error' }));
    const emit = () => { f.scene('Next'); f.action(); error(); f.target.console.log('test'); f.request().finish(); };
    f.sdk.attach({ autoTrack: config });
    emit();
    expect(f.calls('rum.startView')).toHaveLength(0);
    expect(f.calls('rum.addError')).toHaveLength(0);
    expect(f.calls('logger.log')).toHaveLength(0);
    f.sdk.enterCocos({ viewName: 'Game' });
    emit();
    f.sdk.leaveCocos();
    emit();
    expect(f.calls('rum.startView')).toHaveLength(2);
    expect(f.calls('rum.stopView')).toHaveLength(2);
    expect(f.calls('rum.startAction')).toHaveLength(1);
    expect(f.calls('rum.addError')).toHaveLength(1);
    expect(f.calls('logger.log')).toHaveLength(1);
    expect(f.calls('rum.addResource')).toHaveLength(3);
  });

  it('does not enable network through a duplicate attach', () => {
    const f = setup();
    f.sdk.attach();
    f.sdk.attach({ autoTrack: { network: true } });
    f.sdk.enterCocos({ viewName: 'Game' });
    f.request().finish();
    expect(f.calls('rum.startResource')).toHaveLength(0);
  });

  it('keeps network active when page or Replay entry fails', () => {
    const f = setup();
    let fail = true;
    f.sdk.registerExtension('test', FT_COCOS_SDK_VERSION, 'creator2', () => ({
      value: {}, lifecycle: { enter() { if (fail) throw new Error('recorder failed'); }, leave() {} },
    }));
    f.sdk.attach({ autoTrack: { network: true } });
    expect(() => f.sdk.enterCocos({ viewName: 'Game' })).toThrow('recorder failed');
    f.request().finish();
    fail = false;
    f.transport.fail = 'rum.startView';
    expect(() => f.sdk.enterCocos({ viewName: 'Game' })).toThrow('rum.startView');
    f.transport.fail = undefined;
    f.request().finish();
    f.sdk.enterCocos({ viewName: 'Game' });
    f.request().finish();
    expect(f.calls('rum.addResource')).toHaveLength(3);
  });

  it('does not install hooks when native attachment fails and allows retry', () => {
    const f = setup();
    f.transport.fail = 'hybrid.attach';
    expect(() => f.sdk.attach({ autoTrack: { network: true } })).toThrow('hybrid.attach');
    expect(f.Xhr.prototype.open).toBe(f.original.open);
    expect(f.target.fetch).toBe(f.fetch);
    f.transport.fail = undefined;
    f.sdk.attach({ autoTrack: { network: true } });
    f.request().finish();
    expect(f.calls('rum.addResource')).toHaveLength(1);
  });

  it('rolls back partially installed XHR and fetch hooks when installation fails', () => {
    const f = setup();
    Object.defineProperty(f.Xhr.prototype, 'send', { writable: false, configurable: true });
    try {
      expect(() => f.sdk.attach({ autoTrack: { network: true } })).toThrow();
      expect(f.Xhr.prototype.open).toBe(f.original.open);
      expect(f.Xhr.prototype.setRequestHeader).toBe(f.original.header);
      expect(f.target.fetch).toBe(f.fetch);
    } finally {
      Object.defineProperty(f.Xhr.prototype, 'send', { writable: true });
    }
    f.sdk.attach({ autoTrack: { network: true } });
    f.request().finish();
    expect(f.calls('rum.addResource')).toHaveLength(1);
  });

  it('cleans network even if recorder restoration fails and supports detach retry', () => {
    const f = setup();
    let fail = true;
    const detach = vi.fn();
    f.sdk.registerExtension('test', FT_COCOS_SDK_VERSION, 'creator2', () => ({ value: {}, lifecycle: {
      leave() { if (fail) throw new Error('restore failed'); }, detach,
    } }));
    f.sdk.attach({ autoTrack: { network: true } });
    f.sdk.enterCocos({ viewName: 'Game' });
    expect(() => f.sdk.detach()).toThrow('restore failed');
    expect(f.target.fetch).toBe(f.fetch);
    expect(f.Xhr.prototype.open).toBe(f.original.open);
    expect(detach).not.toHaveBeenCalled();
    fail = false;
    f.sdk.detach();
    expect(detach).toHaveBeenCalledTimes(1);
    expect(f.calls('sdk.shutdown')).toHaveLength(0);
  });

  it('preserves standalone startup and shutdown behavior', async () => {
    const f = setup();
    f.sdk.start({ sdk: { datakitUrl: 'http://localhost' }, autoTrack: { network: true } });
    f.request().finish();
    await f.target.fetch('https://example.test/standalone');
    expect(f.calls('rum.addResource')).toHaveLength(2);
    expect(() => f.sdk.detach()).toThrow('only available after attach');
    f.sdk.shutdown();
    expect(f.target.fetch).toBe(f.fetch);
    expect(f.Xhr.prototype.open).toBe(f.original.open);
    expect(f.calls('sdk.shutdown')).toHaveLength(1);
  });

  it('preserves fetch rejection and XHR failure reporting outside the page', async () => {
    const f = setup();
    const failure = new Error('offline');
    f.fetch.mockRejectedValueOnce(failure);
    f.sdk.attach({ autoTrack: { network: true } });
    await expect(f.target.fetch('https://example.test/offline')).rejects.toBe(failure);
    f.request().finish(0);
    expect(f.calls('rum.stopResource')).toHaveLength(2);
    expect(f.calls('rum.addError')).toHaveLength(1);
    expect(f.calls('rum.addResource')[0]?.payload.content.statusCode).toBe(0);
  });
});
