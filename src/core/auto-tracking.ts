import { FTLogger, FTRUM, FTTrace } from './modules.js';
import type { FTAutoTrackingController, FTAutoTrackingScope } from './client.js';
import type { FTAutoTrackingConfig, FTAttributes } from './types.js';
import type { FTJsbErrorGlobal } from '../native/jsb-errors.js';
import { FTObservationQueue, observationState } from './observation.js';
import { isInternalConsoleLog } from './console-log.js';
import { isInternalErrorText } from './internal-errors.js';
import { viewErrorDeduplicator, type FTErrorReservation } from './error-deduplication.js';

export interface FTEngineTrackingHooks {
  onSceneChanged(callback: (name: string) => void, includeCurrent?: boolean): () => void;
  onAction(callback: (name: string, attributes?: FTAttributes) => void): () => void;
}

interface FTGlobalWithFetch extends FTJsbErrorGlobal {
  fetch?: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  console?: Console;
  addEventListener?: typeof globalThis.addEventListener;
  removeEventListener?: typeof globalThis.removeEventListener;
}

export class FTDefaultAutoTracking implements FTAutoTrackingController {
  private stops: Array<() => void> = [];
  private networkStops: Array<() => void> = [];
  private activeView: string | undefined;
  private readonly observations: FTObservationQueue;

  constructor(
    private readonly rum: FTRUM,
    private readonly logger: FTLogger,
    private readonly trace: FTTrace,
    private readonly hooks: FTEngineTrackingHooks,
    private readonly target: FTGlobalWithFetch = globalThis,
  ) {
    this.observations = new FTObservationQueue(target);
  }

  start(config: FTAutoTrackingConfig, viewName?: string, scope: FTAutoTrackingScope = 'all'): void {
    this.stop(scope);
    try {
      if (scope !== 'network') {
        if (viewName) this.switchView(viewName);
        if (config.scenes) this.installSceneTracking(viewName === undefined);
        if (config.actions) this.installActionTracking();
        if (config.errors) this.installErrorTracking();
        if (config.console) this.installConsoleTracking();
      }
      if (scope !== 'page' && config.network) {
        this.installFetchTracking();
        this.installXhrTracking();
      }
    } catch (error) {
      try { this.stop(scope); } catch { /* Preserve the installation error. */ }
      throw error;
    }
  }

  stop(scope: FTAutoTrackingScope = 'all'): void {
    let failure: unknown;
    const cleanup = (stop: () => void): void => {
      try { stop(); } catch (error) { if (failure === undefined) failure = error; }
    };
    if (scope !== 'page') this.networkStops.splice(0).reverse().forEach(cleanup);
    if (scope !== 'network') {
      this.observations.stop();
      this.stops.splice(0).reverse().forEach(cleanup);
      if (this.activeView) {
        cleanup(() => this.rum.stopView());
        this.activeView = undefined;
      }
    }
    if (failure !== undefined) throw failure;
  }

  private installSceneTracking(includeCurrent: boolean): void {
    this.stops.push(
      this.hooks.onSceneChanged((name) => {
        this.switchView(name);
      }, includeCurrent),
    );
  }

  private switchView(name: string): void {
    if (this.activeView) this.rum.stopView();
    this.activeView = name;
    this.rum.startView(name);
  }

  private installActionTracking(): void {
    this.stops.push(
      this.hooks.onAction((name, attributes) => this.rum.startAction(name, 'click', attributes)),
    );
  }

