import type {
  FTHybridSessionReplayConfig,
  FTReplayQuality,
} from './types.js';

export function samplingRate(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
  return value;
}

export function captureFps(value: number | undefined): number {
  const fps = value === undefined ? 1 : value;
  if (!Number.isInteger(fps) || fps < 1 || fps > 5) {
    throw new RangeError('captureFps must be an integer between 1 and 5');
  }
  return fps;
}

export interface FTResolvedReplayImagePolicy {
  quality: FTReplayQuality;
  compressionQuality: number;
  maxImageDimension: number;
  maxFrameBytes: number;
  maxBytesPerMinute: number;
  adaptiveCapture: boolean;
}

const REPLAY_IMAGE_PRESETS: Record<FTReplayQuality, Omit<FTResolvedReplayImagePolicy, 'quality' | 'adaptiveCapture'>> = {
  low: {
    compressionQuality: 0.35,
    maxImageDimension: 480,
    maxFrameBytes: 20 * 1024,
    maxBytesPerMinute: Math.round(0.6 * 1024 * 1024),
  },
  medium: {
    compressionQuality: 0.45,
    maxImageDimension: 720,
    maxFrameBytes: 40 * 1024,
    maxBytesPerMinute: Math.round(1.5 * 1024 * 1024),
  },
  high: {
    compressionQuality: 0.6,
    maxImageDimension: 960,
    maxFrameBytes: 80 * 1024,
    maxBytesPerMinute: 4 * 1024 * 1024,
  },
};

export function replayImagePolicy(config: FTHybridSessionReplayConfig): FTResolvedReplayImagePolicy {
  const policy = config.imagePolicy || {};
  const quality = policy.quality ?? 'medium';
  if (!(quality in REPLAY_IMAGE_PRESETS)) {
    throw new TypeError("imagePolicy.quality must be 'low', 'medium', or 'high'");
  }
  if (policy.adaptiveCapture !== undefined && typeof policy.adaptiveCapture !== 'boolean') {
    throw new TypeError('imagePolicy.adaptiveCapture must be a boolean');
  }
  const preset = REPLAY_IMAGE_PRESETS[quality];
  const maxImageDimension = config.maxImageDimension ?? preset.maxImageDimension;
  integerInRange(maxImageDimension, 1, 2048, 'maxImageDimension');
  const maxFrameBytes = policy.maxFrameBytes ?? preset.maxFrameBytes;
  integerInRange(maxFrameBytes, 1024, 1024 * 1024, 'imagePolicy.maxFrameBytes');
  const maxBytesPerMinute = policy.maxBytesPerMinute ?? preset.maxBytesPerMinute;
  integerInRange(maxBytesPerMinute, 16 * 1024, 64 * 1024 * 1024, 'imagePolicy.maxBytesPerMinute');
  if (maxFrameBytes > maxBytesPerMinute) {
    throw new RangeError('imagePolicy.maxFrameBytes must not exceed maxBytesPerMinute');
  }
  return {
    quality,
    compressionQuality: preset.compressionQuality,
    maxImageDimension,
    maxFrameBytes,
    maxBytesPerMinute,
    adaptiveCapture: policy.adaptiveCapture ?? true,
  };
}

function integerInRange(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

export function requireText(value: string, name: string): string {
  if (!value.trim()) throw new TypeError(`${name} must not be empty`);
  return value;
}
