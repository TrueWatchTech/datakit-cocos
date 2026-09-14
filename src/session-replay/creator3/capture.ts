import { Camera, Director, EditBox, Node, RenderTexture, UITransform, Vec3, director, isValid, native, sys, view } from 'cc';
import type { FTCanvasCapture } from '../core/replay.js';
import type { FTCapturedFrame, FTPrivacyRegion, FTReplayPrivacyMode, FTStoredFrame } from '../core/types.js';
import { frameFingerprint } from '../core/replay.js';
import { persistReplayFrame, disposeReplayFrame } from '../core/replay-file.js';
import { projectPrivacyBounds } from '../core/replay-privacy.js';
import { collectReplayPrivacyNodes } from '../core/replay-privacy-nodes.js';
import { waitForRenderTextureReadback } from './replay-render-cycle.js';

const CAPTURE_CANCELLED = Symbol('Replay capture cancelled');

interface CaptureResources {
  source: any;
  scene: any;
  node: any;
  camera: any;
  texture: any;
  width: number;
  height: number;
  row: Uint8Array;
}

export class FTCreator3CanvasCapture implements FTCanvasCapture {
  private camera: any;
  private privacy = new Map<unknown, FTReplayPrivacyMode>();
  private resources: CaptureResources | undefined;
  private cancelDraw: (() => void) | undefined;
  private capturing = false;

  setCamera(camera: unknown): void {
    if (camera === this.camera) return;
    this.dispose();
    this.camera = camera;
  }

  setPrivacy(node: unknown, mode: FTReplayPrivacyMode): void {
    if (mode === 'unmask') this.privacy.delete(node);
    else this.privacy.set(node, mode);
  }

  getViewportSize(): { width: number; height: number } | undefined {
    const visible = view.getVisibleSizeInPixel?.() || view.getVisibleSize();
    return visible ? { width: visible.width, height: visible.height } : undefined;
  }

  async capture(maxImageDimension: number): Promise<FTCapturedFrame | undefined> {
    if (this.capturing) return undefined;
    const scene = director.getScene();
    const camera = this.camera || scene?.getComponentsInChildren(Camera).find((candidate: any) =>
      candidate !== this.resources?.camera && isValid(candidate, true) && candidate.enabledInHierarchy);
    if (!camera || !isValid(camera, true) || !camera.enabledInHierarchy || camera.node.scene !== scene) {
      this.dispose();
      return undefined;
    }
    const visible = this.getViewportSize();
    if (!visible) return undefined;
    const scale = Math.min(1, maxImageDimension / Math.max(visible.width, visible.height));
    const width = Math.max(1, Math.round(visible.width * scale));
    const height = Math.max(1, Math.round(visible.height * scale));
    this.capturing = true;
    let resources: CaptureResources | undefined;
    try {
      resources = this.prepareResources(camera, scene, width, height);
      const target = resources;
      await waitForRenderTextureReadback(() => this.completeDrawCycle(target));
      if (!this.isCurrent(target)) throw CAPTURE_CANCELLED;
      // Creator 3.8 native JSB allocates the result and ignores the optional
      // caller buffer. Do not allocate another full-size buffer alongside it.
      const pixels = target.texture.readPixels(0, 0, width, height);
      if (!pixels) return undefined;
      // Project through the offscreen camera, whose viewport matches the image.
      const privacyRegions = this.collectPrivacyRegions(target.camera, width, height);
      // Metal returns top-down pixels on iOS. Other native targets need row reversal.
      if (sys.os !== sys.OS?.IOS) flipRows(pixels, width, height, target.row);
      return { rgba: pixels, width, height, timestamp: Date.now(), privacyRegions };
    } catch (error) {
      this.dispose();
      if (error === CAPTURE_CANCELLED) return undefined;
      throw error;
    } finally {
      if (resources && isValid(resources.camera, true)) resources.camera.enabled = false;
      this.capturing = false;
    }
  }

  /** Releases reusable GPU resources and settles a capture even if drawing stops. */
  dispose(): void {
    this.cancelDraw?.();
    const target = this.resources;
    this.resources = undefined;
    if (!target) return;
    if (isValid(target.camera, true)) {
      target.camera.enabled = false;
      target.camera.targetTexture = null;
    }
    if (isValid(target.node, true)) {
      target.node.active = false;
      target.node.destroy();
    }
    target.texture.destroy();
  }