  private installErrorTracking(): void {
    const nativeErrors = this.target.__FT_COCOS_JSB_ERRORS__;
    if (nativeErrors?.protocol === 2) {
      const deduplicator = viewErrorDeduplicator(nativeErrors);
      const state = observationState(this.target);
      const pending = new Set<FTErrorReservation>();
      this.stops.push(() => {
        pending.forEach(reservation => reservation.release());
        pending.clear();
      });
      this.stops.push(nativeErrors.subscribe((location, message, stack, observation) => {
        if (isInternalErrorText(message) || isInternalErrorText(stack)) return;
        // Creator 2 also reports promise bookkeeping notifications through onError.
        if (message === 'handlerAddedAfterPromiseRejected' || message === 'rejectAfterPromiseResolved'
          || message === 'resolveAfterPromiseResolved') return;
        const rejection = message === 'unhandledRejectedPromise';
        const reason = rejection ? stack.split(/\r?\n/, 1)[0]?.replace(/^Error:\s*/, '') : message;
        const errorMessage = reason || message || 'Uncaught JavaScript error';
        const errorStack = stack || location || '';
        const type = rejection ? 'unhandled_promise_rejection' : 'cocos_error';
        const viewId = observation.context;
        const reservation = typeof viewId === 'string' && viewId
          ? deduplicator.reserve(viewId, type, errorMessage, errorStack) : undefined;
        if (viewId && !reservation) return;
        if (reservation) pending.add(reservation);
        const accepted = this.observations.enqueue(() => {
          try {
            this.rum.addError(errorMessage, errorStack, type);
            reservation?.commit();
          } finally {
            reservation?.release();
            if (reservation) pending.delete(reservation);
          }
        }, 2 * (location.length + message.length + stack.length));
        if (!accepted && reservation) {
          reservation.release();
          pending.delete(reservation);
        }
      }, () => {
        // Context lookup may itself log or trigger JSB callbacks in a host bridge.
        state.reporting++;
        try { return this.rum.observedViewId(); }
        finally { state.reporting--; }
      }));
      return;
    }
    if (nativeErrors || typeof this.target.jsb?.onError === 'function') {
      throw new Error('Cocos native error bootstrap is missing. Rerun the SDK installer and rebuild the native project.');
    }
    if (!this.target.addEventListener || !this.target.removeEventListener) return;
    const errorListener = (event: Event): void => {
      const errorEvent = event as ErrorEvent;
      if (isInternalErrorText(errorEvent.message) || isInternalErrorText(errorEvent.error?.message)
        || isInternalErrorText(errorEvent.error?.stack)) return;
      this.rum.addError(
        errorEvent.message || 'Uncaught JavaScript error',
        errorEvent.error?.stack || `${errorEvent.filename || ''}:${errorEvent.lineno || 0}`,
      );
    };
    const rejectionListener = (event: Event): void => {
      const reason = (event as PromiseRejectionEvent).reason;
      if (isInternalErrorText(reason) || isInternalErrorText(reason?.message) || isInternalErrorText(reason?.stack)) return;
      this.rum.addError(
        reason instanceof Error ? reason.message : String(reason),
        reason instanceof Error ? reason.stack || '' : '',
        'unhandled_promise_rejection',
      );
    };
    this.target.addEventListener('error', errorListener);
    this.target.addEventListener('unhandledrejection', rejectionListener);
    this.stops.push(() => {
      this.target.removeEventListener?.('error', errorListener);
      this.target.removeEventListener?.('unhandledrejection', rejectionListener);
    });
  }

  private installConsoleTracking(): void {
    const consoleObject = this.target.console;
    if (!consoleObject) return;
    const methods: Array<keyof Pick<Console, 'log' | 'info' | 'warn' | 'error'>> = [
      'log',
      'info',
      'warn',
      'error',
    ];
    const observations = this.observations;
    const state = observationState(this.target);
    const originals = new Map<string, (...args: unknown[]) => void>();
    const wrappers = new Map<string, (...args: unknown[]) => unknown>();
    let active = true;
    methods.forEach((method) => {
      const original = consoleObject[method];
      originals.set(method, original);
      const logger = this.logger;
      consoleObject[method] = function (this: unknown, ...args: unknown[]): unknown {
        let snapshot: { timestampMs: number; values: unknown[] } | undefined;
        try {
          if (active && !state.reporting && !isInternalConsoleLog(args)) {
            snapshot = { timestampMs: Date.now(), values: args.slice(0, 16) };
          }
        } catch { /* Snapshot failures cannot prevent the original console call. */ }
        // Keep the original receiver, result and thrown value. No SDK work can
        // escape this finally block and replace the original console outcome.
        try { return original.apply(this, args); }
        finally {
          try {
            if (active && snapshot) {
              const { timestampMs, values } = snapshot;
              observations.enqueue(() => {
                const level = method === 'warn' ? 'warning' : method === 'error' ? 'error' : 'info';
                logger.log(values.map(stringifyLogValue).join(' '), level, { cocos_observed_at_ms: timestampMs });
              }, values.reduce<number>((size, value) => size + (typeof value === 'string' ? value.length * 2 : 64), 0));
            }
          } catch { /* Logging must never change application console behavior. */ }
        }
      } as Console[typeof method];
      wrappers.set(method, consoleObject[method]);
    });
    this.stops.push(() => {
      active = false;
      methods.forEach((method) => {
        const original = originals.get(method);
        if (original && consoleObject[method] === wrappers.get(method)) consoleObject[method] = original as Console[typeof method];
      });
    });
  }

