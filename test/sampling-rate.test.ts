import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTLogger, FTRUM, FTTrace } from '../src/core/modules';
import type { FTNativeTransport } from '../src/core/transport';
import { FTSessionReplay, type FTCanvasCapture } from '../src/session-replay/core/replay';

class RecordingTransport implements FTNativeTransport {
  readonly platform = 'android' as const;
  readonly calls: Array<{ method: string; payload: unknown }> = [];

  invoke<T>(method: string, payload?: unknown): T | undefined {
    this.calls.push({ method, payload });
    return undefined;
  }

  payload(method: string): Record<string, unknown> {
    const call = this.calls.find(candidate => candidate.method === method);
    if (!call) throw new Error(`Missing ${method} bridge call`);
    return call.payload as Record<string, unknown>;
  }
}

class EmptyCapture implements FTCanvasCapture {
  async capture() { return undefined; }
  async persist(): Promise<never> { throw new Error('No frame'); }
  disposeStoredFrame(): void {}
  setPrivacy(): void {}
}

afterEach(() => vi.useRealTimers());

describe('percentage sampling configuration', () => {
  it.each([0, 0.1, 1, 20, 99.9, 100])(
    'accepts sessionSamplingRate=%s as a percentage',
    (sessionSamplingRate) => {
      const transport = new RecordingTransport();
      new FTRUM(transport).start({ androidAppId: 'app', sessionSamplingRate });

      expect(transport.payload('rum.configure')).toMatchObject({ sessionSamplingRate });
    },
  );

  it('forwards all supported percentage fields without changing their units', () => {
    vi.useFakeTimers();
    const transport = new RecordingTransport();
    new FTRUM(transport).start({
      androidAppId: 'app',
      sessionSamplingRate: 0,
      sessionOnErrorSamplingRate: 0.1,
    });
    new FTLogger(transport).start({ logSamplingRate: 1 });
    new FTTrace(transport).start({ traceSamplingRate: 99.9 });
    const replay = new FTSessionReplay(transport, new EmptyCapture());
    replay.start({
      sessionReplaySamplingRate: 20,
      sessionReplayOnErrorSamplingRate: 100,
    });

    expect(transport.payload('rum.configure')).toEqual({
      androidAppId: 'app',
      sessionSamplingRate: 0,
      sessionOnErrorSamplingRate: 0.1,
    });
    expect(transport.payload('logger.configure')).toEqual({ logSamplingRate: 1 });
    expect(transport.payload('trace.configure')).toEqual({ traceSamplingRate: 99.9 });
    expect(transport.payload('replay.configure')).toEqual({
      sessionReplaySamplingRate: 20,
      sessionReplayOnErrorSamplingRate: 100,
    });

    replay.stop();
  });

  it('prefers explicit percentage fields while preserving legacy 0..1 fields', () => {
    vi.useFakeTimers();
    const transport = new RecordingTransport();
    new FTRUM(transport).start({
      androidAppId: 'app',
      sessionSamplingRate: 0,
      sampleRate: 1,
      sessionOnErrorSamplingRate: 20,
      sessionOnErrorSampleRate: 0.5,
    });
    new FTLogger(transport).start({ logSamplingRate: 25, sampleRate: 0.5 });
    new FTTrace(transport).start({ sampleRate: 0.25 });
    const replay = new FTSessionReplay(transport, new EmptyCapture());
    replay.start({
      sessionReplaySamplingRate: 30,
      sampleRate: 0.3,
      sessionReplayOnErrorSamplingRate: 40,
      sessionOnErrorSampleRate: 0.4,
    });

    expect(transport.payload('rum.configure')).toEqual({
      androidAppId: 'app',
      sessionSamplingRate: 0,
      sessionOnErrorSamplingRate: 20,
    });
    expect(transport.payload('logger.configure')).toEqual({ logSamplingRate: 25 });
    expect(transport.payload('trace.configure')).toEqual({ sampleRate: 0.25 });
    expect(transport.payload('replay.configure')).toEqual({
      sessionReplaySamplingRate: 30,
      sessionReplayOnErrorSamplingRate: 40,
    });

    replay.stop();
  });

  it.each([NaN, Infinity, -0.1, 100.1])('rejects invalid percentage %s', (invalid) => {
    expect(() => new FTRUM(new RecordingTransport()).start({
      androidAppId: 'app',
      sessionSamplingRate: invalid,
    })).toThrow(/sessionSamplingRate.*0 and 100/);
    expect(() => new FTRUM(new RecordingTransport()).start({
      androidAppId: 'app',
      sessionOnErrorSamplingRate: invalid,
    })).toThrow(/sessionOnErrorSamplingRate.*0 and 100/);
    expect(() => new FTLogger(new RecordingTransport()).start({
      logSamplingRate: invalid,
    })).toThrow(/logSamplingRate.*0 and 100/);
    expect(() => new FTTrace(new RecordingTransport()).start({
      traceSamplingRate: invalid,
    })).toThrow(/traceSamplingRate.*0 and 100/);
    expect(() => new FTSessionReplay(new RecordingTransport(), new EmptyCapture()).start({
      sessionReplaySamplingRate: invalid,
    })).toThrow(/sessionReplaySamplingRate.*0 and 100/);
    expect(() => new FTSessionReplay(new RecordingTransport(), new EmptyCapture()).start({
      sessionReplayOnErrorSamplingRate: invalid,
    })).toThrow(/sessionReplayOnErrorSamplingRate.*0 and 100/);
  });

  it('keeps rejecting invalid legacy ratios when no percentage field is set', () => {
    expect(() => new FTRUM(new RecordingTransport()).start({
      androidAppId: 'app',
      sampleRate: 1.01,
    })).toThrow(/sampleRate.*0 and 1/);
  });
});

