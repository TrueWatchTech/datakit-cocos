import {
  encodeReplayImageRecord,
  encodeReplayPointerRecords,
  type FTReplayPointerRecord,
} from './replay-encoding.js';
import { emitReplayDiagnostic, replayUtf8ByteLength } from './replay-diagnostics.js';
import type { FTNativeTransport } from '@truewatchtech/cocos-sdk/plugin-api';
import type {
  FTCapturedFrame,
  FTHybridSessionReplayConfig,
  FTPrivacyRegion,
  FTRUMContext,
  FTSessionReplayConfig,
  FTStoredFrame,
} from './types.js';
import {
  captureFps,
  replayImagePolicy,
  samplingRate,
  type FTResolvedReplayImagePolicy,
} from './validation.js';

export interface FTCanvasCapture {
  getViewportSize?(): { width: number; height: number } | undefined;
  capture(maxImageDimension: number): Promise<FTCapturedFrame | undefined>;
  persist(frame: FTCapturedFrame, fingerprint: string): Promise<FTStoredFrame>;
  disposeStoredFrame(frame: FTStoredFrame): void | Promise<void>;
  /** Cancel pending GPU capture and release reusable capture resources. */
  dispose?(): void;
  setPrivacy(node: unknown, mode: 'mask' | 'hide' | 'unmask'): void;
}

export interface FTReplayPointerEvent {
  eventType: 'down' | 'up' | 'move';
  pointerId: number;
  normalizedX: number;
  normalizedY: number;
  timestamp: number;
}

export interface FTReplayPointerSource {
  onReplayPointer(callback: (event: FTReplayPointerEvent) => void): () => void;
}

const MAX_PENDING_POINTER_EVENTS = 512;
// Approximate comparisons must not hide small animations indefinitely.
const MAX_APPROXIMATE_STATIC_MS = 2_000;
const SAMPLE_TILE_SIZE = 32;

export interface FTReplaySaveImageV2Result {
  resourceId: string;
  byteSize: number;
  width: number;
  height: number;
  mimeType?: `image/${string}`;
}

interface FTReplaySavedImage extends Omit<FTReplaySaveImageV2Result, 'byteSize'> {
  byteSize?: number;
  byteSizeSource: 'native' | 'unavailable';
}

export interface FTReplayFrameSample {
  width: number;
  height: number;
  luminance: Uint8Array;
  rgb: Uint8Array;
}

/** Cocos canvas Session Replay controls. */
export class FTSessionReplay {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private running = false;
  private mode: 'idle' | 'standalone' | 'hybrid' = 'idle';
  private hybridReplayEnabled = false;
  private captureGeneration = 0;
  private config: Required<Pick<FTSessionReplayConfig, 'captureFps'>> = { captureFps: 1 };
  private imagePolicy: FTResolvedReplayImagePolicy = replayImagePolicy({});
  private lastFingerprint: string | undefined;
  private lastContextKey: string | undefined;
  private lastPrivacyKey: string | undefined;
  private lastFrameSample: FTReplayFrameSample | undefined;
  private lastImageTimestamp: number | undefined;
  private lastDisplaySize: { width: number; height: number } | undefined;
  private lastViewportSize: { width: number; height: number } | undefined;
  private imagePolicyEnabled = false;
  private supportsSaveImageV2: boolean | undefined;
  private recordCounts = new Map<string, number>();
  private recordTouches = false;
  private pendingPointerEvents: FTReplayPointerEvent[] = [];
  private stopPointerTracking: (() => void) | undefined;

  constructor(
    private readonly transport: FTNativeTransport,
    private readonly capture: FTCanvasCapture,
    private readonly pointerSource?: FTReplayPointerSource,
    private readonly validateNative?: () => void,
  ) {}

  /**
   * Enables native Session Replay and starts Cocos canvas capture for a
   * standalone application.
   *
   * @param config - Replay sampling, capture, and touch-privacy settings.
   */
  start(config: FTSessionReplayConfig = {}): void {
    if (this.mode === 'hybrid') {
      throw new Error('Hybrid Replay is managed by enterCocos() and leaveCocos()');
    }
    if (this.mode === 'standalone') return;
    samplingRate(config.sampleRate, 'replay.sampleRate');
    samplingRate(config.sessionOnErrorSampleRate, 'replay.sessionOnErrorSampleRate');
    this.configureCapture(config);
    this.validateNative?.();
    this.transport.invoke('replay.configure', config as never);
    this.mode = 'standalone';
    this.startCapture();
  }

