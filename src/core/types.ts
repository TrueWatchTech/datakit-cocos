/** A scalar value accepted by SDK attributes. */
export type FTPrimitive = string | number | boolean | null;

/** A JSON-compatible SDK attribute value. */
export type FTValue = FTPrimitive | FTValue[] | { [key: string]: FTValue };

/** Custom attributes attached to RUM, Log, and Resource data. */
export type FTAttributes = Record<string, FTValue>;

/** Deployment environment reported with SDK data. */
export type FTEnvironment = 'prod' | 'gray' | 'pre' | 'common' | 'local' | string;

/** Base SDK connection and service settings. */
export interface FTSDKConfig {
  /** Datakit address used for direct data reporting. */
  datakitUrl?: string;
  /** DataWay address used for public data reporting. Requires {@link clientToken}. */
  datawayUrl?: string;
  /** Client token used with {@link datawayUrl}. Keep this value outside source control. */
  clientToken?: string;
  /** Service name attached to collected data. */
  serviceName?: string;
  /** Deployment environment attached to collected data. */
  env?: FTEnvironment;
  /** Enables native SDK debug output. */
  debug?: boolean;
  /** String attributes included with all data produced by the native SDK. */
  globalContext?: Record<string, string>;
}

/** User identity bound to subsequent SDK data. */
export interface FTUserData {
  /** Stable application-specific user identifier. */
  userId: string;
  /** Display name of the user. */
  userName?: string;
  /** Email address of the user. */
  userEmail?: string;
  /** Additional string attributes associated with the user. */
  extra?: Record<string, string>;
}

/** Real User Monitoring configuration. */
export interface FTRUMConfig {
  /** Android RUM application ID. */
  androidAppId?: string;
  /** iOS RUM application ID. */
  iosAppId?: string;
  /** Session sampling rate from `0` to `1`. */
  sampleRate?: number;
  /** Additional replay sampling rate from `0` to `1` for sessions that contain errors. */
  sessionOnErrorSampleRate?: number;
  /** Enables native user-action tracking. */
  enableNativeUserAction?: boolean;
  /** Enables native view tracking. */
  enableNativeUserView?: boolean;
  /** Enables native resource tracking. */
  enableNativeUserResource?: boolean;
  /** Enables native crash tracking. */
  enableNativeCrash?: boolean;
  /** Enables Android ANR tracking. Ignored on platforms that do not support it. */
  enableNativeAnr?: boolean;
  /** Enables native UI-block or freeze tracking. */
  enableNativeUiBlock?: boolean;
  /** Minimum native UI-block duration in milliseconds. */
  nativeUiBlockDurationMs?: number;
  /** Native SDK error-monitor bit mask. */
  errorMonitorType?: number;
  /** Native SDK device-metrics monitor bit mask. */
  deviceMetricsMonitorType?: number;
  /** Device-metrics collection frequency. */
  detectFrequency?: 'normal' | 'frequent' | 'rare';
  /** String attributes included with all RUM data. */
  globalContext?: Record<string, string>;
}

/** Log level accepted by the SDK logger. */
export type FTLogLevel = 'info' | 'warning' | 'error' | 'critical' | 'ok' | string;

/** Logger configuration. */
export interface FTLoggerConfig {
  /** Log sampling rate from `0` to `1`. */
  sampleRate?: number;
  /** Associates logs with the current RUM session. */
  enableLinkRumData?: boolean;
  /** Enables logs submitted through the Cocos SDK logger. */
  enableCustomLog?: boolean;
  /** Mirrors custom logs to the platform console. */
  printCustomLogToConsole?: boolean;
  /** Policy used when the native log cache reaches its limit. */
  discardStrategy?: 'discard' | 'discardOldest';
  /** Log levels accepted by the native logger. */
  logLevelFilters?: FTLogLevel[];
  /** Maximum number of cached log entries. */
  logCacheLimitCount?: number;
  /** String attributes included with every log. */
  globalContext?: Record<string, string>;
}

/** Distributed-tracing propagation format. */
export type FTTraceType =
  | 'ddTrace'
  | 'zipkinMultiHeader'
  | 'zipkinSingleHeader'
  | 'traceparent'
  | 'skywalking'
  | 'jaeger';

/** Distributed-tracing configuration. */
export interface FTTraceConfig {
  /** Trace sampling rate from `0` to `1`. */
  sampleRate?: number;
  /** Header propagation format. */
  traceType?: FTTraceType;
  /** Associates trace data with the current RUM session. */
  enableLinkRumData?: boolean;
  /** Enables native automatic network tracing. */
  enableNativeAutoTrace?: boolean;
}

/** Visual treatment applied to a Session Replay node. */
export type FTReplayPrivacyMode = 'mask' | 'hide' | 'unmask';

/** Whether Session Replay records touch positions. */
export type FTReplayTouchPrivacy = 'show' | 'hide';

/** Image quality preset used by Cocos Session Replay. */
export type FTReplayQuality = 'low' | 'medium' | 'high';

/** Image traffic controls for Cocos Session Replay. */
export interface FTReplayImagePolicy {
  /** Compression, size, and traffic preset. @defaultValue `'medium'` */
  quality?: FTReplayQuality;
  /** Maximum encoded bytes for a normal image resource. */
  maxFrameBytes?: number;
  /** Maximum encoded image bytes retained in a rolling 60-second window. */
  maxBytesPerMinute?: number;
  /** Adapts effective capture rate, image quality, and size as the budget fills. @defaultValue `true` */
  adaptiveCapture?: boolean;
}