describe('native percentage bridge contract', () => {
  it('uses native Android percentage setters and keeps legacy ratio setters', () => {
    const base = readFileSync(resolve(
      'native/android/src/main/java/com/ft/sdk/cocos/FTCocosBridge.java',
    ), 'utf8');
    const replay = readFileSync(resolve(
      'src/session-replay/native/android/src/main/java/com/ft/sdk/cocos/FTCocosReplayBridge.java',
    ), 'utf8');

    for (const field of [
      'sessionSamplingRate',
      'sessionOnErrorSamplingRate',
      'logSamplingRate',
      'traceSamplingRate',
    ]) expect(base).toContain(`config.set${field.charAt(0).toUpperCase()}${field.slice(1)}(samplingPercentage(json, "${field}"))`);
    for (const field of [
      'sessionReplaySamplingRate',
      'sessionReplayOnErrorSamplingRate',
    ]) expect(replay).toContain(`config.set${field.charAt(0).toUpperCase()}${field.slice(1)}(samplingPercentage(json, "${field}"))`);
    expect(base).toContain('samplingPercentage(json');
    expect(replay).toContain('samplingPercentage(json');
    expect(base).toContain('json.has("sampleRate")');
    expect(replay).toContain('json.has("sampleRate")');
  });

  it('uses native iOS floating-point percentage properties and keeps legacy ratio setters', () => {
    const base = readFileSync(resolve('native/ios/FTCocosBridge.m'), 'utf8');
    const replay = readFileSync(resolve(
      'src/session-replay/native/ios/FTCocosReplayBridge.m',
    ), 'utf8');

    for (const field of [
      'sessionSamplingRate',
      'sessionOnErrorSamplingRate',
      'logSamplingRate',
      'traceSamplingRate',
    ]) expect(base).toContain(`config.${field} = [self samplingPercentage:arguments[@"${field}"]`);
    for (const field of [
      'sessionReplaySamplingRate',
      'sessionReplayOnErrorSamplingRate',
    ]) expect(replay).toContain(`config.${field} = [self samplingPercentage:arguments[@"${field}"]`);
    expect(base).toContain('return (float)percentage;');
    expect(replay).toContain('return (float)percentage;');
    expect(base).toContain('arguments[@"sampleRate"]');
    expect(replay).toContain('arguments[@"sampleRate"]');
  });
});
