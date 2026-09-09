import type { FTResolvedReplayImagePolicy } from './validation.js';

const WINDOW_MS = 60_000;
const THROTTLED_CAPTURE_INTERVAL_MS = 2_000;
export const REPLAY_KEY_FRAME_BURST_BYTES = 100 * 1024;

interface FTReplayBudgetEntry {
  timestamp: number;
  byteSize: number;
}

export interface FTReplayCaptureDecision {
  allowed: boolean;
  compressionQuality: number;
  maxImageDimension: number;
  maxFrameBytes: number;
  usedBytes: number;
  priority: boolean;
  reason?: 'budget' | 'throttle';
}

/** Rolling image budget. Segment and pointer bytes intentionally remain outside this controller. */
export class FTReplayBudget {
  private entries: FTReplayBudgetEntry[] = [];
  private lastCaptureAttempt: number | undefined;
  private burstKeys: string[] = [];
  private pressure: 'normal' | 'throttled' | 'degraded' | 'paused' = 'normal';

  constructor(private readonly policy: FTResolvedReplayImagePolicy) {}

  reset(): void {
    this.entries = [];
    this.lastCaptureAttempt = undefined;
    this.burstKeys = [];
    this.pressure = 'normal';
  }

  decide(timestamp: number, priorityKey?: string): FTReplayCaptureDecision {
    const used = this.usedBytes(timestamp);
    const ratio = used / this.policy.maxBytesPerMinute;
    this.updatePressure(ratio);
    const hasBurst = priorityKey !== undefined && !this.burstKeys.includes(priorityKey);
    if (ratio >= 1 && !hasBurst) return this.decision(false, 0, used, hasBurst, 'budget');
    if (
      this.policy.adaptiveCapture
      && this.pressure !== 'normal'
      && this.lastCaptureAttempt !== undefined
      && timestamp - this.lastCaptureAttempt < THROTTLED_CAPTURE_INTERVAL_MS
      && !hasBurst
    ) {
      return this.decision(false, 0, used, hasBurst, 'throttle');
    }

    this.lastCaptureAttempt = timestamp;
    const normalRemaining = Math.max(0, this.policy.maxBytesPerMinute - used);
    const available = normalRemaining + (hasBurst ? REPLAY_KEY_FRAME_BURST_BYTES : 0);
    const frameLimit = hasBurst
      ? Math.min(Math.max(this.policy.maxFrameBytes, REPLAY_KEY_FRAME_BURST_BYTES), available)
      : Math.min(this.policy.maxFrameBytes, available);
    return this.decision(
      frameLimit >= 1024,
      frameLimit,
      used,
      hasBurst,
      frameLimit >= 1024 ? undefined : 'budget',
    );
  }

  record(timestamp: number, byteSize: number, priorityKey?: string): void {
    if (!Number.isFinite(byteSize) || byteSize <= 0) return;
    this.prune(timestamp);
    this.entries.push({ timestamp, byteSize: Math.round(byteSize) });
    if (priorityKey && !this.burstKeys.includes(priorityKey)) {
      this.burstKeys.push(priorityKey);
      if (this.burstKeys.length > 64) this.burstKeys.shift();
    }
  }

  usedBytes(timestamp: number): number {
    this.prune(timestamp);
    return this.entries.reduce((total, entry) => total + entry.byteSize, 0);
  }

  private prune(timestamp: number): void {
    const cutoff = timestamp - WINDOW_MS;
    while (this.entries.length > 0 && this.entries[0]!.timestamp <= cutoff) this.entries.shift();
  }

  private decision(
    allowed: boolean,
    maxFrameBytes: number,
    usedBytes: number,
    priority: boolean,
    reason?: FTReplayCaptureDecision['reason'],
  ): FTReplayCaptureDecision {
    const degraded = this.policy.adaptiveCapture
      && (this.pressure === 'degraded' || this.pressure === 'paused');
    return {
      allowed,
      compressionQuality: degraded
        ? Math.max(0.25, Math.round(this.policy.compressionQuality * 0.75 * 100) / 100)
        : this.policy.compressionQuality,
      maxImageDimension: degraded
        ? Math.min(
            this.policy.maxImageDimension,
            Math.max(240, Math.floor(this.policy.maxImageDimension * 0.75)),
          )
        : this.policy.maxImageDimension,
      maxFrameBytes: Math.max(0, Math.floor(maxFrameBytes)),
      usedBytes,
      priority,
      ...(reason ? { reason } : {}),
    };
  }

  private updatePressure(ratio: number): void {
    if (!this.policy.adaptiveCapture) {
      this.pressure = 'normal';
      return;
    }
    if (ratio >= 1) {
      this.pressure = 'paused';
      return;
    }
    if (ratio >= 0.9) {
      this.pressure = 'degraded';
      return;
    }
    if (this.pressure === 'paused' || this.pressure === 'degraded') {
      if (ratio >= 0.8) {
        this.pressure = 'degraded';
        return;
      }
    }
    if (ratio >= 0.75) {
      this.pressure = 'throttled';
      return;
    }
    if (this.pressure === 'throttled' && ratio >= 0.65) return;
    this.pressure = 'normal';
  }
}
