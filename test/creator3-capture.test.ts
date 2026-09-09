/// <reference path="../src/creator3/shims.d.ts" />

import { describe, expect, it, vi } from 'vitest';
import { FTCreator3CanvasCapture } from '../src/creator3/capture';
import { applyPrivacyRegions } from '../src/core/replay';

const state = vi.hoisted(() => ({
  visible: { width: 1920, height: 1080 },
  camera: undefined as any,
  destroyed: false,
}));

vi.mock('cc', () => ({
  Camera: class {},
  UITransform: class {},
  EditBox: class {},
  Vec3: class {
    constructor(public x: number, public y: number, public z: number) {}
  },
  RenderTexture: class {
    width = 0;
    height = 0;
    reset(size: { width: number; height: number }): void { Object.assign(this, size); }
    readPixels(): Uint8Array { return new Uint8Array(this.width * this.height * 4).fill(255); }
    destroy(): void { state.destroyed = true; }
  },
  Director: { EVENT_BEFORE_DRAW: 'before', EVENT_AFTER_DRAW: 'after' },
  director: {
    getScene: () => ({ getComponentInChildren: () => state.camera, getComponentsInChildren: () => [] }),
    once: (_event: string, callback: () => void) => callback(),
  },
  view: { getVisibleSizeInPixel: () => state.visible },
  sys: { os: 'Android', OS: { IOS: 'iOS' } },
  native: {},
}));

function setup(visible: { width: number; height: number }, previous?: { width: number; height: number }) {
  state.visible = visible;
  state.destroyed = false;
  state.camera = {
    targetTexture: previous,
    // Cocos worldToScreen uses the current render window's pixel dimensions.
    // These world coordinates are already in normalized device coordinates.
    worldToScreen({ x, y }: { x: number; y: number }) {
      const size = this.targetTexture || { width: 1920, height: 1080 };
      return { x: (x + 1) * size.width / 2, y: (y + 1) * size.height / 2 };
    },
  };
  const capture = new FTCreator3CanvasCapture();
  capture.setPrivacy({
    worldPosition: { z: 30 },
    getComponent: () => ({ getBoundingBoxToWorld: () => ({ x: 0.2, y: 0.2, width: 0.2, height: 0.2 }) }),
  }, 'mask');
  return capture;
}

describe('Creator 3 privacy capture', () => {
  it.each([
    { name: 'full screen', visible: { width: 1920, height: 1080 }, previous: undefined },
    { name: 'SHOW_ALL letterboxing', visible: { width: 1080, height: 1080 }, previous: undefined },
    { name: 'existing render texture', visible: { width: 1920, height: 1080 }, previous: { width: 960, height: 540 } },
  ])('masks the captured pixels with $name', async ({ visible, previous }) => {
    const capture = setup(visible, previous);
    const frame = (await capture.capture(720))!;
    applyPrivacyRegions(frame.rgba, frame.width, frame.height, frame.privacyRegions!);

    const privateX = Math.floor(frame.width * 0.65);
    const privateY = Math.floor(frame.height * 0.35);
    expect(frame.rgba[(privateY * frame.width + privateX) * 4]).toBe(128);
    expect(frame.rgba[0]).toBe(255);
    expect(state.camera.targetTexture).toBe(previous);
    expect(state.destroyed).toBe(true);
  });

  it.each([undefined, { x: NaN, y: 1 }, { x: 0, y: 0 }])(
    'does not return an unmasked frame when projection fails: %s', async (point) => {
      const previous = { width: 1920, height: 1080 };
      const capture = setup(previous, previous);
      state.camera.worldToScreen = () => point;

      await expect(capture.capture(720)).rejects.toThrow(/privacy/i);
      expect(state.camera.targetTexture).toBe(previous);
      expect(state.destroyed).toBe(true);
    },
  );
});