  /** @internal */
  attachHybrid(config?: FTHybridSessionReplayConfig): void {
    if (this.mode === 'standalone') {
      throw new Error('Standalone Replay and Hybrid Replay are mutually exclusive');
    }
    if (this.mode === 'hybrid') return;
    this.configureCapture(config || {});
    this.hybridReplayEnabled = config !== undefined;
    this.mode = 'hybrid';
  }

  /** @internal */
  detachHybrid(): void {
    if (this.mode !== 'hybrid') return;
    this.stopCapture();
    this.hybridReplayEnabled = false;
    this.mode = 'idle';
  }

  /** @internal */
  enterHybrid(): void {
    if (this.mode !== 'hybrid') {
      throw new Error('Call attach() before entering Hybrid Replay');
    }
    if (!this.hybridReplayEnabled || this.running) return;
    this.transport.invoke('hybrid.setExternalRecorderActive', { active: true });
    this.startCapture();
  }

  /** @internal */
  leaveHybrid(): void {
    if (this.mode !== 'hybrid' || !this.hybridReplayEnabled) return;
    this.stopCapture();
    this.transport.invoke('hybrid.setExternalRecorderActive', { active: false });
  }

  private configureCapture(config: FTHybridSessionReplayConfig): void {
    if (config.touchPrivacy !== undefined && config.touchPrivacy !== 'show' && config.touchPrivacy !== 'hide') {
      throw new TypeError("touchPrivacy must be either 'show' or 'hide'");
    }
    this.config = { captureFps: captureFps(config.captureFps) };
    this.imagePolicy = replayImagePolicy(config);
    // Lossy image MIME must be validated against the deployed player before
    // becoming an implicit default. Supplying imagePolicy opts into V2 now.
    this.imagePolicyEnabled = config.imagePolicy !== undefined;
    this.recordTouches = config.touchPrivacy === 'show';
  }

  /** Stops standalone Cocos canvas capture and native Session Replay. */
  stop(): void {
    if (this.mode === 'hybrid') {
      throw new Error('Hybrid Replay is managed by enterCocos() and leaveCocos()');
    }
    if (this.mode === 'idle') return;
    this.stopCapture();
    this.transport.invoke('replay.stop');
    this.mode = 'idle';
  }

  /**
   * Changes the Session Replay privacy treatment for a Cocos node.
   *
   * `mask` obscures the node, `hide` removes the region from the replay, and
   * `unmask` clears an earlier code override, restoring any ReplayPrivacy
   * component rule or default input masking. Code overrides take priority over
   * a component on the same node. The node must belong to the active Cocos scene.
   *
   * @param node - Cocos node whose rendered bounds receive the privacy rule.
   * @param mode - Privacy treatment to apply.
   */
  setPrivacy(node: unknown, mode: 'mask' | 'hide' | 'unmask'): void {
    this.capture.setPrivacy(node, mode);
  }

