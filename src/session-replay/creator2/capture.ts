import type { FTCanvasCapture } from '../core/replay.js';
import { frameFingerprint } from '../core/replay.js';
import { flipRgbaRows } from '../core/replay-pixels.js';
import { persistReplayFrame, disposeReplayFrame } from '../core/replay-file.js';
import { collectReplayPrivacyNodes } from '../core/replay-privacy-nodes.js';
import { clippedPrivacyBounds } from '../core/replay-privacy-bounds.js';
import { privacyProjectionWeight, projectPrivacyPoints, rendererPrivacyBounds } from '../core/replay-renderer-bounds.js';
import type { PrivacyGeometry } from '../core/replay-renderer-bounds.js';
import type { FTCapturedFrame, FTPrivacyRegion, FTReplayPrivacyMode, FTStoredFrame } from '../core/types.js';
import { createReplayTarget } from './render-target.js';

export class FTCreator2CanvasCapture implements FTCanvasCapture {
  private camera: any;
  private privacy = new Map<unknown, FTReplayPrivacyMode>();
  private finishDeferredProcessing: (() => void) | undefined;

  setCamera(camera: unknown): void {
    this.camera = camera;
  }

  setPrivacy(node: unknown, mode: FTReplayPrivacyMode): void {
    if (mode === 'unmask') this.privacy.delete(node);
    else this.privacy.set(node, mode);
  }

