import { replayError } from '../core/internal-errors.js';
import { makeRgbaOpaque } from '../core/replay-pixels.js';

const GL_DEPTH24_STENCIL8 = 0x88f0;

export interface FTCreator2ReplayTarget {
  texture: any;
  readPixels(): Uint8Array | undefined;
  dispose(): void;
}

/** Owns the temporary target without changing global gfx constants or GL batching. */
export function createReplayTarget(width: number, height: number, previousTexture: any): FTCreator2ReplayTarget {
  const texture = new cc.RenderTexture();
  let restore = () => {};
  try {
    if (!cc.sys?.isNative) {
      texture.initWithSize(width, height, cc.gfx?.RB_FMT_D24S8);
      return { texture, readPixels: () => texture.readPixels(), dispose: () => texture.destroy() };
    }

    const device = cc.renderer?.device;
    const gfx = cc.gfx;
    const gl = cc.game?._renderContext;
    if (!device?.setFrameBuffer || !gfx?.RenderBuffer || !gfx?.FrameBuffer || !gl) {
      throw replayError('Creator 2 native Replay requires the native gfx framebuffer API');
    }
    const version = String(gl.getParameter(gl.VERSION));
    if (!/OpenGL ES\s+[3-9]\./.test(version)
      && !gl.getExtension('OES_packed_depth_stencil')
      && !gl.getExtension('GL_OES_packed_depth_stencil')) {
      throw replayError('Creator 2 native Replay requires packed depth/stencil support');
    }
    const bind = (framebuffer: any) => {
      // JSB queues WebGL commands, whereas native gfx executes immediately.
      // Drain the queue before changing the binding and its native gfx cache.
      gl.getParameter(gl.VERSION);
      device.setFrameBuffer(framebuffer);
    };
    restore = () => bind(previousTexture?._framebuffer || null);

    texture.initWithSize(width, height);
    const depthStencil = new gfx.RenderBuffer(device, GL_DEPTH24_STENCIL8, width, height);
    const framebuffer = new gfx.FrameBuffer(device, width, height, {
      colors: [texture._texture],
      // Creator 2 native gfx does not attach the combined depthStencil option.
      depth: depthStencil,
      stencil: depthStencil,
    });
    const colorOnlyFramebuffer = texture._framebuffer;
    texture._framebuffer = framebuffer;
    texture._depthStencilBuffer = depthStencil;
    colorOnlyFramebuffer.destroy();

    const checkComplete = () => {
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw replayError('Creator 2 Replay framebuffer is incomplete');
      }
    };
    try {
      bind(framebuffer);
      checkComplete();
    } finally {
      restore();
    }

    return {
      texture,
      readPixels: () => {
        try {
          bind(framebuffer);
          checkComplete();
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          // Replay represents the opaque native screen. RGB is already composited,
          // but JSB can leave fractional framebuffer alpha after translucent UI draws.
          // Native encoders would otherwise unpremultiply it and brighten those pixels.
          makeRgbaOpaque(pixels);
          return pixels;
        } finally {
          restore();
        }
      },
      dispose: () => {
        try { restore(); }
        finally { texture.destroy(); }
      },
    };
  } catch (error) {
    try { restore(); }
    finally { texture.destroy(); }
    throw error;
  }
}
