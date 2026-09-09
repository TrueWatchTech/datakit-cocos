import type { FTValue } from './types.js';

export interface FTTransportResponse<T = FTValue> {
  ok: boolean;
  value?: T;
  error?: string;
}

export interface FTNativeTransport {
  readonly platform: 'android' | 'ios' | 'unsupported';
  invoke<T = FTValue>(method: string, payload?: unknown): T | undefined;
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