  /** @internal */
  async captureNow(): Promise<boolean> {
    if (this.busy) {
      emitReplayDiagnostic({ type: 'capture_skipped', timestamp: Date.now(), reason: 'busy' });
      return false;
    }
    const generation = this.captureGeneration;
    this.busy = true;
    let stored: FTStoredFrame | undefined;
    let context: FTRUMContext | undefined;
    let pointerSize = this.lastDisplaySize;
    try {
      context = this.readContext();
      if (!context) return false;
      const contextKey = `${context.applicationId}:${context.sessionId}:${context.viewId}`;
      const contextChanged = contextKey !== this.lastContextKey;
      const viewportSize = this.capture.getViewportSize?.();
      const viewportChanged = this.lastViewportSize !== undefined
        && viewportSize !== undefined
        && (
          viewportSize.width !== this.lastViewportSize.width
          || viewportSize.height !== this.lastViewportSize.height
        );
      // Do not send coordinates for a new viewport before its image and
      // metadata have been accepted. Keep pending touches for that capture.
      if (contextChanged || viewportChanged) pointerSize = undefined;
      const now = Date.now();
      emitReplayDiagnostic({
        type: 'capture_attempt',
        timestamp: now,
      });

      const frame = await this.capture.capture(this.imagePolicy.maxImageDimension);
      if (generation !== this.captureGeneration) return false;
      if (!frame) return false;
      // Native encoding may shrink the resource to meet the per-image limit, but
      // the replay canvas, image bounds and touch coordinates stay in one
      // logical space based on the configured maximum size.
      const displaySize = viewportSize
        ? scaledReplayViewport(viewportSize, this.imagePolicy.maxImageDimension)
        : this.lastDisplaySize
          ? this.lastDisplaySize
          : { width: frame.width, height: frame.height };
      applyPrivacyRegions(frame.rgba, frame.width, frame.height, frame.privacyRegions || []);
      const fingerprint = frameFingerprint(frame.rgba);
      const privacyKey = privacyRegionsKey(frame.privacyRegions || []);
      const sample = sampleReplayFrame(frame.rgba, frame.width, frame.height);
      const comparable = contextKey === this.lastContextKey
        && !viewportChanged
        && frame.width === this.lastFrameSample?.width
        && frame.height === this.lastFrameSample?.height
        && privacyKey === this.lastPrivacyKey;
      const duplicate = comparable && fingerprint === this.lastFingerprint;
      const approximatelyStatic = comparable
        && !duplicate
        && this.lastImageTimestamp !== undefined
        && now - this.lastImageTimestamp < MAX_APPROXIMATE_STATIC_MS
        && replayFramesLookSimilar(this.lastFrameSample, sample);
      if (duplicate || approximatelyStatic) {
        emitReplayDiagnostic({
          type: 'capture_skipped',
          timestamp: now,
          reason: duplicate ? 'dedupe' : 'approx_static',
        });
        return pointerSize ? this.writePendingPointers(context, pointerSize.width, pointerSize.height) : false;
      }
      stored = await this.capture.persist(frame, fingerprint);
      if (generation !== this.captureGeneration) return false;
      const saved = await this.saveImage(stored, this.imagePolicy.compressionQuality, this.imagePolicy.maxFrameBytes);
      if (generation !== this.captureGeneration) return false;
      if (!saved) {
        emitReplayDiagnostic({ type: 'capture_skipped', timestamp: now, reason: 'image_rejected' });
        return pointerSize ? this.writePendingPointers(context, pointerSize.width, pointerSize.height) : false;
      }

      const pendingPointers = this.scaledPendingPointers(displaySize.width, displaySize.height);
      const encoded = encodeReplayImageRecord({
        context,
        resourceId: saved.resourceId,
        width: displaySize.width,
        height: displaySize.height,
        ...(saved.mimeType ? { mimeType: saved.mimeType } : {}),
        timestamp: stored.timestamp,
        contextChanged,
        viewportChanged,
        pointerEvents: pendingPointers,
      });
      this.transport.invoke('replay.writeSegment', {
        viewId: context.viewId,
        segment: encoded.segment,
      });
      emitReplayDiagnostic({
        type: 'segment_encoded',
        timestamp: now,
        byteSize: replayUtf8ByteLength(encoded.segment),
        recordCount: encoded.recordCount,
        pointerRecordCount: pendingPointers.length,
        hasImage: true,
      });
      this.updateRecordCount(context.viewId, encoded.recordCount);
      this.pendingPointerEvents.splice(0, pendingPointers.length);
      emitReplayDiagnostic({
        type: 'image_saved',
        timestamp: now,
        byteSize: saved.byteSize,
        width: saved.width,
        height: saved.height,
        ...(saved.mimeType ? { mimeType: saved.mimeType } : {}),
        priority: contextChanged || viewportChanged,
        byteSizeSource: saved.byteSizeSource,
      });
      this.lastFingerprint = fingerprint;
      this.lastContextKey = contextKey;
      this.lastPrivacyKey = privacyKey;
      this.lastFrameSample = sample;
      this.lastImageTimestamp = now;
      this.lastDisplaySize = displaySize;
      this.lastViewportSize = viewportSize;
      return true;
    } catch (error) {
      if (generation !== this.captureGeneration) return false;
      emitReplayDiagnostic({ type: 'capture_skipped', timestamp: Date.now(), reason: 'error' });
      console.error('[cocos-sdk] Session Replay frame dropped:', error);
      if (context && pointerSize) {
        try {
          return this.writePendingPointers(context, pointerSize.width, pointerSize.height);
        } catch (pointerError) {
          console.error('[cocos-sdk] Session Replay pointer segment dropped:', pointerError);
        }
      }
      return false;
    } finally {
      try {
        if (stored) await this.capture.disposeStoredFrame(stored);
      } finally {
        this.busy = false;
      }
    }
  }

