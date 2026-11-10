import { describe, expect, it } from 'vitest';
import { FTViewErrorDeduplicator } from '../src/core/error-deduplication';

describe('bounded view error identities', () => {
  it('preserves field boundaries and releases failed reservations without removing a later one', () => {
    const errors = new FTViewErrorDeduplicator();
    const first = errors.reserve('A', 'a', 'bc', 'd')!;
    expect(errors.reserve('A', 'ab', 'c', 'd')).toBeDefined();
    expect(errors.reserve('A', 'a', 'bc', 'd')).toBeUndefined();
    first.release();
    const retry = errors.reserve('A', 'a', 'bc', 'd')!;
    first.release(); first.commit(); retry.commit(); retry.release();
    expect(errors.reserve('A', 'a', 'bc', 'd')).toBeUndefined();
  });

  it('suppresses additional unique errors at the per-view cap without forgetting earlier errors', () => {
    const errors = new FTViewErrorDeduplicator(2, 2);
    errors.reserve('A', 'type', 'first', 'stack')!.commit();
    errors.reserve('A', 'type', 'second', 'stack')!.commit();
    expect(errors.reserve('A', 'type', 'third', 'stack')).toBeUndefined();
    expect(errors.reserve('A', 'type', 'first', 'stack')).toBeUndefined();
    expect(errors.reserve('B', 'type', 'first', 'stack')).toBeDefined();
  });

  it('evicts the least recently used settled view but retains queued views', () => {
    const errors = new FTViewErrorDeduplicator(2);
    const pending = errors.reserve('pending', '', 'failed', '')!;
    errors.reserve('old', '', 'failed', '')!.commit();
    errors.reserve('new', '', 'failed', '')!.commit();
    expect(errors.reserve('pending', '', 'failed', '')).toBeUndefined();
    pending.commit();
    expect(errors.reserve('old', '', 'failed', '')).toBeDefined();
    expect(errors.reserve('pending', '', 'failed', '')).toBeUndefined();
  });

  it('bounds retained text and reclaims it after cancellation or settled view eviction', () => {
    const errors = new FTViewErrorDeduplicator(2, 128, 80);
    const pending = errors.reserve('A', '', 'a'.repeat(20), '')!;
    expect(pending).toBeDefined();
    expect(errors.reserve('B', '', 'b'.repeat(20), '')).toBeUndefined();
    pending.release();
    errors.reserve('B', '', 'b'.repeat(20), '')!.commit();
    expect(errors.reserve('B', '', 'c'.repeat(20), '')).toBeUndefined();
    expect(errors.reserve('C', '', 'c'.repeat(20), '')).toBeDefined();
    expect(errors.reserve('D', '', 'd'.repeat(100), '')).toBeUndefined();
  });

  it('does not evict any view with undelivered errors to admit another view', () => {
    const errors = new FTViewErrorDeduplicator(1);
    const pending = errors.reserve('A', '', 'failed', '')!;
    expect(errors.reserve('B', '', 'failed', '')).toBeUndefined();
    pending.commit();
    expect(errors.reserve('B', '', 'failed', '')).toBeDefined();
  });
});
