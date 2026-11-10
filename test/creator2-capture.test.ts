/// <reference path="../src/creator2/shims.d.ts" />

import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTCreator2CanvasCapture } from '../src/session-replay/creator2/capture';
import { flipRgbaRows } from '../src/session-replay/core/replay-pixels';

const originalCC = (globalThis as { cc?: unknown }).cc;

afterEach(() => {
  vi.useRealTimers();
  if (originalCC === undefined) delete (globalThis as { cc?: unknown }).cc;
  else (globalThis as { cc?: unknown }).cc = originalCC;
});

describe('Creator 2 replay capture', () => {
  it('defers processing until the tick after the display draw', async () => {
    vi.useFakeTimers();
    let afterDraw: (() => void) | undefined;
    const off = vi.fn();
    (globalThis as { cc?: unknown }).cc = {
      Director: { EVENT_AFTER_DRAW: 'after-draw' },
      director: { once: (_event: string, callback: () => void) => { afterDraw = callback; }, off },
    };
    const capture = new FTCreator2CanvasCapture();
    let completed = false;
    const pending = capture.deferProcessing().then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(completed).toBe(false);
    afterDraw!();
    await Promise.resolve();
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(completed).toBe(true);
    expect(off).toHaveBeenCalledWith('after-draw', afterDraw);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])('releases a deferred frame on disposal (drawn=%s)', async drawn => {
    vi.useFakeTimers();
    let afterDraw: (() => void) | undefined;
    const off = vi.fn();
    (globalThis as { cc?: unknown }).cc = {
      Director: { EVENT_AFTER_DRAW: 'after-draw' },
      director: { once: (_event: string, callback: () => void) => { afterDraw = callback; }, off },
    };
    const capture = new FTCreator2CanvasCapture();
    const pending = capture.deferProcessing();
    if (drawn) afterDraw!();
    capture.dispose();
    await pending;
    expect(off).toHaveBeenCalledWith('after-draw', afterDraw);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])('keeps full-screen geometry through portrait, landscape and restoration (aligned=%s)', async (aligned) => {
    let canvas = { width: 1206, height: 2622 };
    let design = { width: 960, height: 640 };
    let drawError = false;
    let projectionHeight = 0;
    let observed: { width: number; height: number; panelWidth: number; panelHeight: number } | undefined;
    const scale = () => Math.min(canvas.width / design.width, canvas.height / design.height);
    const camera = {
      targetTexture: undefined as RenderTexture | undefined,
      clearFlags: 6, alignWithScreen: aligned, orthoSize: 123, zoomRatio: 1,
      beforeDraw() {
        // Creator 2.4.9 CCCamera._onAlignWithScreen: attaching a target changes
        // an aligned camera from canvas/scale height to visibleRect.height.
        projectionHeight = this.alignWithScreen
          ? (this.targetTexture ? design.height : canvas.height / scale()) / this.zoomRatio
          : this.orthoSize * 2 / this.zoomRatio;
      },
      render() { this.beforeDraw(); },
    };
    class RenderTexture {
      width = 0; height = 0;
      initWithSize(width: number, height: number): void { this.width = width; this.height = height; }
      readPixels(): Uint8Array {
        if (drawError) throw new Error('read failed');
        observed = { width: this.width, height: this.height,
          panelWidth: design.width * this.height / projectionHeight,
          panelHeight: design.height * this.height / projectionHeight };
        return new Uint8Array(this.width * this.height * 4);
      }
      destroy(): void {}
    }
    (globalThis as { cc?: unknown }).cc = {
      Camera: { ClearFlags: { COLOR: 1 } }, Director: { EVENT_AFTER_DRAW: 'draw' },
      EditBox: class {}, RenderTexture, gfx: { RB_FMT_D24S8: 7 },
      view: { getCanvasSize: () => canvas, getScaleY: scale,
        getVisibleSizeInPixel: () => ({ width: design.width * scale(), height: design.height * scale() }) },
      visibleRect: design,
      director: { getScene: () => ({ getComponentInChildren: () => camera, getComponentsInChildren: () => [] }),
        once: (_event: string, callback: () => void) => { camera.beforeDraw(); callback(); } },
    };
    const capture = new FTCreator2CanvasCapture();
    for (const size of [{ width: 1206, height: 2622 }, { width: 2622, height: 1206 }, { width: 1206, height: 2622 }]) {
      canvas = size;
      if (!aligned) camera.orthoSize = canvas.height / scale() / 2;
      const originalSize = camera.orthoSize;
      const frame = await capture.capture(720);
      const factor = 720 / Math.max(canvas.width, canvas.height);
      expect([frame?.width, frame?.height]).toEqual([Math.round(canvas.width * factor), Math.round(canvas.height * factor)]);
      expect(observed!.panelHeight).toBeCloseTo(design.height * scale() * frame!.height / canvas.height, 5);
      expect(camera.alignWithScreen).toBe(aligned);
      expect(camera.orthoSize).toBe(originalSize);
      expect(camera.targetTexture).toBeUndefined();
    }
    design = { width: 900, height: 640 };
    expect(capture.getViewportSize()).toEqual(canvas);
    drawError = true;
    const originalSize = camera.orthoSize;
    await expect(capture.capture(720)).rejects.toThrow('read failed');
    expect(camera.alignWithScreen).toBe(aligned);
    expect(camera.orthoSize).toBe(originalSize);
    expect(camera.clearFlags).toBe(6);
    expect(camera.targetTexture).toBeUndefined();
  });

  it.each([0, -1, NaN, Infinity])('ignores an unavailable canvas dimension %s', (width) => {
    (globalThis as { cc?: unknown }).cc = { view: { getCanvasSize: () => ({ width, height: 720 }) } };
    expect(new FTCreator2CanvasCapture().getViewportSize()).toBeUndefined();
  });

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
          1, 0, 0, 191, 2, 0, 0, 255,
          3, 0, 0, 255, 4, 0, 0, 255,
        ]);
      }

      destroy(): void {
        destroyed = true;
      }
    }

    const previousTarget = { name: 'screen' };
    const camera = { targetTexture: previousTarget, clearFlags: 2, beforeDraw() {}, render() {
      targetAtDraw = this.targetTexture;
      clearFlagsAtDraw = this.clearFlags;
    } };
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
      view: { getScaleX: () => 1, getScaleY: () => 1, getViewportRect: () => ({ x: 0, y: 0 }), getCanvasSize: () => ({ width: 2, height: 2 }) },
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
      1, 0, 0, 191, 2, 0, 0, 255,
    ]);
  });

  it.each([false, true])('projects privacy bounds through the active camera (3D=%s)', async (is3DNode) => {
    class RenderTexture {
      width = 0; height = 0;
      initWithSize(width: number, height: number): void { this.width = width; this.height = height; }
      readPixels(): Uint8Array { return new Uint8Array(this.width * this.height * 4); }
      destroy(): void {}
    }
    const project = vi.fn((_out: unknown, { x, y, z }: { x: number; y: number; z?: number }, width: number, height: number) => {
      // Native Vec3 conversion rejects a Vec2; the output stays at zero.
      if (is3DNode && typeof z !== 'number') return { x: 0, y: 0, z: 0 };
      return { x: x + width / 2, y: y + height / 2 };
    });
    const camera = {
      targetTexture: undefined,
      clearFlags: 0,
      beforeDraw() {}, render() {},
      node: { is3DNode },
      _camera: { worldToScreen: project },
    };
    const privateNode = {
      getContentSize: () => ({ width: 40, height: 20 }),
      getAnchorPoint: () => ({ x: 0.5, y: 0.5 }),
      convertToWorldSpaceAR: (point: { x: number; y: number; z?: number }) => ({ ...point, z: (point.z ?? 0) + 25 }),
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
      view: { getScaleX: () => 1, getScaleY: () => 1, getViewportRect: () => ({ x: 0, y: 0 }), getCanvasSize: () => ({ width: 200, height: 100 }) },
      visibleRect: { width: 200, height: 100 },
    };
    const capture = new FTCreator2CanvasCapture();
    capture.setPrivacy(privateNode, 'mask');

    const frame = await capture.capture(200);

    expect(frame?.privacyRegions).toEqual([{ x: 80, y: 40, width: 40, height: 20, mode: 'mask' }]);
    expect(project).toHaveBeenCalledWith({ x: 0, y: 0, z: 0 }, { x: -20, y: -10, z: 25 }, 200, 100);

    cc.view.getCanvasSize = () => ({ width: 200, height: 400 });
    const portrait = await capture.capture(400);
    expect(portrait?.privacyRegions).toEqual([{ x: 80, y: 190, width: 40, height: 20, mode: 'mask' }]);

    project.mockImplementation(() => ({ x: 0, y: 0 }));
    await expect(capture.capture(200)).rejects.toThrow(/privacy/i);
    expect(camera.targetTexture).toBeUndefined();
    expect(camera.clearFlags).toBe(0);
  });
});

