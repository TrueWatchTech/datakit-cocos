import type { FTCapturedFrame, FTStoredFrame } from './types.js';

interface FTReplayFileBridge {
  write(bytes: Uint8Array, path: string): boolean;
  poll(): 'pending' | 'written' | 'removed' | 'error';
  remove(path: string): boolean;
}

let sequence = 0;
function bridge(): FTReplayFileBridge {
  const value = (globalThis as unknown as { __ftCocosReplayFile?: FTReplayFileBridge }).__ftCocosReplayFile;
  if (!value) throw new Error('Rebuild the native project with the Cocos SDK extension to enable asynchronous Replay storage');
  return value;
}

async function waitForFile(expected: 'written' | 'removed'): Promise<void> {
  for (;;) {
    await new Promise<void>((resolve) => setTimeout(resolve, 16));
    const status = bridge().poll();
    if (status === expected) return;
    if (status !== 'pending') throw new Error(`Replay file operation failed: ${status}`);
  }
}

/** Copies pixels into native-owned memory; all file operations run off the game thread. */
export async function persistReplayFrame(
  frame: FTCapturedFrame,
  fingerprint: string,
  writablePath: string,
): Promise<FTStoredFrame> {
  const path = `${writablePath}cocos-sdk-replay-${Date.now()}-${++sequence}-${fingerprint}.rgba`;
  if (!bridge().write(frame.rgba, path)) throw new Error('Replay file writer is busy');
  await waitForFile('written');
  return { path, width: frame.width, height: frame.height, timestamp: frame.timestamp, fingerprint };
}

export async function disposeReplayFrame(frame: FTStoredFrame): Promise<void> {
  if (!bridge().remove(frame.path)) throw new Error('Replay file writer is busy or the frame has expired');
  await waitForFile('removed');
}