  private installFetchTracking(): void {
    const original = this.target.fetch;
    if (!original) return;
    const rum = this.rum;
    const trace = this.trace;
    let active = true;
    const tracked = function (this: unknown, ...args: Parameters<typeof fetch>): Promise<Response> {
      if (!active) return original.apply(this, args);
      let outgoing = args;
      let data: { key: string; url: string; method: string; start: number; headers?: FTNetworkHeaders } | undefined;
      observeNetwork(() => {
        const [input, init] = args;
        const inputObject = networkInput(input);
        if (!inputObject) return;
        const { url } = inputObject;
        const method = networkOption(init, 'method') as string | undefined;
        const sourceHeaders = networkOption(init, 'headers') as HeadersInit | undefined;
        const record = { key: resourceKey(), url, method: method || inputObject.method || 'GET',
          start: nowNs(), headers: undefined as FTNetworkHeaders | undefined };
        data = record;
        try {
          const headers = createHeaders(sourceHeaders === undefined ? inputObject.headers : sourceHeaders);
          let appended = false;
          forEachOwn(trace.getHeaders(url, record.key), (name, value) => {
            if (!hasHeader(headers, name)) {
              appendHeader(headers, name, value);
              appended = true;
            }
          });
          if (appended) {
            outgoing = args.slice() as Parameters<typeof fetch>;
            outgoing[1] = withRequestHeaders(init, headers);
          }
          record.headers = headers;
        } catch { /* Failed instrumentation leaves the original fetch arguments intact. */ }
        observeNetwork(() => rum.startResource(record.key));
      });
      const reportFailure = (error: unknown): void => {
        if (!data) return;
        const { key } = data;
        observeNetwork(() => rum.stopResource(key));
        observeNetwork(() => rum.addError(String(error), error instanceof Error ? error.stack || '' : '', 'network_error'));
      };
      let result: Promise<Response>;
      // Invoke the application request once. Observation failures must never retry it.
      try {
        result = original.apply(this, outgoing);
      } catch (error) {
        reportFailure(error);
        throw error;
      }
      if (!data) return result;
      const record = data;
      try {
        return result.then((response) => {
          observeNetwork(() => rum.stopResource(record.key));
          observeNetwork(() => {
            const end = nowNs();
            rum.addResource(record.key, {
              url: record.url,
              httpMethod: record.method,
              requestHeaders: record.headers && headersToObject(record.headers),
              responseHeaders: headersToObject(response.headers),
              statusCode: response.status,
            }, { fetchStartTime: record.start, responseStartTime: end, responseEndTime: end });
          });
          return response;
        }, (error: unknown) => {
          reportFailure(error);
          throw error;
        });
      } catch { return result; }
    } as typeof fetch;
    this.networkStops.push(() => {
      active = false;
      if (this.target.fetch === tracked) this.target.fetch = original;
    });
    this.target.fetch = tracked;
  }

