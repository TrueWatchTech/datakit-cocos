import type { FTCanvasCapture } from '../core/replay.js';
import { frameFingerprint } from '../core/replay.js';
import { flipRgbaRows } from '../core/replay-pixels.js';
import { persistReplayFrame, disposeReplayFrame } from '../core/replay-file.js';
import { projectPrivacyBounds } from '../core/replay-privacy.js';
import { collectReplayPrivacyNodes } from '../core/replay-privacy-nodes.js';
import type { FTCapturedFrame, FTPrivacyRegion, FTReplayPrivacyMode, FTStoredFrame } from '../core/types.js';

export class FTCreator2CanvasCapture implements FTCanvasCapture {
  private camera: any;
  private privacy = new Map<unknown, FTReplayPrivacyMode>();

  setCamera(camera: unknown): void {
    this.camera = camera;
  }

  setPrivacy(node: unknown, mode: FTReplayPrivacyMode): void {
    if (mode === 'unmask') this.privacy.delete(node);
    else this.privacy.set(node, mode);
  }

  getViewportSize(): { width: number; height: number } | undefined {
    const visible = cc.view.getVisibleSizeInPixel?.() || cc.view.getVisibleSize();
    return visible ? { width: visible.width, height: visible.height } : undefined;
  }

  async capture(maxImageDimension: number): Promise<FTCapturedFrame | undefined> {
    const scene = cc.director.getScene();
    const camera = this.camera || scene?.getComponentInChildren?.(cc.Camera);
    if (!camera) return undefined;
    const visible = this.getViewportSize();
    if (!visible) return undefined;
    const scale = Math.min(1, maxImageDimension / Math.max(visible.width, visible.height));
    const width = Math.max(1, Math.round(visible.width * scale));
    const height = Math.max(1, Math.round(visible.height * scale));
    const texture = new cc.RenderTexture();
    texture.initWithSize(width, height, cc.gfx?.RB_FMT_D24S8);
    const previous = camera.targetTexture;
    const previousClearFlags = camera.clearFlags;
    let pixels: Uint8Array | undefined;
    let privacyRegions: FTPrivacyRegion[] = [];
    try {
      // Creator 2 cameras clear only depth and stencil by default. A fresh
      // RenderTexture can therefore expose stale GPU color data anywhere the
      // scene does not draw, which appears as overlapping strips in replay.
      camera.clearFlags = previousClearFlags | cc.Camera.ClearFlags.COLOR;
      camera.targetTexture = texture;
      await new Promise<void>((resolve) => cc.director.once(cc.Director.EVENT_AFTER_DRAW, resolve));
      pixels = texture.readPixels();
      if (pixels) privacyRegions = this.collectPrivacyRegions(camera, width, height, visible.width, visible.height);
    } finally {
      camera.targetTexture = previous;
      camera.clearFlags = previousClearFlags;
      texture.destroy();
    }
    if (!pixels) return undefined;
    // Creator 2 native rendering uses OpenGL, including on iOS. RenderTexture
    // pixels therefore use a bottom-left origin and must be normalized before
    // PNG encoding and top-left-based privacy-region masking.
    flipRgbaRows(pixels, width, height);
    return {
      rgba: pixels,
      width,
      height,
      timestamp: Date.now(),
      privacyRegions,
    };
  }

  async persist(frame: FTCapturedFrame, fingerprint = frameFingerprint(frame.rgba)): Promise<FTStoredFrame> {
    return persistReplayFrame(frame, fingerprint, jsb.fileUtils.getWritablePath());
  }

  disposeStoredFrame(frame: FTStoredFrame): Promise<void> {
    return disposeReplayFrame(frame);
  }

  private collectPrivacyRegions(
    camera: any,
    width: number,
    height: number,
    sourceWidth: number,
    sourceHeight: number,
  ): FTPrivacyRegion[] {
    const scene = cc.director.getScene();
    const nodes = collectReplayPrivacyNodes(
      this.privacy,
      scene?.getComponentsInChildren?.('ReplayPrivacy') || [],
      scene?.getComponentsInChildren?.(cc.EditBox) || [],
    );
    const screenWidth = cc.visibleRect?.width || sourceWidth;
    const screenHeight = cc.visibleRect?.height || sourceHeight;
    const regions: FTPrivacyRegion[] = [];
    nodes.forEach((mode, node: any) => {
      const bounds = node?.getBoundingBoxToWorld?.();
      if (!bounds) return;
      const worldZ = node.getWorldPosition?.(cc.v3(0, 0, 0)).z ?? 0;
      const projected = projectPrivacyBounds(
        bounds,
        width,
        height,
        screenWidth,
        screenHeight,
        (x, y) => camera.getWorldToScreenPoint?.(cc.v3(x, y, worldZ)),
      );
      if (!projected) throw new Error('Unable to project Replay privacy bounds');
      regions.push({ ...projected, mode: mode === 'hide' ? 'hide' : 'mask' });
    });
    return regions;
  }
}
