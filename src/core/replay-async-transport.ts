import type { FTNativeTransport } from './transport.js';
import { parseTransportResponse } from './transport.js';

/** Polls a single native worker without keeping a synchronous bridge call open. */
export async function invokeReplayAsync<T>(transport: FTNativeTransport, method: string, payload?: unknown): Promise<T | undefined> {
  const job = transport.invoke<string>('replay.beginSaveImage', { method, arguments: payload });
  if (!job) throw new Error('Rebuild the native bridge to enable asynchronous Replay encoding');
  for (;;) {
    await new Promise<void>((resolve) => setTimeout(resolve, 16));
    const result = transport.invoke<{ pending: boolean; response?: string }>('replay.pollSaveImage', { job });
    if (!result) throw new Error('Replay encoding job is unavailable');
    if (!result.pending) return parseTransportResponse<T>(result.response);
  }
}
