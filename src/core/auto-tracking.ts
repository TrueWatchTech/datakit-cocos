import { FTLogger, FTRUM, FTTrace } from './modules.js';
import type { FTAutoTrackingController } from './client.js';
import type { FTAutoTrackingConfig, FTAttributes } from './types.js';

export interface FTEngineTrackingHooks {
  onSceneChanged(callback: (name: string) => void, includeCurrent?: boolean): () => void;
  onAction(callback: (name: string, attributes?: FTAttributes) => void): () => void;
}

interface FTGlobalWithFetch {
  fetch?: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  console?: Console;
  addEventListener?: typeof globalThis.addEventListener;
  removeEventListener?: typeof globalThis.removeEventListener;
}

export class FTDefaultAutoTracking implements FTAutoTrackingController {
  private stops: Array<() => void> = [];
  private activeView: string | undefined;

  constructor(
    private readonly rum: FTRUM,
    private readonly logger: FTLogger,
    private readonly trace: FTTrace,
    private readonly hooks: FTEngineTrackingHooks,
    private readonly target: FTGlobalWithFetch = globalThis,
  ) {}

  start(config: FTAutoTrackingConfig, viewName?: string): void {
    this.stop();
    if (viewName) this.switchView(viewName);
    if (config.scenes) this.installSceneTracking(viewName === undefined);
    if (config.actions) this.installActionTracking();
    if (config.errors) this.installErrorTracking();
    if (config.console) this.installConsoleTracking();
    if (config.network) {
      this.installFetchTracking();
      this.installXhrTracking();
    }
  }

  stop(): void {
    this.stops.splice(0).reverse().forEach((stop) => stop());
    if (this.activeView) {
      this.rum.stopView();
      this.activeView = undefined;
    }
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
    if (!this.target.addEventListener || !this.target.removeEventListener) return;
    const errorListener = (event: Event): void => {
      const errorEvent = event as ErrorEvent;
      this.rum.addError(
        errorEvent.message || 'Uncaught JavaScript error',
        errorEvent.error?.stack || `${errorEvent.filename || ''}:${errorEvent.lineno || 0}`,
      );
    };
    const rejectionListener = (event: Event): void => {
      const reason = (event as PromiseRejectionEvent).reason;
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
    const originals = new Map<string, (...args: unknown[]) => void>();
    methods.forEach((method) => {
      const original = consoleObject[method].bind(consoleObject) as (...args: unknown[]) => void;
      originals.set(method, original);
      consoleObject[method] = ((...args: unknown[]) => {
        original(...args);
        const level = method === 'warn' ? 'warning' : method === 'error' ? 'error' : 'info';
        this.logger.log(args.map(stringifyLogValue).join(' '), level);
      }) as Console[typeof method];
    });
    this.stops.push(() => {
      methods.forEach((method) => {
        const original = originals.get(method);
        if (original) consoleObject[method] = original as Console[typeof method];
      });
    });
  }

  private installFetchTracking(): void {
    const original = this.target.fetch;
    if (!original) return;
    const tracked = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const inputObject = typeof input === 'object' ? input as { url?: string; method?: string; headers?: HeadersInit } : undefined;
      const url = typeof input === 'string' ? input : inputObject?.url || String(input);
      const method = init?.method || inputObject?.method || 'GET';
      const key = resourceKey();
      const headers = createHeaders(init?.headers || inputObject?.headers);
      forEachOwn(this.trace.getHeaders(url, key), (name, value) => setHeader(headers, name, value));
      this.rum.startResource(key);
      const start = nowNs();
      try {
        const response = await original(input, { ...init, headers });
        const end = nowNs();
        this.rum.stopResource(key);
        this.rum.addResource(
          key,
          {
            url,
            httpMethod: method,
            requestHeaders: headersToObject(headers),
            responseHeaders: headersToObject(response.headers),
            statusCode: response.status,
          },
          { fetchStartTime: start, responseStartTime: end, responseEndTime: end },
        );
        return response;
      } catch (error) {
        this.rum.stopResource(key);
        this.rum.addError(String(error), error instanceof Error ? error.stack || '' : '', 'network_error');
        throw error;
      }
    }) as typeof fetch;
    this.target.fetch = tracked;
    this.stops.push(() => {
      this.target.fetch = original;
    });
  }

  private installXhrTracking(): void {
    const Xhr = this.target.XMLHttpRequest;
    if (!Xhr) return;
    const open = Xhr.prototype.open;
    const send = Xhr.prototype.send;
    const setRequestHeader = Xhr.prototype.setRequestHeader;
    const metadata = new WeakMap<XMLHttpRequest, { key: string; method: string; url: string; headers: Record<string, string> }>();
    const rum = this.rum;
    const trace = this.trace;

    Xhr.prototype.open = function trackedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
      metadata.set(this, { key: resourceKey(), method, url: String(url), headers: {} });
      (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof open;
    Xhr.prototype.setRequestHeader = function trackedHeader(this: XMLHttpRequest, name: string, value: string): void {
      const data = metadata.get(this);
      if (data) data.headers[name] = value;
      setRequestHeader.call(this, name, value);
    };
    Xhr.prototype.send = function trackedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
      const data = metadata.get(this);
      if (!data) return send.call(this, body);
      forEachOwn(trace.getHeaders(data.url, data.key), (name, value) => {
        data.headers[name] = value;
        setRequestHeader.call(this, name, value);
      });
      const started = nowNs();
      rum.startResource(data.key);
      this.addEventListener(
        'loadend',
        () => {
          const ended = nowNs();
          rum.stopResource(data.key);
          rum.addResource(
            data.key,
            {
              url: data.url,
              httpMethod: data.method,
              requestHeaders: data.headers,
              responseHeaders: parseXhrHeaders(this.getAllResponseHeaders()),
              statusCode: this.status,
            },
            { fetchStartTime: started, responseStartTime: ended, responseEndTime: ended },
          );
        },
        { once: true },
      );
      send.call(this, body);
    };
    this.stops.push(() => {
      Xhr.prototype.open = open;
      Xhr.prototype.send = send;
      Xhr.prototype.setRequestHeader = setRequestHeader;
    });
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

function createHeaders(source?: HeadersInit): Headers | Record<string, string> {
  const HeadersConstructor = (globalThis as unknown as { Headers?: typeof Headers }).Headers;
  if (HeadersConstructor) return new HeadersConstructor(source);
  const result: Record<string, string> = {};
  if (Array.isArray(source)) {
    source.forEach(([name, value]) => { result[name] = String(value); });
  } else if (source && typeof (source as Headers).forEach === 'function') {
    (source as Headers).forEach((value, name) => { result[name] = value; });
  } else if (source) {
    forEachOwn(source as Record<string, string>, (name, value) => { result[name] = String(value); });
  }
  return result;
}

function setHeader(headers: Headers | Record<string, string>, name: string, value: string): void {
  if (typeof (headers as Headers).set === 'function') (headers as Headers).set(name, value);
  else (headers as Record<string, string>)[name] = value;
}

function headersToObject(headers: Headers | Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof (headers as Headers).forEach === 'function') {
    (headers as Headers).forEach((value, key) => { result[key] = value; });
  } else {
    forEachOwn(headers as Record<string, string>, (key, value) => { result[key] = value; });
  }
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
