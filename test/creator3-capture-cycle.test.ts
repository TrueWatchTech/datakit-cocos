import { describe, expect, it } from 'vitest';
import { waitForRenderTextureReadback } from '../src/creator3/replay-render-cycle';

describe('Creator 3 replay RenderTexture readback', () => {
  it('keeps the target attached for two complete draw cycles', async () => {
    const cycles: number[] = [];

    await waitForRenderTextureReadback(async () => {
      cycles.push(cycles.length + 1);
    });

    expect(cycles).toEqual([1, 2]);
  });
});