describe('Creator 2.4.9 JSB perspective privacy', () => {
  it('does not require projection data when there are no privacy regions', () => {
    (globalThis as { cc?: unknown }).cc = {
      director: { getScene: () => ({ getComponentsInChildren: () => [] }) }, EditBox: class {},
    };
    const capture = new FTCreator2CanvasCapture();
    expect((capture as any).collectPrivacyRegions({ ortho: false }, 100, 100)).toEqual([]);
  });

  it('tags unavailable perspective projection at the throw site', () => {
    (globalThis as { cc?: unknown }).cc = {
      director: { getScene: () => ({ getComponentsInChildren: () => [] }) }, EditBox: class {},
    };
    const capture = new FTCreator2CanvasCapture();
    capture.setPrivacy({}, 'mask');
    expect(() => (capture as any).collectPrivacyRegions({ ortho: false }, 100, 100))
      .toThrow('[ft-cocos-sdk-internal] Missing Replay privacy perspective projection');
  });

  it.each([false, true])('projects privacy and fails closed across a translated camera plane (rotated=%s)', rotated => {
    const scene = { getComponentsInChildren: () => [] };
    let depth = 0;
    let crossing = false;
    const node = {
      parent: scene, children: [], getContentSize: () => ({ width: 2, height: 2 }),
      getAnchorPoint: () => ({ x: 0, y: 0 }),
      convertToWorldSpaceAR: (p: any) => rotated
        ? { x: crossing ? 9 + p.x : depth, y: p.y, z: p.x }
        : { x: p.x, y: p.y, z: crossing ? 9 + p.x : depth },
    };
    const camera = { ortho: false,
      node: { getWorldRT: (out: any) => {
        out.m = rotated ? [0,0,-1,0, 0,1,0,0, 1,0,0,0, 10,0,0,1]
          : [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,10,1];
      } },
      _camera: { worldToScreen: (_out: any, point: any) => ({ x: rotated ? point.z : point.x, y: point.y, z: 0 }) },
    };
    (globalThis as { cc?: unknown }).cc = {
      director: { getScene: () => scene }, EditBox: class {},
      mat4: () => ({}), v3: (x: number, y: number, z: number) => ({ x, y, z }),
    };
    const capture = new FTCreator2CanvasCapture();capture.setPrivacy(node, 'mask');
    const collect = () => (capture as any).collectPrivacyRegions(camera, 100, 100);
    const regions = collect();
    expect(regions).toHaveLength(1);
    expect(regions[0].x).toBeCloseTo(0);
    expect(regions[0]).toMatchObject({ y: 98, width: 2, height: 2, mode: 'mask' });
    depth = 20;
    expect(collect()).toEqual([]);
    crossing = true;
    expect(collect).toThrow('crosses the camera plane');
  });
});
