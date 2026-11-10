/// <reference path="../src/creator2/shims.d.ts" />

import { afterEach, describe, expect, it, vi } from 'vitest';
import { FTCreator2CanvasCapture } from '../src/session-replay/creator2/capture';

const originalCC = (globalThis as { cc?: unknown }).cc;
afterEach(() => {
  if (originalCC === undefined) delete (globalThis as { cc?: unknown }).cc;
  else (globalThis as { cc?: unknown }).cc = originalCC;
});

function nativeScene(options: { packed?: boolean; nativeExtension?: boolean; version?: string; incomplete?: boolean; readError?: boolean; initError?: boolean; nested?: boolean; rgba?: number[] } = {}) {
  const events: string[] = [];
  const previousFramebuffer = options.nested ? { name: 'business-render-target' } : null;
  let bound: any = previousFramebuffer;
  let cached: any = previousFramebuffer;
  let destroyed = 0;
  let depthStencil: any;
  let captureFramebuffer: any;
  const previousTexture = options.nested ? { _framebuffer: previousFramebuffer } : null;
  const camera = { targetTexture: previousTexture, clearFlags: 6, beforeDraw: vi.fn(), render: vi.fn(() => {
    expect(camera.targetTexture).toBeInstanceOf(RenderTexture);
    setFrameBuffer((camera.targetTexture as unknown as RenderTexture)._framebuffer);
  }) };
  const setFrameBuffer = vi.fn((framebuffer: any) => {
    if (cached === framebuffer) return;
    cached = bound = framebuffer;
    events.push(framebuffer === previousFramebuffer ? 'restore' : 'bind-capture');
  });
  class RenderBuffer {
    constructor(_device: unknown, public format: number) {
      // The native API must receive a sized internal format, not DEPTH_STENCIL.
      if (format !== 0x88f0) throw new Error('GL_INVALID_ENUM');
      depthStencil = this;
    }
  }
  class FrameBuffer {
    constructor(_device: unknown, _width: number, _height: number, public attachments: any) {
      captureFramebuffer = this;
    }
    destroy(): void {
      if (bound === this) throw new Error('destroyed a bound framebuffer');
      events.push('destroy-framebuffer');
    }
  }
  class RenderTexture {
    _texture = {};
    _framebuffer: any;
    _depthStencilBuffer: any;
    initWithSize(_width: number, _height: number, format?: number): void {
      expect(format).toBeUndefined();
      if (options.initError) throw new Error('allocation failed');
      this._framebuffer = { destroy: () => events.push('destroy-color-only') };
    }
    readPixels(): never { throw new Error('legacy WebGL readback must not run'); }
    destroy(): void {
      destroyed++;
      this._framebuffer?.destroy();
    }
  }
  const gl = {
    VERSION: 0x1f02, FRAMEBUFFER: 0x8d40, FRAMEBUFFER_COMPLETE: 0x8cd5,
    RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    getParameter: vi.fn(() => { events.push('drain-jsb'); return options.version || 'OpenGL ES 2.0'; }),
    getExtension: vi.fn((name: string) => options.packed === false
      || (options.nativeExtension && name !== 'GL_OES_packed_depth_stencil') ? null : {}),
    checkFramebufferStatus: vi.fn(() => {
      const a = bound?.attachments;
      return !options.incomplete && a?.colors?.length === 1 && a.depth === depthStencil && a.stencil === depthStencil
        ? 0x8cd5 : 0x8cd6;
    }),
    readPixels: vi.fn((_x: number, _y: number, _w: number, _h: number, _format: number, _type: number, pixels: Uint8Array) => {
      if (options.readError) throw new Error('native readback failed');
      if (bound !== captureFramebuffer) throw new Error('wrong framebuffer');
      pixels.set(options.rgba || [1, 2, 3, 255, 4, 5, 6, 255]);
      events.push('read');
    }),
  };
  const gfx = { RB_FMT_D24S8: 0x84f9, RenderBuffer, FrameBuffer };
  const once = vi.fn((_event: string, callback: () => void) => {
    expect(camera.targetTexture).toBeInstanceOf(RenderTexture);
    setFrameBuffer((camera.targetTexture as unknown as RenderTexture)._framebuffer);
    callback();
  });
  (globalThis as { cc?: unknown }).cc = {
    sys: { isNative: true }, gfx, renderer: { device: { setFrameBuffer } }, game: { _renderContext: gl },
    Camera: { ClearFlags: { COLOR: 1 } }, Director: { EVENT_AFTER_DRAW: 'after-draw' },
    RenderTexture, EditBox: class {}, view: { getScaleX: () => 1, getScaleY: () => 1, getViewportRect: () => ({ x: 0, y: 0 }), getCanvasSize: () => ({ width: 1, height: 2 }) },
    director: { getScene: () => ({ getComponentInChildren: () => camera, getComponentsInChildren: () => [] }), once },
  };
  return { gl, gfx, camera, previousTexture, previousFramebuffer, once, events,
    get bound() { return bound; }, get destroyed() { return destroyed; },
    get attachments() { return captureFramebuffer?.attachments; } };
}