  private installXhrTracking(): void {
    const Xhr = this.target.XMLHttpRequest;
    if (!Xhr) return;
    const open = Xhr.prototype.open;
    const send = Xhr.prototype.send;
    const setRequestHeader = Xhr.prototype.setRequestHeader;
    const metadata = new WeakMap<XMLHttpRequest, {
      key: string; method: string; url: string; headers: Record<string, string>; headersKnown: boolean;
    }>();
    const rum = this.rum;
    const trace = this.trace;
    let active = true;

    const trackedOpen = function (this: XMLHttpRequest, ...args: unknown[]): void {
      if (!active) return (open as (...args: unknown[]) => void).apply(this, args);
      const previous = metadata.get(this);
      observeNetwork(() => {
        metadata.delete(this);
        if (typeof args[0] !== 'string' || typeof args[1] !== 'string') return;
        metadata.set(this, { key: resourceKey(), method: args[0] as string, url: String(args[1]),
          headers: Object.create(null) as Record<string, string>, headersKnown: true });
      });
      try { return (open as (...args: unknown[]) => void).apply(this, args); }
      catch (error) {
        observeNetwork(() => { if (previous) metadata.set(this, previous); else metadata.delete(this); });
        throw error;
      }
    } as typeof open;
    // Register each restore before assignment so partial installation can roll back.
    this.networkStops.push(() => { active = false; if (Xhr.prototype.open === trackedOpen) Xhr.prototype.open = open; });
    Xhr.prototype.open = trackedOpen;
    const trackedHeader = function (this: XMLHttpRequest, ...args: Parameters<typeof setRequestHeader>): void {
      const result = setRequestHeader.apply(this, args);
      observeNetwork(() => {
        const data = active && metadata.get(this);
        if (!data) return;
        const [name, value] = args;
        if (typeof name !== 'string' || typeof value !== 'string') { data.headersKnown = false; return; }
        const key = name.toLowerCase();
        data.headers[key] = key in data.headers ? `${data.headers[key]}, ${value}` : value;
      });
      return result;
    };
    this.networkStops.push(() => {
      active = false;
      if (Xhr.prototype.setRequestHeader === trackedHeader) Xhr.prototype.setRequestHeader = setRequestHeader;
    });
    Xhr.prototype.setRequestHeader = trackedHeader;
    const trackedSend = function (this: XMLHttpRequest, ...args: Parameters<typeof send>): void {
      const data = active && metadata.get(this);
      if (!data) return send.apply(this, args);
      observeNetwork(() => {
        if (!data.headersKnown) return;
        forEachOwn(trace.getHeaders(data.url, data.key), (name, value) => {
          if (!validTraceHeader(name, value)) return;
          const key = name.toLowerCase();
          if (key in data.headers) return;
          setRequestHeader.call(this, name, value);
          data.headers[key] = value;
        });
      });
      let started = 0;
      observeNetwork(() => { started = nowNs(); rum.startResource(data.key); });
      let completed = false;
      let cleanup: (() => void) | undefined;
      const report = (): void => {
        if (completed) return;
        completed = true;
        observeNetwork(() => cleanup?.());
        observeNetwork(() => rum.stopResource(data.key));
        observeNetwork(() => {
          const ended = nowNs();
          rum.addResource(data.key, {
            url: data.url,
            httpMethod: data.method,
            requestHeaders: data.headers,
            responseHeaders: parseXhrHeaders(this.getAllResponseHeaders()),
            statusCode: this.status,
          }, { fetchStartTime: started, responseStartTime: ended, responseEndTime: ended });
        });
      };
      observeNetwork(() => {
        const originalLoadEnd = this.onloadend;
        try {
          this.addEventListener('loadend', report, { once: true });
          // Creator 2 JSB assigns the on* property instead of keeping a listener list.
          if (this.onloadend === report) {
            const xhr = this;
            const handler: NonNullable<XMLHttpRequest['onloadend']> = function (...events): unknown {
              observeNetwork(() => cleanup?.());
              try { return originalLoadEnd?.apply(this, events); } finally { report(); }
            };
            cleanup = () => { if (xhr.onloadend === handler) xhr.onloadend = originalLoadEnd; };
            this.onloadend = handler;
          } else {
            cleanup = () => this.removeEventListener('loadend', report);
          }
        } catch {
          observeNetwork(() => cleanup?.());
          observeNetwork(() => { if (this.onloadend === report) this.onloadend = originalLoadEnd; });
        }
      });
      try { return send.apply(this, args); }
      catch (error) {
        completed = true;
        observeNetwork(() => cleanup?.());
        observeNetwork(() => rum.stopResource(data.key));
        throw error;
      }
    };
    this.networkStops.push(() => { active = false; if (Xhr.prototype.send === trackedSend) Xhr.prototype.send = send; });
    Xhr.prototype.send = trackedSend;
  }
}

function nowNs(): number {
  return Date.now() * 1_000_000;
}

