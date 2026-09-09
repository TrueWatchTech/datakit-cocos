import type { FTNativeTransport } from './transport.js';
import type {
  FTAttributes,
  FTLogLevel,
  FTLoggerConfig,
  FTResourceContent,
  FTResourceMetrics,
  FTRUMConfig,
  FTSDKConfig,
  FTTraceConfig,
  FTUserData,
} from './types.js';
import { requireText, samplingRate } from './validation.js';
import {
  FT_COCOS_SDK_BRIDGE_INFO,
  FT_COCOS_SDK_BRIDGE_INFO_KEY,
  FT_COCOS_SDK_VERSION,
  FT_COCOS_SDK_VERSION_KEY,
} from './version.js';

export class FTSDKOwnership {
  private mode: 'unclaimed' | 'standalone' | 'native-host' = 'unclaimed';

  claimStandalone(): void {
    if (this.mode === 'native-host') {
      throw new Error('The native host owns SDK initialization in Hybrid mode');
    }
    this.mode = 'standalone';
  }

  claimNativeHost(): void {
    if (this.mode === 'standalone') {
      throw new Error('Standalone initialization and native-host attachment are mutually exclusive');
    }
    this.mode = 'native-host';
  }

  releaseNativeHost(): void {
    if (this.mode === 'native-host') this.mode = 'unclaimed';
  }

  releaseStandalone(): void {
    if (this.mode === 'standalone') this.mode = 'unclaimed';
  }

  assertNativeHostDoesNotOwnSDK(): void {
    if (this.mode === 'native-host') {
      throw new Error('The native host owns the native SDK in Hybrid mode');
    }
  }
}

function compact<T extends object>(value: T): T {
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  Object.keys(value).forEach((key) => {
    if (source[key] !== undefined) result[key] = source[key];
  });
  return result as T;
}

function withBridgeInfo(attributes?: FTAttributes): FTAttributes {
  return {
    [FT_COCOS_SDK_BRIDGE_INFO_KEY]: FT_COCOS_SDK_BRIDGE_INFO,
    ...(attributes || {}),
  };
}

/** Base SDK lifecycle and user identity operations. */
export class FTMobileAgent {
  constructor(
    private readonly transport: FTNativeTransport,
    private readonly ownership = new FTSDKOwnership(),
  ) {}

  /**
   * Initializes the native SDK connection.
   *
   * Supply either `datakitUrl`, or both `datawayUrl` and `clientToken`.
   *
   * @param config - Base SDK connection and service settings.
   */
  start(config: FTSDKConfig): void {
    if (!config.datakitUrl && !(config.datawayUrl && config.clientToken)) {
      throw new TypeError('Configure datakitUrl or datawayUrl with clientToken');
    }
    this.ownership.claimStandalone();
    this.transport.invoke('sdk.configure', compact({
      ...config,
      globalContext: {
        ...(config.globalContext || {}),
        [FT_COCOS_SDK_VERSION_KEY]: FT_COCOS_SDK_VERSION,
      },
    }));
  }

  /**
   * Binds a user identity to data collected after this call.
   *
   * @param user - A user ID or a structured user record.
   */
  bindUser(user: FTUserData | string): void {
    this.transport.invoke(
      'sdk.bindUser',
      typeof user === 'string' ? { userId: requireText(user, 'userId') } : user,
    );
  }

  /** Removes the currently bound user identity. */
  unbindUser(): void {
    this.transport.invoke('sdk.unbindUser');
  }

  /** Shuts down a standalone native SDK instance. */
  shutdown(): void {
    this.ownership.assertNativeHostDoesNotOwnSDK();
    this.transport.invoke('sdk.shutdown');
    this.ownership.releaseStandalone();
  }
}

/** Manual Real User Monitoring operations. */
export class FTRUM {
  constructor(
    private readonly transport: FTNativeTransport,
    private readonly ownership = new FTSDKOwnership(),
  ) {}

  /**
   * Enables RUM with the supplied native and Cocos settings.
   *
   * @param config - RUM application IDs, sampling, and native tracking options.
   */
  start(config: FTRUMConfig): void {
    samplingRate(config.sampleRate, 'rum.sampleRate');
    samplingRate(config.sessionOnErrorSampleRate, 'rum.sessionOnErrorSampleRate');
    this.ownership.claimStandalone();
    this.transport.invoke('rum.configure', compact(config));
  }

  /**
   * Starts a RUM view.
   *
   * @param name - Application-defined view name.
   * @param attributes - Optional attributes attached to the view.
   */
  startView(name: string, attributes?: FTAttributes): void {
    this.transport.invoke('rum.startView', {
      name: requireText(name, 'view name'),
      attributes: withBridgeInfo(attributes),
    });
  }

  /**
   * Stops the currently active RUM view.
   *
   * @param attributes - Optional attributes attached when the view stops.
   */
  stopView(attributes?: FTAttributes): void {
    this.transport.invoke('rum.stopView', { attributes: withBridgeInfo(attributes) });
  }

  /**
   * Records a completed RUM action.
   *
   * @param name - Application-defined action name.
   * @param type - Action category. @defaultValue `'click'`
   * @param attributes - Optional attributes attached to the action.
   */
  addAction(name: string, type = 'click', attributes?: FTAttributes): void {
    this.transport.invoke('rum.addAction', {
      name: requireText(name, 'action name'),
      type: requireText(type, 'action type'),
      attributes: withBridgeInfo(attributes),
    });
  }