/** Session Replay configuration for standalone Cocos applications. */
export interface FTSessionReplayConfig {
  /** Replay sampling rate from `0` to `1`. */
  sampleRate?: number;
  /** Additional replay sampling rate from `0` to `1` for sessions that contain errors. */
  sessionOnErrorSampleRate?: number;
  /** Canvas capture rate in frames per second. Accepts integers from `1` to `5`. @defaultValue `1` */
  captureFps?: number;
  /** Maximum width or height of a captured frame. Accepts `1` to `2048`. @defaultValue `720` */
  maxImageDimension?: number;
  /** Image compression and rolling traffic-budget controls. */
  imagePolicy?: FTReplayImagePolicy;
  /** Whether captured replays include touch positions. @defaultValue `'hide'` */
  touchPrivacy?: FTReplayTouchPrivacy;
}

/** Cocos-side Session Replay settings when the native host owns SDK initialization. */
export interface FTHybridSessionReplayConfig {
  /** Canvas capture rate in frames per second. Accepts integers from `1` to `5`. @defaultValue `1` */
  captureFps?: number;
  /** Maximum width or height of a captured frame. Accepts `1` to `2048`. @defaultValue `720` */
  maxImageDimension?: number;
  /** Image compression and rolling traffic-budget controls. */
  imagePolicy?: FTReplayImagePolicy;
  /** Whether captured replays include touch positions. @defaultValue `'hide'` */
  touchPrivacy?: FTReplayTouchPrivacy;
}

/** Request and response details recorded for a manually tracked resource. */
export interface FTResourceContent {
  /** Absolute resource URL. */
  url: string;
  /** HTTP method, such as `GET` or `POST`. */
  httpMethod: string;
  /** Request headers safe to include in observability data. */
  requestHeaders?: Record<string, string>;
  /** Response headers safe to include in observability data. */
  responseHeaders?: Record<string, string>;
  /** Optional response body safe to include in observability data. */
  responseBody?: string;
  /** HTTP response status code. */
  statusCode?: number;
  /** Response content type. */
  responseContentType?: string;
  /** Response content encoding. */
  responseContentEncoding?: string;
}

/** Optional timing metrics for a manually tracked resource. Values are nanosecond timestamps. */
export interface FTResourceMetrics {
  /** Time at which the fetch operation started. */
  fetchStartTime?: number;
  /** Time at which the TCP connection started. */
  tcpStartTime?: number;
  /** Time at which the TCP connection completed. */
  tcpEndTime?: number;
  /** Time at which DNS resolution started. */
  dnsStartTime?: number;
  /** Time at which DNS resolution completed. */
  dnsEndTime?: number;
  /** Time at which the first response data arrived. */
  responseStartTime?: number;
  /** Time at which the response completed. */
  responseEndTime?: number;
  /** Time at which the TLS handshake started. */
  sslStartTime?: number;
  /** Time at which the TLS handshake completed. */
  sslEndTime?: number;
}

/** Cocos events that the SDK can track automatically. */
export interface FTAutoTrackingConfig {
  /** Tracks Cocos scene changes as RUM views. */
  scenes?: boolean;
  /** Tracks supported pointer interactions as RUM actions. */
  actions?: boolean;
  /** Tracks supported Cocos errors as RUM errors. */
  errors?: boolean;
  /** Sends supported console output to the SDK logger. */
  console?: boolean;
  /** Tracks supported network requests as RUM resources and traces. */
  network?: boolean;
}

/** Complete configuration for a standalone Cocos application. */
export interface FTCocosConfig {
  /** Required base SDK configuration. */
  sdk: FTSDKConfig;
  /** Enables and configures RUM. */
  rum?: FTRUMConfig;
  /** Enables and configures logging. */
  logger?: FTLoggerConfig;
  /** Enables and configures distributed tracing. */
  trace?: FTTraceConfig;
  /** Enables and configures Session Replay. */
  replay?: FTSessionReplayConfig;
  /** Enables selected Cocos automatic-tracking integrations. */
  autoTrack?: FTAutoTrackingConfig;
}

/** Cocos-side configuration for applications initialized by a native host. */
export interface FTCocosHybridConfig {
  /** Enables Cocos canvas capture while the application is inside Cocos. */
  replay?: FTHybridSessionReplayConfig;
  /** Enables selected Cocos automatic-tracking integrations. */
  autoTrack?: FTAutoTrackingConfig;
}

/** Options applied when entering a Cocos runtime from a native host. */
export interface FTCocosEnterOptions {
  /** RUM view name used when automatic scene tracking is disabled. */
  viewName?: string;
}

/** Internal native RUM context used by Session Replay encoding. */
export interface FTRUMContext {
  applicationId: string;
  sessionId: string;
  viewId: string;
  globalContext?: FTAttributes;
}

/** Internal privacy rectangle projected into a captured frame. */
export interface FTPrivacyRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  mode: Exclude<FTReplayPrivacyMode, 'unmask'>;
}

/** Internal in-memory representation of a captured Cocos frame. */
export interface FTCapturedFrame {
  rgba: Uint8Array;
  width: number;
  height: number;
  timestamp: number;
  privacyRegions?: FTPrivacyRegion[];
}

/** Internal persisted representation of a captured Cocos frame. */
export interface FTStoredFrame {
  path: string;
  width: number;
  height: number;
  timestamp: number;
  fingerprint: string;
}