  private startCapture(): void {
    this.captureGeneration += 1;
    this.running = true;
    this.lastFingerprint = undefined;
    this.lastContextKey = undefined;
    this.lastPrivacyKey = undefined;
    this.lastFrameSample = undefined;
    this.lastImageTimestamp = undefined;
    this.lastDisplaySize = undefined;
    this.lastViewportSize = undefined;
    this.recordCounts.clear();
    this.pendingPointerEvents = [];
    if (this.recordTouches && this.pointerSource) {
      this.stopPointerTracking = this.pointerSource.onReplayPointer((event) => {
        emitReplayDiagnostic({
          type: 'pointer_received',
          timestamp: event.timestamp,
          eventType: event.eventType,
        });
        this.pendingPointerEvents.push(event);
        if (this.pendingPointerEvents.length > MAX_PENDING_POINTER_EVENTS) {
          this.pendingPointerEvents.splice(0, this.pendingPointerEvents.length - MAX_PENDING_POINTER_EVENTS);
        }
      });
    }
    this.schedule(0, this.captureGeneration);
  }

  private stopCapture(): void {
    const wasRunning = this.running;
    this.captureGeneration += 1;
    this.running = false;
    this.stopPointerTracking?.();
    this.stopPointerTracking = undefined;
    this.pendingPointerEvents = [];
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.capture.dispose?.();
    if (wasRunning) emitReplayDiagnostic({ type: 'replay_stopped', timestamp: Date.now() });
  }

  private schedule(delay: number, generation: number): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      if (!this.running || generation !== this.captureGeneration) return;
      const startedAt = Date.now();
      try {
        await this.captureNow();
      } catch (error) {
        console.error('[cocos-sdk] Session Replay frame dropped:', error);
      } finally {
        if (this.running && generation === this.captureGeneration) {
          // Encoding and file cleanup are part of the frame interval. Keep one
          // frame in flight and skip missed slots instead of accumulating work.
          const interval = 1000 / this.config.captureFps;
          const elapsed = Math.max(0, Date.now() - startedAt);
          const slots = Math.max(1, Math.ceil(elapsed / interval));
          this.schedule(Math.max(0, slots * interval - elapsed), generation);
        }
      }
    }, delay);
  }

  private readContext(): FTRUMContext | undefined {
    const value = this.transport.invoke('replay.getContext') as unknown;
    return normalizeRumContext(value);
  }

  private async saveImage(
    stored: FTStoredFrame,
    compressionQuality: number,
    maxFrameBytes: number,
  ): Promise<FTReplaySavedImage | undefined> {
    if (this.imagePolicyEnabled) {
      if (this.supportsSaveImageV2 !== false) {
        try {
          const value = await this.invokeSaveImage('replay.saveImageV2', {
            path: stored.path,
            width: stored.width,
            height: stored.height,
            quality: compressionQuality,
            maxFrameBytes,
          }) as unknown;
          if (value !== undefined) {
            this.supportsSaveImageV2 = true;
            if (isRejectedSaveImageV2(value)) return undefined;
            const result = normalizeSaveImageV2Result(value);
            if (result.byteSize > maxFrameBytes) {
              throw new RangeError('Native replay image exceeded imagePolicy.maxFrameBytes');
            }
            return { ...result, byteSizeSource: 'native' };
          }
          this.supportsSaveImageV2 = false;
        } catch (error) {
          if (!isUnknownBridgeMethod(error)) throw error;
          this.supportsSaveImageV2 = false;
        }
      }
      // V1 cannot enforce encoded size. Never silently discard a caller's
      // explicit image policy by falling back to unbounded image storage.
      throw new Error('Replay imagePolicy requires replay.saveImageV2. Upgrade the native Replay SDK and rebuild the native project.');
    }

    const resourceId = await this.invokeSaveImage('replay.saveImage', {
      path: stored.path,
      width: stored.width,
      height: stored.height,
    }) as string | undefined;
    if (!resourceId) return undefined;
    return {
      resourceId,
      width: stored.width,
      height: stored.height,
      // Legacy storage does not report actual bytes; do not invent traffic.
      byteSizeSource: 'unavailable',
      ...(this.transport.platform === 'ios' ? { mimeType: 'image/png' as const } : {}),
    };
  }

  private invokeSaveImage(method: string, payload: unknown): Promise<unknown> {
    return this.transport.invokeAsync
      ? this.transport.invokeAsync(method, payload)
      : Promise.resolve(this.transport.invoke(method, payload));
  }

  private writePendingPointers(context: FTRUMContext, width: number, height: number): boolean {
    const pointerEvents = this.scaledPendingPointers(width, height);
    if (pointerEvents.length === 0) return false;
    const encoded = encodeReplayPointerRecords({ context, pointerEvents });
    this.transport.invoke('replay.writeSegment', {
      viewId: context.viewId,
      segment: encoded.segment,
    });
    emitReplayDiagnostic({
      type: 'segment_encoded',
      timestamp: Date.now(),
      byteSize: replayUtf8ByteLength(encoded.segment),
      recordCount: encoded.recordCount,
      pointerRecordCount: pointerEvents.length,
      hasImage: false,
    });
    this.updateRecordCount(context.viewId, encoded.recordCount);
    this.pendingPointerEvents.splice(0, pointerEvents.length);
    return true;
  }

  private scaledPendingPointers(width: number, height: number): FTReplayPointerRecord[] {
    return this.pendingPointerEvents.map((event) => ({
      eventType: event.eventType,
      pointerId: event.pointerId,
      x: Math.round(clamp(event.normalizedX, 0, 1) * width),
      y: Math.round(clamp(event.normalizedY, 0, 1) * height),
      timestamp: event.timestamp,
    }));
  }

  private updateRecordCount(viewId: string, added: number): void {
    const count = (this.recordCounts.get(viewId) || 0) + added;
    this.recordCounts.set(viewId, count);
    this.transport.invoke('replay.setRecordCount', { viewId, count });
  }
}

