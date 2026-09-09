/// <reference path="../src/creator2/shims.d.ts" />

import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTCreator2CanvasCapture } from '../src/creator2/capture';
import { flipRgbaRows } from '../src/core/replay-pixels';

const originalCC = (globalThis as { cc?: unknown }).cc;

afterEach(() => {
  if (originalCC === undefined) delete (globalThis as { cc?: unknown }).cc;
  else (globalThis as { cc?: unknown }).cc = originalCC;
});

describe('Creator 2 replay capture', () => {
  it('normalizes bottom-left RenderTexture pixels to top-left image rows', () => {
    const bottomLeftPixels = new Uint8Array([
      1, 0, 0, 255, 2, 0, 0, 255,
      3, 0, 0, 255, 4, 0, 0, 255,
    ]);

    flipRgbaRows(bottomLeftPixels, 2, 2);

    expect([...bottomLeftPixels]).toEqual([
      3, 0, 0, 255, 4, 0, 0, 255,
      1, 0, 0, 255, 2, 0, 0, 255,
    ]);
  });

  it('clears a fresh RenderTexture color buffer and restores the camera state', async () => {
    let initializedWith: unknown[] | undefined;
    let destroyed = false;
    let targetAtDraw: unknown;
    let clearFlagsAtDraw: number | undefined;

    class RenderTexture {
      initWithSize(...args: unknown[]): void {
        initializedWith = args;
      }

      readPixels(): Uint8Array {
        return new Uint8Array([
          1, 0, 0, 255, 2, 0, 0, 255,
          3, 0, 0, 255, 4, 0, 0, 255,
        ]);
      }

      destroy(): void {
        destroyed = true;
      }
    }

    const previousTarget = { name: 'screen' };
    const camera = { targetTexture: previousTarget, clearFlags: 2 };
    (globalThis as { cc?: unknown }).cc = {
      Camera: { ClearFlags: { COLOR: 1 } },
      Director: { EVENT_AFTER_DRAW: 'after-draw' },
      EditBox: class {},
      RenderTexture,
      director: {
        getScene: () => ({
          getComponentInChildren: () => camera,
          getComponentsInChildren: () => [],
        }),
        once: (_event: string, callback: () => void) => {
          targetAtDraw = camera.targetTexture;
          clearFlagsAtDraw = camera.clearFlags;
          callback();
        },
      },
      gfx: { RB_FMT_D24S8: 7 },
      view: { getVisibleSizeInPixel: () => ({ width: 2, height: 2 }) },
    };

    const frame = await new FTCreator2CanvasCapture().capture(2);

    expect(initializedWith).toEqual([2, 2, 7]);
    expect(targetAtDraw).toBeInstanceOf(RenderTexture);
    expect(clearFlagsAtDraw).toBe(3);
    expect(camera.targetTexture).toBe(previousTarget);
    expect(camera.clearFlags).toBe(2);
    expect(destroyed).toBe(true);
    expect([...frame!.rgba]).toEqual([
      3, 0, 0, 255, 4, 0, 0, 255,
      1, 0, 0, 255, 2, 0, 0, 255,
    ]);
  });

  it.each([false, true])('projects privacy bounds through the active camera (3D=%s)', async (is3DNode) => {
    class RenderTexture {
      initWithSize(): void {}
      readPixels(): Uint8Array { return new Uint8Array(200 * 100 * 4); }
      destroy(): void {}
    }
    const project = vi.fn(({ x, y, z }: { x: number; y: number; z?: number }) => {
      // Native Vec3 conversion rejects a Vec2; the output stays at zero.
      if (is3DNode && typeof z !== 'number') return { x: 0, y: 0, z: 0 };
      return { x: x + 100, y: y + 50 };
    });
    const camera = {
      targetTexture: undefined,
      clearFlags: 0,
      node: { is3DNode },
      getWorldToScreenPoint: project,
    };
    const privateNode = {
      getBoundingBoxToWorld: () => ({ x: -20, y: -10, width: 40, height: 20 }),
      // Creator 2 requires a caller-provided output vector.
      getWorldPosition: (out: { x: number; y: number; z: number }) => {
        out.x = 0;
        out.y = 0;
        out.z = 25;
        return out;
      },
    };
    (globalThis as { cc?: unknown }).cc = {
      Camera: { ClearFlags: { COLOR: 1 } },
      Director: { EVENT_AFTER_DRAW: 'after-draw' },
      EditBox: class {},
      RenderTexture,
      director: {
        getScene: () => ({
          getComponentInChildren: () => camera,
          getComponentsInChildren: () => [],
        }),
        once: (_event: string, callback: () => void) => callback(),
      },
      gfx: { RB_FMT_D24S8: 7 },
      v2: (x: number, y: number) => ({ x, y }),
      v3: (x: number, y: number, z: number) => ({ x, y, z }),
      view: { getVisibleSizeInPixel: () => ({ width: 200, height: 100 }) },
      visibleRect: { width: 200, height: 100 },
    };
    const capture = new FTCreator2CanvasCapture();
    capture.setPrivacy(privateNode, 'mask');

    const frame = await capture.capture(200);

    expect(frame?.privacyRegions).toEqual([{ x: 80, y: 40, width: 40, height: 20, mode: 'mask' }]);
    if (is3DNode) expect(project).toHaveBeenCalledWith({ x: -20, y: -10, z: 25 });

    project.mockImplementation(() => ({ x: 0, y: 0 }));
    await expect(capture.capture(200)).rejects.toThrow(/privacy/i);
    expect(camera.targetTexture).toBeUndefined();
    expect(camera.clearFlags).toBe(0);
  });
});