  getViewportSize(): { width: number; height: number } | undefined {
    // The native canvas includes SHOW_ALL's margins; the visible design area
    // can keep the same aspect ratio through a device rotation.
    const size = cc.view.getCanvasSize();
    return size && Number.isFinite(size.width) && Number.isFinite(size.height)
      && size.width > 0 && size.height > 0
      ? { width: size.width, height: size.height } : undefined;
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
    const previous = camera.targetTexture;
    const previousClearFlags = camera.clearFlags;
    const previousAlignment = camera.alignWithScreen;
    const previousOrthoSize = camera.orthoSize;
    const target = createReplayTarget(width, height, previous);
    let pixels: Uint8Array | undefined;
    let privacyRegions: FTPrivacyRegion[] = [];
    try {
      // Creator 2 normally changes the projection to the visible design height
      // when a target texture is attached. Keep the source screen projection,
      // including its perspective-camera position, for the full-window image.
      if (previousAlignment) {
        camera.beforeDraw();
        camera.orthoSize = (previous ? cc.visibleRect.height : visible.height / cc.view.getScaleY()) / 2;
        camera.alignWithScreen = false;
      }
      // Creator 2 cameras clear only depth and stencil by default. A fresh
      // RenderTexture can therefore expose stale GPU color data anywhere the
      // scene does not draw, which appears as overlapping strips in replay.
      camera.clearFlags = previousClearFlags | cc.Camera.ClearFlags.COLOR;
      camera.targetTexture = target.texture;
      // Render an extra offscreen pass synchronously, then restore the source
      // before the display pass. Redirecting its next normal frame instead
      // makes the game visibly skip a screen update at every capture interval.
      camera.render(scene);
      pixels = target.readPixels();
      if (pixels) privacyRegions = this.collectPrivacyRegions(camera, width, height);
    } finally {
      try {
        camera.targetTexture = previous;
        camera.clearFlags = previousClearFlags;
        camera.alignWithScreen = previousAlignment;
        camera.orthoSize = previousOrthoSize;
        camera.beforeDraw();
      } finally {
        target.dispose();
      }
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

  deferProcessing(): Promise<void> {
    this.finishDeferredProcessing?.();
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        cc.director.off(cc.Director.EVENT_AFTER_DRAW, afterDraw);
        if (timer !== undefined) clearTimeout(timer);
        if (this.finishDeferredProcessing === finish) this.finishDeferredProcessing = undefined;
        resolve();
      };
      const afterDraw = () => {
        // Creator 2 runs timers before requestAnimationFrame. Schedule only
        // after this draw so processing cannot extend its presentation time.
        timer = setTimeout(finish, 0);
      };
      this.finishDeferredProcessing = finish;
      cc.director.once(cc.Director.EVENT_AFTER_DRAW, afterDraw);
    });
  }

  dispose(): void {
    this.finishDeferredProcessing?.();
  }

  disposeStoredFrame(frame: FTStoredFrame): Promise<void> {
    return disposeReplayFrame(frame);
  }

  private collectPrivacyRegions(
    camera: any,
    width: number,
    height: number,
  ): FTPrivacyRegion[] {
    const scene = cc.director.getScene();
    const nodes = collectReplayPrivacyNodes(
      this.privacy,
      scene?.getComponentsInChildren?.('ReplayPrivacy') || [],
      scene?.getComponentsInChildren?.(cc.EditBox) || [],
      // Creator 2 Scene supports descendant queries, but not normal node APIs.
      scene,
    );
    const regions: FTPrivacyRegion[] = [];
    const matrix = camera._camera?.worldMatrixToScreen?.(cc.mat4(), cc.mat4(), width, height);
    if (camera.ortho === false && !matrix) throw new Error('Missing Replay privacy perspective projection');
    const geometry: PrivacyGeometry = {
      creator: 2,
      toWorld: (node: any, point) => node.convertToWorldSpaceAR(cc.v3(point.x, point.y, point.z ?? 0)),
      project: (point) => {
        const clipW = privacyProjectionWeight(matrix, point);
        if (clipW !== undefined && clipW <= 0) return { x: 0, y: 0, clipW };
        const projected = camera._camera?.worldToScreen(cc.v3(0, 0, 0), cc.v3(point.x, point.y, point.z ?? 0), width, height);
        if (!projected) throw new Error('Unable to project Replay privacy geometry');
        return { x: projected.x, y: projected.y, clipW };
      },
      nativeParticleBounds: (proxy) => (globalThis as any).__ftCocosReplayFile?.particleBounds?.(proxy),
    };
    const uiBounds = (current: any) => {
      if (!current.convertToWorldSpaceAR || !current.getContentSize) return undefined;
      const size = current.getContentSize(); const anchor = current.getAnchorPoint();
      if (size.width === 0 || size.height === 0) return undefined;
      const x = -size.width * anchor.x; const y = -size.height * anchor.y;
      return projectPrivacyPoints([
        { x, y }, { x: x + size.width, y }, { x, y: y + size.height }, { x: x + size.width, y: y + size.height },
      ].map(point => geometry.toWorld(current, point)), geometry);
    };
    const cache = new Map<any, ReturnType<typeof rendererPrivacyBounds>>();
    const renderer = (current: any) => {
      if (!cache.has(current)) cache.set(current, rendererPrivacyBounds(current, geometry));
      return cache.get(current)!;
    };
    nodes.forEach((mode, node: any) => {
      const bounds = clippedPrivacyBounds(node, {
        ownBounds: (current: any) => {
          const ui = uiBounds(current); const render = renderer(current).clipped;
          if (!ui) return render;
          if (!render) return ui;
          const x = Math.min(ui.x, render.x); const y = Math.min(ui.y, render.y);
          return { x, y, width: Math.max(ui.x + ui.width, render.x + render.width) - x,
            height: Math.max(ui.y + ui.height, render.y + render.height) - y };
        },
        clipBounds: uiBounds,
        unclippedBounds: (current: any) => renderer(current).unclipped,
        clipsChildren: (current: any) => {
          const mask = current.getComponent?.('cc.Mask');
          return !!mask?.enabledInHierarchy && !mask.inverted;
        },
      }, scene);
      if (!bounds) return;
      regions.push({ ...bounds, y: height - bounds.y - bounds.height, mode: mode === 'hide' ? 'hide' : 'mask' });
    });
    return regions;
  }
}