function scaledReplayViewport(size: { width: number; height: number }, maxDimension: number): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

function normalizeRumContext(value: unknown): FTRUMContext | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const context = value as Record<string, unknown>;
  const applicationId = stringValue(context.applicationId, context.application_id);
  const sessionId = stringValue(context.sessionId, context.session_id);
  const viewId = stringValue(context.viewId, context.view_id);
  if (!applicationId || !sessionId || !viewId) return undefined;
  const globalContext = context.globalContext;
  return {
    applicationId,
    sessionId,
    viewId,
    ...(globalContext && typeof globalContext === 'object'
      ? { globalContext: globalContext as FTRUMContext['globalContext'] }
      : {}),
  };
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

export function normalizeSaveImageV2Result(value: unknown): FTReplaySaveImageV2Result {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid replay.saveImageV2 result');
  const result = value as Record<string, unknown>;
  const resourceId = stringValue(result.resourceId, result.resource_id);
  const byteSize = numberValue(result.byteSize, result.byte_size);
  const width = numberValue(result.width);
  const height = numberValue(result.height);
  const mimeType = stringValue(result.mimeType, result.mime_type);
  if (!resourceId || !isPositiveInteger(byteSize) || !isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new TypeError('Invalid replay.saveImageV2 result');
  }
  if (mimeType && !mimeType.startsWith('image/')) {
    throw new TypeError('Invalid replay.saveImageV2 mimeType');
  }
  return {
    resourceId,
    byteSize,
    width,
    height,
    ...(mimeType ? { mimeType: mimeType as `image/${string}` } : {}),
  };
}

function isRejectedSaveImageV2(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { accepted?: unknown }).accepted === false;
}

function isUnknownBridgeMethod(error: unknown): boolean {
  return error instanceof Error && /unknown bridge method|unrecognized selector/i.test(error.message);
}

function numberValue(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function isPositiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0;
}

export function sampleReplayFrame(
  rgba: Uint8Array,
  width: number,
  height: number,
  maximumSamples = 4096,
): FTReplayFrameSample {
  const pixelCount = width * height;
  if (width < 1 || height < 1 || rgba.length < pixelCount * 4) {
    throw new RangeError('Replay frame RGBA data does not match its dimensions');
  }
  const sampleCount = Math.min(maximumSamples, pixelCount);
  const luminance = new Uint8Array(sampleCount);
  const rgb = new Uint8Array(sampleCount * 3);
  for (let index = 0; index < sampleCount; index += 1) {
    const pixel = Math.min(pixelCount - 1, Math.floor(index * pixelCount / sampleCount));
    const offset = pixel * 4;
    rgb[index * 3] = rgba[offset]!;
    rgb[index * 3 + 1] = rgba[offset + 1]!;
    rgb[index * 3 + 2] = rgba[offset + 2]!;
    luminance[index] = Math.round(
      (rgba[offset]! * 54 + rgba[offset + 1]! * 183 + rgba[offset + 2]! * 19) / 256,
    );
  }
  return { width, height, luminance, rgb };
}