  /**
   * Starts a RUM action whose completion is detected by the native SDK.
   *
   * @param name - Application-defined action name.
   * @param type - Action category. @defaultValue `'click'`
   * @param attributes - Optional attributes attached to the action.
   */
  startAction(name: string, type = 'click', attributes?: FTAttributes): void {
    this.transport.invoke('rum.startAction', {
      name: requireText(name, 'action name'),
      type: requireText(type, 'action type'),
      attributes: withBridgeInfo(attributes),
    });
  }

  /**
   * Records an application error.
   *
   * @param message - Human-readable error message.
   * @param stack - Error stack or diagnostic details.
   * @param type - Application-defined error category. @defaultValue `'cocos_error'`
   * @param state - Application state when the error occurred. @defaultValue `'run'`
   * @param attributes - Optional attributes attached to the error.
   */
  addError(
    message: string,
    stack: string,
    type = 'cocos_error',
    state: 'run' | 'startup' | 'unknown' = 'run',
    attributes?: FTAttributes,
  ): void {
    this.transport.invoke('rum.addError', {
      message,
      stack,
      type,
      state,
      attributes: withBridgeInfo(attributes),
    });
  }

  /**
   * Records a long task.
   *
   * @param stack - Stack or diagnostic details for the task.
   * @param durationNs - Task duration in nanoseconds.
   * @param attributes - Optional attributes attached to the task.
   */
  addLongTask(stack: string, durationNs: number, attributes?: FTAttributes): void {
    this.transport.invoke('rum.addLongTask', {
      stack,
      durationNs,
      attributes: withBridgeInfo(attributes),
    });
  }

  /**
   * Starts tracking a resource using an application-defined correlation key.
   *
   * @param key - Key reused by subsequent calls for this resource.
   * @param attributes - Optional attributes attached to the resource.
   */
  startResource(key: string, attributes?: FTAttributes): void {
    this.transport.invoke('rum.startResource', {
      key: requireText(key, 'resource key'),
      attributes: withBridgeInfo(attributes),
    });
  }

  /**
   * Stops timing a resource previously started with {@link startResource}.
   *
   * @param key - Key passed to {@link startResource}.
   * @param attributes - Optional attributes attached when timing stops.
   */
  stopResource(key: string, attributes?: FTAttributes): void {
    this.transport.invoke('rum.stopResource', {
      key: requireText(key, 'resource key'),
      attributes: withBridgeInfo(attributes),
    });
  }

  /**
   * Adds request, response, and optional timing details to a tracked resource.
   *
   * @param key - Key passed to {@link startResource} and {@link stopResource}.
   * @param content - Request and response details safe to collect.
   * @param metrics - Optional network timing metrics.
   */
  addResource(
    key: string,
    content: FTResourceContent,
    metrics?: FTResourceMetrics,
  ): void {
    this.transport.invoke('rum.addResource', {
      key: requireText(key, 'resource key'),
      content,
      metrics,
    });
  }
}

/** Manual logging operations. */
export class FTLogger {
  constructor(
    private readonly transport: FTNativeTransport,
    private readonly ownership = new FTSDKOwnership(),
  ) {}

  /**
   * Enables the native logger.
   *
   * @param config - Logger sampling, filtering, and cache settings.
   */
  start(config: FTLoggerConfig): void {
    samplingRate(config.sampleRate, 'logger.sampleRate');
    this.ownership.claimStandalone();
    this.transport.invoke('logger.configure', compact(config));
  }

  /**
   * Writes a custom log entry.
   *
   * @param content - Log message.
   * @param level - Log severity. @defaultValue `'info'`
   * @param attributes - Optional attributes attached to the log.
   */
  log(content: string, level: FTLogLevel = 'info', attributes?: FTAttributes): void {
    this.transport.invoke('logger.log', {
      content,
      level,
      attributes: withBridgeInfo(attributes),
    });
  }
}

/** Distributed-tracing operations. */
export class FTTrace {
  constructor(
    private readonly transport: FTNativeTransport,
    private readonly ownership = new FTSDKOwnership(),
  ) {}

  /**
   * Enables distributed tracing.
   *
   * @param config - Trace sampling and propagation settings.
   */
  start(config: FTTraceConfig): void {
    samplingRate(config.sampleRate, 'trace.sampleRate');
    this.ownership.claimStandalone();
    this.transport.invoke('trace.configure', compact(config));
  }

  /**
   * Returns propagation headers for an outgoing request.
   *
   * Pass the same `resourceKey` used for manual RUM resource tracking to link
   * the request with its trace.
   *
   * @param url - Absolute outgoing request URL.
   * @param resourceKey - Optional key used for manual RUM resource tracking.
   * @returns Headers to merge into the outgoing request.
   */
  getHeaders(url: string, resourceKey?: string): Record<string, string> {
    return (
      this.transport.invoke('trace.getHeaders', {
        url: requireText(url, 'url'),
        resourceKey,
      }) as Record<string, string> | undefined
    ) || {};
  }
}
