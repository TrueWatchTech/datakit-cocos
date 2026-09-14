import type { FTValue } from './types.js';

export interface FTTransportResponse<T = FTValue> {
  ok: boolean;
  value?: T;
  error?: string;
}

export interface FTNativeTransport {
  readonly platform: 'android' | 'ios' | 'unsupported';
  /**
   * Calls a native bridge operation synchronously and decodes its response.
   *
   * @param method - Native bridge operation name, such as `rum.startView`.
   * @param payload - Optional JSON-serializable arguments for the operation.
   * @returns The decoded result, or undefined when no value is returned or the
   * platform is unsupported.
   * @throws If serialization, the bridge call, or response decoding fails, or
   * the native bridge reports an error.
   */
  invoke<T = FTValue>(method: string, payload?: unknown): T | undefined;
  /**
   * Calls a native operation through an optional asynchronous transport.
   * Check that this method exists before calling it; supported operations depend
   * on the transport implementation.
   *
   * @param method - Native bridge operation supported by the async transport.
   * @param payload - Optional JSON-serializable arguments for the operation.
   * @returns A promise that resolves to the decoded result, or to undefined when
   * no value is returned. Rejects if the operation or response decoding fails.
   */
  invokeAsync?<T = FTValue>(method: string, payload?: unknown): Promise<T | undefined>;
}

export class FTNoopTransport implements FTNativeTransport {
  readonly platform = 'unsupported' as const;

  invoke<T = FTValue>(_method: string, _payload?: unknown): T | undefined {
    return undefined;
  }
}

export function parseTransportResponse<T>(raw: unknown): T | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;

  let response: unknown = raw;
  if (typeof raw === 'string') {
    response = JSON.parse(raw);
  }
  if (!isResponse(response)) {
    return response as T;
  }
  if (!response.ok) {
    throw new Error(response.error || 'Native bridge call failed');
  }
  return response.value as T | undefined;
}

function isResponse(value: unknown): value is FTTransportResponse {
  return typeof value === 'object' && value !== null && 'ok' in value;
}
