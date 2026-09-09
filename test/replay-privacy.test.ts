import { describe, expect, it } from 'vitest';
import { projectPrivacyBounds } from '../src/core/replay-privacy';

describe('Replay privacy projection', () => {
  it('projects centered world coordinates into a top-left-origin Replay frame', () => {
    const region = projectPrivacyBounds(
      { x: 100, y: 50, width: 200, height: 100 },
      720,
      405,
      1920,
      1080,
      (x, y) => ({ x: 960 + x * 1.5, y: 540 + y * 1.5 }),
    );

    expect(region).toEqual({
      x: 416.25,
      y: 118.125,
      width: 112.5,
      height: 56.25,
    });
  });

  it('uses all projected corners so rotated bounds remain fully covered', () => {
    const region = projectPrivacyBounds(
      { x: 0, y: 0, width: 10, height: 20 },
      100,
      100,
      100,
      100,
      (x, y) => ({ x: 50 + x - y, y: 20 + x + y }),
    );

    expect(region).toEqual({ x: 30, y: 50, width: 30, height: 30 });
  });

  it.each([undefined, { x: NaN, y: 0 }, { x: 0, y: 0 }])('rejects invalid or zero-area projection %s', (point) => {
    expect(projectPrivacyBounds(
      { x: 0, y: 0, width: 10, height: 10 },
      100,
      100,
      100,
      100,
      () => point,
    )).toBeUndefined();
  });
});