describe('Creator 2 native replay framebuffer compatibility', () => {
  it('restores the display camera before returning without redirecting a scheduled screen frame', async () => {
    const scene = nativeScene();
    const pending = new FTCreator2CanvasCapture().capture(2);
    expect(scene.camera.render).toHaveBeenCalledOnce();
    expect(scene.once).not.toHaveBeenCalled();
    expect(scene.camera.targetTexture).toBe(scene.previousTexture);
    expect(scene.bound).toBe(scene.previousFramebuffer);
    await expect(pending).resolves.toBeDefined();
  });

  it('preserves composited screen colors when translucent draws leave fractional framebuffer alpha', async () => {
    nativeScene({ rgba: [140, 146, 159, 191, 12, 18, 34, 0] });
    const frame = await new FTCreator2CanvasCapture().capture(2);
    expect([...frame!.rgba]).toEqual([12, 18, 34, 255, 140, 146, 159, 255]);
  });

  it.each([false, true])('preserves depth/stencil and restores the business target before destruction (nested=%s)', async (nested) => {
    const scene = nativeScene({ nested });
    const frame = await new FTCreator2CanvasCapture().capture(2);
    expect([...frame!.rgba]).toEqual([4, 5, 6, 255, 1, 2, 3, 255]);
    expect(scene.attachments.depth).toBe(scene.attachments.stencil);
    expect(scene.attachments.depth.format).toBe(0x88f0);
    expect(scene.gfx.RB_FMT_D24S8).toBe(0x84f9);
    expect(scene.camera.targetTexture).toBe(scene.previousTexture);
    expect(scene.camera.clearFlags).toBe(6);
    expect(scene.bound).toBe(scene.previousFramebuffer);
    expect(scene.events.indexOf('restore', scene.events.indexOf('read'))).toBeLessThan(scene.events.indexOf('destroy-framebuffer'));
    expect(scene.destroyed).toBe(1);
  });

  it('accepts packed depth/stencil from GLES 3 core without an extension', async () => {
    const scene = nativeScene({ version: 'OpenGL ES 3.0', packed: false });
    await expect(new FTCreator2CanvasCapture().capture(2)).resolves.toBeDefined();
    expect(scene.gl.getExtension).not.toHaveBeenCalled();
  });

  it('recognizes the unstripped native GLES 2 extension name', async () => {
    const scene = nativeScene({ nativeExtension: true });
    await expect(new FTCreator2CanvasCapture().capture(2)).resolves.toBeDefined();
    expect(scene.gl.getExtension).toHaveBeenCalledWith('GL_OES_packed_depth_stencil');
  });

  it('rejects unsupported formats before scheduling a draw', async () => {
    const scene = nativeScene({ packed: false });
    await expect(new FTCreator2CanvasCapture().capture(2)).rejects.toThrow('packed depth/stencil');
    expect(scene.once).not.toHaveBeenCalled();
    expect(scene.destroyed).toBe(1);
    expect(scene.camera.targetTexture).toBe(scene.previousTexture);
  });

  it('rejects incomplete targets before attaching them to the camera', async () => {
    const scene = nativeScene({ incomplete: true, nested: true });
    await expect(new FTCreator2CanvasCapture().capture(2)).rejects.toThrow('incomplete');
    expect(scene.once).not.toHaveBeenCalled();
    expect(scene.bound).toBe(scene.previousFramebuffer);
    expect(scene.destroyed).toBe(1);
  });

  it('restores native binding and camera state when readback throws', async () => {
    const scene = nativeScene({ readError: true, nested: true });
    await expect(new FTCreator2CanvasCapture().capture(2)).rejects.toThrow('native readback failed');
    expect(scene.bound).toBe(scene.previousFramebuffer);
    expect(scene.camera.targetTexture).toBe(scene.previousTexture);
    expect(scene.camera.clearFlags).toBe(6);
    expect(scene.destroyed).toBe(1);
  });

  it('destroys a partially initialized texture on allocation failure', async () => {
    const scene = nativeScene({ initError: true });
    await expect(new FTCreator2CanvasCapture().capture(2)).rejects.toThrow('allocation failed');
    expect(scene.destroyed).toBe(1);
    expect(scene.once).not.toHaveBeenCalled();
  });
});