let resourceSequence = 0;
function resourceKey(): string {
  resourceSequence = (resourceSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `cocos-${Date.now().toString(36)}-${resourceSequence.toString(36)}`;
}

type FTNetworkHeaders = Headers | Array<[string, string]>;

function observeNetwork(observe: () => void): void {
  try { observe(); } catch { /* Monitoring cannot change the application's network result. */ }
}

function networkOption(init: RequestInit | undefined, name: string): unknown {
  for (let source = init; source; source = Object.getPrototypeOf(source) as RequestInit | undefined) {
    const descriptor = Object.getOwnPropertyDescriptor(source, name);
    if (!descriptor) continue;
    // Accessors may refresh tokens or mutate options. Leave them to the original fetch.
    if (descriptor.get || descriptor.set) throw new TypeError('Network option requires its original receiver');
    return descriptor.value;
  }
  return undefined;
}

function networkInput(input: RequestInfo | URL): { url: string; method?: string; headers?: HeadersInit } | undefined {
  if (typeof input === 'string') return { url: input };
  if (typeof Request === 'function' && input instanceof Request) {
    const read = (name: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(Request.prototype, name);
      return descriptor?.get ? descriptor.get.call(input) : networkOption(input, name);
    };
    return { url: read('url') as string, method: read('method') as string, headers: read('headers') as HeadersInit };
  }
  if (typeof URL === 'function' && input instanceof URL) return { url: URL.prototype.toString.call(input) };
  // Custom string conversion belongs to the application request and must only run there.
  return undefined;
}

function withRequestHeaders(init: RequestInit | undefined, headers: FTNetworkHeaders): RequestInit {
  const result = Object.create(init || null) as RequestInit;
  // Forward getters to their original receiver, including inherited/non-enumerable options.
  for (let source = init; source && source !== Object.prototype; source = Object.getPrototypeOf(source) as RequestInit | undefined) {
    Object.getOwnPropertyNames(source).forEach((name) => {
      if (name === 'headers' || Object.prototype.hasOwnProperty.call(result, name)) return;
      const descriptor = Object.getOwnPropertyDescriptor(source, name);
      Object.defineProperty(result, name, { enumerable: descriptor?.enumerable, configurable: true,
        get: () => (init as Record<string, unknown>)[name] });
    });
  }
  Object.defineProperty(result, 'headers', { value: headers, enumerable: true, configurable: true, writable: true });
  return result;
}

function createHeaders(source?: HeadersInit): FTNetworkHeaders {
  const HeadersConstructor = (globalThis as unknown as { Headers?: typeof Headers }).Headers;
  if (HeadersConstructor) return new HeadersConstructor(source);
  const result: Array<[string, string]> = [];
  if (Array.isArray(source)) {
    source.forEach(([name, value]) => { result.push([String(name), String(value)]); });
  } else if (source && typeof (source as Headers).forEach === 'function') {
    (source as Headers).forEach((value, name) => { result.push([name, value]); });
  } else if (source) {
    forEachOwn(source as Record<string, string>, (name, value) => { result.push([name, String(value)]); });
  }
  return result;
}

function hasHeader(headers: FTNetworkHeaders, name: string): boolean {
  return Array.isArray(headers) ? headers.some(([key]) => key.toLowerCase() === name.toLowerCase()) : headers.has(name);
}

function appendHeader(headers: FTNetworkHeaders, name: string, value: string): void {
  if (!validTraceHeader(name, value)) throw new TypeError('Invalid trace header');
  if (Array.isArray(headers)) headers.push([name, value]);
  else headers.append(name, value);
}

function validTraceHeader(name: string, value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) && typeof value === 'string'
    && !/[\x00-\x08\x0a-\x1f\x7f\u0100-\uffff]/.test(value);
}

function headersToObject(headers: FTNetworkHeaders): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  const append = (value: string, name: string): void => {
    const key = name.toLowerCase();
    result[key] = key in result ? `${result[key]}, ${value}` : value;
  };
  if (Array.isArray(headers)) headers.forEach(([name, value]) => append(value, name));
  else headers.forEach(append);
  return result;
}

function forEachOwn<T>(value: Record<string, T>, callback: (key: string, item: T) => void): void {
  Object.keys(value).forEach((key) => callback(key, value[key] as T));
}

function parseXhrHeaders(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  raw.trim().split(/[\r\n]+/).forEach((line) => {
    const index = line.indexOf(':');
    if (index > 0) result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  });
  return result;
}

function stringifyLogValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.message}\n${value.stack || ''}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