export function replayFramesLookSimilar(
  previous: FTReplayFrameSample | undefined,
  current: FTReplayFrameSample,
): boolean {
  if (
    !previous
    || previous.width !== current.width
    || previous.height !== current.height
    || previous.luminance.length !== current.luminance.length
  ) return false;
  let totalDifference = 0;
  let changedSamples = 0;
  const tileColumns = Math.ceil(current.width / SAMPLE_TILE_SIZE);
  const tileCount = tileColumns * Math.ceil(current.height / SAMPLE_TILE_SIZE);
  const tileSamples = new Uint16Array(tileCount);
  const tileChanges = new Uint16Array(tileCount);
  for (let index = 0; index < current.luminance.length; index += 1) {
    const difference = Math.abs(current.luminance[index]! - previous.luminance[index]!);
    totalDifference += difference;
    if (difference >= 12) changedSamples += 1;
    const pixel = Math.floor(index * current.width * current.height / current.luminance.length);
    const tile = Math.floor(Math.floor(pixel / current.width) / SAMPLE_TILE_SIZE) * tileColumns
      + Math.floor((pixel % current.width) / SAMPLE_TILE_SIZE);
    tileSamples[tile]! += 1;
    const offset = index * 3;
    // Color-only changes also matter, even when their luminance is unchanged.
    if (Math.max(
      Math.abs(current.rgb[offset]! - previous.rgb[offset]!),
      Math.abs(current.rgb[offset + 1]! - previous.rgb[offset + 1]!),
      Math.abs(current.rgb[offset + 2]! - previous.rgb[offset + 2]!),
    ) >= 12) tileChanges[tile]! += 1;
  }
  for (let tile = 0; tile < tileCount; tile += 1) {
    // A moving sprite can occupy much less than 1% of the whole screen.
    if (tileChanges[tile]! >= 2 && tileChanges[tile]! / tileSamples[tile]! >= 0.1) return false;
  }
  const averageDifference = totalDifference / current.luminance.length;
  const changedRatio = changedSamples / current.luminance.length;
  return averageDifference <= 2.5 && changedRatio <= 0.01;
}

function privacyRegionsKey(regions: FTPrivacyRegion[]): string {
  return regions.map((region) => (
    `${region.mode}:${region.x}:${region.y}:${region.width}:${region.height}`
  )).join('|');
}

export function frameFingerprint(bytes: Uint8Array): string {
  let hash = 2166136261;
  // Sparse hashing can classify changes between sampled bytes as duplicates,
  // bypassing both local motion detection and the approximate refresh limit.
  // Read RGBA words without copying normal capture buffers to keep this cheap
  // on the Cocos JS thread. Mix high bits down so every color channel matters.
  const aligned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const words = new Uint32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.length / 4));
  for (let index = 0; index < words.length; index += 1) {
    hash = Math.imul(hash ^ words[index]!, 16777619);
    hash ^= hash >>> 16;
  }
  for (let index = words.length * 4; index < bytes.length; index += 1) {
    hash ^= bytes[index]!;
    hash = Math.imul(hash, 16777619);
  }
  return `${bytes.length.toString(16)}-${(hash >>> 0).toString(16)}`;
}

export function applyPrivacyRegions(
  rgba: Uint8Array,
  width: number,
  height: number,
  regions: FTPrivacyRegion[],
): void {
  regions.forEach((region) => {
    const startX = clamp(Math.floor(region.x), 0, width);
    const startY = clamp(Math.floor(region.y), 0, height);
    const endX = clamp(Math.ceil(region.x + region.width), 0, width);
    const endY = clamp(Math.ceil(region.y + region.height), 0, height);
    const color = region.mode === 'hide' ? 0 : 128;
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const offset = (y * width + x) * 4;
        rgba[offset] = color;
        rgba[offset + 1] = color;
        rgba[offset + 2] = color;
        rgba[offset + 3] = 255;
      }
    }
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
