export type FTReplaySkipReason =
  | 'dedupe'
  | 'approx_static'
  | 'throttle'
  | 'budget'
  | 'busy'
  | 'error';

export type FTReplayDiagnosticEvent =
  | { type: 'capture_attempt'; timestamp: number; usedBytes: number; maxBytesPerMinute: number }
  | { type: 'capture_skipped'; timestamp: number; reason: FTReplaySkipReason }
  | {
    type: 'image_saved';
    timestamp: number;
    byteSize: number;
    width: number;
    height: number;
    mimeType?: string;
    priority: boolean;
    byteSizeSource: 'native' | 'frame_limit_estimate';
  }
  | {
    type: 'segment_encoded';
    timestamp: number;
    byteSize: number;
    recordCount: number;
    pointerRecordCount: number;
    hasImage: boolean;
  }
  | { type: 'pointer_received'; timestamp: number; eventType: 'down' | 'up' | 'move' }
  | { type: 'replay_stopped'; timestamp: number };

type FTReplayDiagnosticObserver = (event: FTReplayDiagnosticEvent) => void;

interface FTReplayDiagnosticGlobal {
  __FT_COCOS_REPLAY_BENCHMARK_OBSERVER__?: FTReplayDiagnosticObserver;
}

/** @internal Benchmark-only observer hook. Production builds leave it unset. */
export function emitReplayDiagnostic(event: FTReplayDiagnosticEvent): void {
  const observer = (globalThis as FTReplayDiagnosticGlobal).__FT_COCOS_REPLAY_BENCHMARK_OBSERVER__;
  if (typeof observer !== 'function') return;
  try {
    observer(event);
  } catch {
    // Diagnostics must never affect capture, storage, or upload behavior.
  }
}

export function replayUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}