  private prepareResources(source: any, scene: any, width: number, height: number): CaptureResources {
    const current = this.resources;
    // A camera that preserves its framebuffer must not accumulate previous
    // replay snapshots in a reused target (for example, moving overlay UI).
    const clearsTarget = (source.clearFlags & Camera.ClearFlag.SOLID_COLOR) === Camera.ClearFlag.SOLID_COLOR;
    if (current && this.isCurrent(current) && current.source === source
      && current.width === width && current.height === height) {
      // Native GLES3 repeated readback of one target can read the screen FBO
      // instead. Keep the isolated camera, but use a fresh target outside iOS;
      // Metal reuse is covered by native screenshot regression checks.
      if (sys.os !== sys.OS?.IOS || !clearsTarget || !sameViewport(source.rect, current.camera.rect)) {
        const texture = new RenderTexture();
        try {
          texture.reset({ width, height });
          current.camera.targetTexture = texture;
        } catch (error) {
          texture.destroy();
          throw error;
        }
        current.texture.destroy();
        current.texture = texture;
      }
      return current;
    }
    this.dispose();
    const texture = new RenderTexture();
    const node = new Node('FTSessionReplayCamera');
    try {
      texture.reset({ width, height });
      // Create disabled and attach only after assigning the offscreen target.
      // An identity child follows the source pose without touching Canvas or
      // changing the business camera's target, projection, or resize listeners.
      node.active = false;
      const camera = node.addComponent(Camera);
      camera.enabled = false;
      camera.targetTexture = texture;
      node.parent = source.node;
      node.active = true;
      this.resources = {
        source, scene, node, camera, texture, width, height,
        row: new Uint8Array(width * 4),
      };
      return this.resources;
    } catch (error) {
      node.destroy();
      texture.destroy();
      throw error;
    }
  }

  private isCurrent(target: CaptureResources): boolean {
    return this.resources === target && director.getScene() === target.scene
      && isValid(target.source, true) && isValid(target.camera, true)
      && isValid(target.node, true) && target.source.enabledInHierarchy
      && target.source.node.scene === target.scene;
  }

  private completeDrawCycle(target: CaptureResources): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: unknown) => {
        director.off(Director.EVENT_BEFORE_DRAW, before);
        director.off(Director.EVENT_AFTER_DRAW, after);
        if (this.cancelDraw === cancel) this.cancelDraw = undefined;
        if (error !== undefined) reject(error);
        else resolve();
      };
      const cancel = () => finish(CAPTURE_CANCELLED);
      const after = () => finish();
      const before = () => {
        try {
          if (!this.isCurrent(target)) { cancel(); return; }
          syncCamera(target.source, target.camera);
          target.camera.enabled = true;
          director.once(Director.EVENT_AFTER_DRAW, after);
        } catch (error) { finish(error); }
      };
      if (!this.isCurrent(target)) { cancel(); return; }
      this.cancelDraw = cancel;
      // Synchronize inside BEFORE_DRAW, before the render graph is prepared,
      // so camera movement and projection changes match this rendered frame.
      director.once(Director.EVENT_BEFORE_DRAW, before);
    });
  }

  async persist(frame: FTCapturedFrame, fingerprint = frameFingerprint(frame.rgba)): Promise<FTStoredFrame> {
    return persistReplayFrame(frame, fingerprint, native.fileUtils.getWritablePath());
  }

  disposeStoredFrame(frame: FTStoredFrame): Promise<void> {
    return disposeReplayFrame(frame);
  }

  private collectPrivacyRegions(
    camera: any,
    width: number,
    height: number,
  ): FTPrivacyRegion[] {
    const scene = director.getScene();
    const nodes = collectReplayPrivacyNodes(
      this.privacy,
      // The engine's string lookup cannot express the editor script's custom getter.
      (scene?.getComponentsInChildren('ReplayPrivacy') || []) as unknown as Parameters<typeof collectReplayPrivacyNodes>[1],
      scene?.getComponentsInChildren(EditBox) || [],
    );
    const regions: FTPrivacyRegion[] = [];
    nodes.forEach((mode, node: any) => {
      const bounds = node?.getComponent?.(UITransform)?.getBoundingBoxToWorld?.();
      if (!bounds) return;
      const worldZ = node.worldPosition?.z || 0;
      const projected = projectPrivacyBounds(
        bounds,
        width,
        height,
        width,
        height,
        (x, y) => camera.worldToScreen?.(new Vec3(x, y, worldZ)),
      );
      if (!projected) throw new Error('Unable to project Replay privacy bounds');
      regions.push({ ...projected, mode: mode === 'hide' ? 'hide' : 'mask' });
    });
    return regions;
  }
}

function syncCamera(source: any, target: any): void {
  // Set fovAxis before fov: Creator adjusts fov when the axis changes.
  for (const key of [
    'projection', 'fovAxis', 'fov', 'orthoHeight', 'near', 'far',
    'visibility', 'priority', 'clearFlags', 'clearColor', 'clearDepth', 'clearStencil',
    'aperture', 'shutter', 'iso', 'usePostProcess', 'postProcess',
  ]) {
    if (source[key] !== undefined) target[key] = source[key];
  }
  target.rect = source.rect.clone();
}

function sameViewport(left: any, right: any): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function flipRows(bytes: Uint8Array, width: number, height: number, swap: Uint8Array): void {
  const rowSize = width * 4;
  for (let top = 0, bottom = height - 1; top < bottom; top += 1, bottom -= 1) {
    const topOffset = top * rowSize;
    const bottomOffset = bottom * rowSize;
    swap.set(bytes.subarray(topOffset, topOffset + rowSize));
    bytes.copyWithin(topOffset, bottomOffset, bottomOffset + rowSize);
    bytes.set(swap, bottomOffset);
  }
}
