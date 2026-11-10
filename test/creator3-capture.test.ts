/// <reference path="../src/creator3/shims.d.ts" />

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Camera, Node, UITransform } from 'cc';
import { FTCreator3CanvasCapture } from '../src/session-replay/creator3/capture';
import { applyPrivacyRegions } from '../src/session-replay/core/replay';

const state = vi.hoisted(() => ({
  visible: { width: 1920, height: 1080 }, scene: undefined as any,
  window: undefined as undefined | { width: number; height: number },
  cameras: [] as any[], textures: [] as any[],
  listeners: new Map<string, Set<() => void>>(), os: 'Android',
  project: undefined as undefined | (() => unknown), readError: false,
}));

vi.mock('cc', () => {
  class MockCamera {
    static ClearFlag = { SOLID_COLOR: 7 };
    node: any;
    enabled = true;
    isValid = true;
    targetTexture: any = null;
    projection = 0;
    fovAxis = 0;
    fov = 45;
    orthoHeight = 540;
    near = 1;
    far = 2000;
    visibility = 1 << 25;
    priority = 3;
    clearFlags = 7;
    clearColor = { r: 10, g: 20, b: 30, a: 255 };
    clearDepth = 1;
    clearStencil = 0;
    aperture = 2;
    shutter = 3;
    iso = 4;
    usePostProcess = false;
    postProcess = null;
    rect = { x: 0, y: 0, width: 1, height: 1, clone() { return { ...this }; } };
    get enabledInHierarchy() { return this.enabled && this.node.activeInHierarchy; }
    worldToScreen({ x, y }: { x: number; y: number }) {
      if (state.project) return state.project();
      const size = this.targetTexture || state.visible;
      return { x: (x + 1) * size.width / 2, y: (y + 1) * size.height / 2 };
    }
  }
  return {
    Camera: MockCamera,
    Node: class {
      active = true;
      isValid = true;
      parent: any;
      component: any;
      constructor(public name: string) {}
      get activeInHierarchy(): boolean { return this.active && (this.parent?.activeInHierarchy ?? true); }
      get scene(): any { return this.parent?.scene; }
      addComponent() {
        this.component = new MockCamera();
        this.component.node = this;
        state.cameras.push(this.component);
        return this.component;
      }
      destroy() { this.isValid = false; if (this.component) this.component.isValid = false; }
    },
    UITransform: class {}, EditBox: class {},
    Vec3: class { constructor(public x: number, public y: number, public z: number) {} },
    RenderTexture: class {
      width = 0;
      height = 0;
      destroyed = false;
      constructor() { state.textures.push(this); }
      reset(size: { width: number; height: number }): void { Object.assign(this, size); }
      readPixels(): Uint8Array {
        if (state.readError) throw new Error('GPU read failed');
        // Native JSB always allocates; it ignores a supplied readback buffer.
        const buffer = new Uint8Array(this.width * this.height * 4);
        buffer.fill(255);
        buffer[0] = 12;
        buffer[(this.height - 1) * this.width * 4] = 34;
        return buffer;
      }
      destroy(): void { this.destroyed = true; }
    },
    isValid: (object: any) => !!object && object.isValid !== false,
    Director: { EVENT_BEFORE_DRAW: 'before', EVENT_AFTER_DRAW: 'after' },
    director: {
      getScene: () => state.scene,
      once: (event: string, callback: () => void) => {
        if (!state.listeners.has(event)) state.listeners.set(event, new Set());
        state.listeners.get(event)!.add(callback);
      },
      off: (event: string, callback: () => void) => state.listeners.get(event)?.delete(callback),
    },
    view: { getVisibleSizeInPixel: () => state.visible },
    screen: { get windowSize() { return state.window || state.visible; } },
    sys: { get os() { return state.os; }, OS: { IOS: 'iOS' } }, native: {},
  };
});

function emit(event: string) {
  const listeners = [...state.listeners.get(event) || []];
  state.listeners.get(event)?.clear();
  listeners.forEach(callback => callback());
}
async function draw(assertDuringDraw?: () => void) {
  emit('before');
  assertDuringDraw?.();
  emit('after');
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
const captures: FTCreator3CanvasCapture[] = [];
afterEach(() => { captures.splice(0).forEach(capture => capture.dispose()); });
function setup(visible = { width: 1920, height: 1080 }, previous?: { width: number; height: number }) {
  state.visible = visible;
  state.window = undefined;
  state.cameras = [];
  state.textures = [];
  state.listeners.clear();
  state.os = 'Android';
  state.project = undefined;
  state.readError = false;
  state.scene = {
    activeInHierarchy: true,
    get scene() { return this; },
    getComponentsInChildren: (type: unknown) => type === Camera ? state.cameras : [],
  };
  const sourceNode = new Node('BusinessCamera');
  sourceNode.parent = state.scene;
  const source = sourceNode.addComponent(Camera);
  // Reject even temporary assignments: these redirect the screen and trigger Canvas resizing.
  const targetWrite = vi.fn(() => { throw new Error('Business target was changed'); });
  Object.defineProperty(source, 'targetTexture', { get: () => previous, set: targetWrite });
  const capture = new FTCreator3CanvasCapture();
  captures.push(capture);
  capture.setPrivacy({
    worldPosition: { z: 30 },
    getComponent: (type: unknown) => type === UITransform ? {
      contentSize: { width: 0.2, height: 0.2 }, anchorPoint: { x: 0, y: 0 },
      convertToWorldSpaceAR: (point: { x: number; y: number }) => ({ x: point.x + 0.2, y: point.y + 0.2 }),
    } : undefined,
  }, 'mask');
  return { capture, source, targetWrite };
}
async function take(capture: FTCreator3CanvasCapture, dimension = 720) {
  const pending = capture.capture(dimension);
  await draw();
  await draw();
  return pending;
}

describe('Creator 3 isolated replay capture', () => {
  it('preserves the portrait screen projection across SHOW_ALL design changes', async () => {
    const { capture, source } = setup({ width: 1206, height: 804 });
    state.window = { width: 1206, height: 2622 };
    state.os = 'iOS';
    source.orthoHeight = 480 * 2622 / 1206;
    const first = (await take(capture))!;
    expect(capture.getViewportSize()).toEqual(state.window);
    expect([first.width, first.height]).toEqual([331, 720]);
    const camera = state.cameras[1];
    // A 960-unit panel fills the source screen width. Its normalized bounds
    // must also fill the replay width, within one pixel of size rounding.
    const projectedWidth = 960 * first.height / (2 * camera.orthoHeight);
    expect(Math.abs(projectedWidth - first.width)).toBeLessThan(1);
    state.visible = { width: 1206, height: 1608 };
    const second = (await take(capture))!;
    expect([second.width, second.height]).toEqual([331, 720]);
    expect(state.textures).toHaveLength(1);
    state.window = { width: 2622, height: 1206 };
    const landscape = (await take(capture))!;
    expect([landscape.width, landscape.height]).toEqual([720, 331]);
    expect(state.textures).toHaveLength(2);
    state.window = { width: 1206, height: 2622 };
    const restored = (await take(capture))!;
    expect([restored.width, restored.height]).toEqual([331, 720]);
    expect(state.textures).toHaveLength(3);
    expect(state.textures[1].destroyed).toBe(true);
  });

  it.each([0, -1, NaN, Infinity])('skips an invalid window dimension %s', async width => {
    const { capture } = setup();
    state.window = { width, height: 2622 };
    expect(capture.getViewportSize()).toBeUndefined();
    expect(await capture.capture(720)).toBeUndefined();
    expect(state.textures).toHaveLength(0);
  });

  it.each([
    { name: 'full screen', visible: { width: 1920, height: 1080 }, previous: undefined },
    { name: 'SHOW_ALL letterboxing', visible: { width: 1080, height: 1080 }, previous: undefined },
    { name: 'existing render texture', visible: { width: 1920, height: 1080 }, previous: { width: 960, height: 540 } },
  ])('preserves the live camera and masks offscreen pixels with $name', async ({ visible, previous }) => {
    const { capture, source, targetWrite } = setup(visible, previous);
    const pending = capture.capture(720);
    const replayCamera = state.cameras[1];
    expect(replayCamera.enabled).toBe(false);
    for (let i = 0; i < 2; i++) {
      await draw(() => {
        expect(source.enabledInHierarchy).toBe(true);
        expect(source.targetTexture).toBe(previous);
        expect(replayCamera.enabledInHierarchy).toBe(true);
        expect(replayCamera.targetTexture).toBe(state.textures[0]);
        expect(replayCamera.node.parent).toBe(source.node);
      });
    }
    const frame = (await pending)!;
    applyPrivacyRegions(frame.rgba, frame.width, frame.height, frame.privacyRegions!);
    expect(frame.rgba[(Math.floor(frame.height * 0.35) * frame.width + Math.floor(frame.width * 0.65)) * 4]).toBe(128);
    expect(frame.rgba[4]).toBe(255);
    expect(targetWrite).not.toHaveBeenCalled();
    expect(replayCamera.enabled).toBe(false);
    expect(state.textures[0].destroyed).toBe(false);
  });
  it.each([0, 1])('synchronizes projection %s, UI layers and viewport at each draw', async projection => {
    const { capture, source } = setup();
    source.projection = projection;
    source.rect = { ...source.rect, x: 0.1, width: 0.8 };
    const pending = capture.capture(720);
    const target = state.cameras[1];
    await draw();
    source.fovAxis = 1;
    source.fov = 72;
    source.orthoHeight = 280;
    source.visibility = 5;
    await draw(() => {
      for (const key of ['projection', 'fovAxis', 'fov', 'orthoHeight', 'near', 'far', 'visibility', 'priority',
        'clearFlags', 'clearColor', 'clearDepth', 'clearStencil', 'aperture', 'shutter', 'iso']) expect(target[key]).toEqual(source[key]);
      expect(target.rect).toEqual(source.rect);
      expect(target.rect).not.toBe(source.rect);
    });
    await pending;
  });
  it('reuses the Metal camera and texture and reallocates on resize', async () => {
    const { capture } = setup();
    state.os = 'iOS';
    const first = (await take(capture))!;
    const second = (await take(capture))!;
    expect(state.cameras).toHaveLength(2);
    expect(state.textures).toHaveLength(1);
    // Compare references directly; Vitest's negated toBe deeply compares large arrays.
    expect(second.rgba === first.rgba).toBe(false);
    const oldCamera = state.cameras[1];
    const oldTexture = state.textures[0];
    state.visible = { width: 1080, height: 1920 };
    const resized = (await take(capture))!;
    expect(resized.width).toBe(405);
    expect(resized.height).toBe(720);
    expect(resized.rgba === first.rgba).toBe(false);
    expect(oldCamera.enabled).toBe(false);
    expect(oldCamera.node.isValid).toBe(false);
    expect(oldTexture.destroyed).toBe(true);
  });
  it('keeps the Android capture camera but refreshes the target for each readback', async () => {
    const { capture } = setup();
    for (let i = 0; i < 3; i++) await take(capture);
    expect(state.cameras).toHaveLength(2);
    expect(state.textures).toHaveLength(3);
    expect(state.textures.map(texture => texture.destroyed)).toEqual([true, true, false]);
    expect(state.cameras[1].targetTexture).toBe(state.textures[2]);
  });
  it('gives each Android post-process target its own isolated camera', async () => {
    const { capture, source, targetWrite } = setup();
    source.usePostProcess = true;
    source.postProcess = { settings: new Map() };
    await take(capture);
    const texture = state.textures[0];
    source.postProcess.settings.set('Bloom', { intensity: 4 });
    await take(capture);
    await take(capture);
    expect(texture.destroyed).toBe(true);
    expect(state.textures).toHaveLength(3);
    expect(state.cameras[3].postProcess).toBe(source.postProcess);
    expect(state.cameras[3].usePostProcess).toBe(true);
    expect(targetWrite).not.toHaveBeenCalled();
    expect(state.cameras).toHaveLength(4);
    expect(state.cameras[1].node.isValid).toBe(false);
    expect(state.cameras[2].node.isValid).toBe(false);
    expect(state.cameras[3].node.isValid).toBe(true);
  });
  it.each(['iOS', 'Android'])('preserves pixel orientation on %s', async os => {
    const { capture } = setup();
    state.os = os;
    const frame = (await take(capture))!;
    expect(frame.rgba[0]).toBe(os === 'iOS' ? 12 : 34);
    expect(frame.rgba[(frame.height - 1) * frame.width * 4]).toBe(os === 'iOS' ? 34 : 12);
  });
  it.each(['clear', 'viewport'] as const)('replaces the target on %s changes to avoid stale pixels', async change => {
    const { capture, source } = setup();
    state.os = 'iOS';
    await take(capture);
    const oldTexture = state.textures[0];
    if (change === 'clear') source.clearFlags = 0;
    else source.rect = { ...source.rect, width: 0.5 };
    await take(capture);
    expect(oldTexture.destroyed).toBe(true);
    expect(state.textures).toHaveLength(2);
    expect(state.cameras).toHaveLength(2);
    expect(state.cameras[1].clearFlags).toBe(source.clearFlags);
    expect(state.cameras[1].rect).toEqual(source.rect);
  });
  it.each([undefined, { x: NaN, y: 1 }, { x: 0, y: 0 }])('fails closed on invalid privacy projection: %s', async point => {
    const { capture, targetWrite } = setup();
    state.project = () => point;
    await expect(take(capture)).rejects.toThrow(/privacy/i);
    expect(targetWrite).not.toHaveBeenCalled();
    expect(state.cameras[1].enabled).toBe(false);
    expect(state.textures[0].destroyed).toBe(true);
  });
  it.each(['before', 'during', 'between'] as const)('cancels %s draws without needing another frame', async phase => {
    const { capture } = setup();
    const pending = capture.capture(720);
    if (phase === 'during') emit('before');
    if (phase === 'between') await draw();
    capture.dispose();
    await expect(pending).resolves.toBeUndefined();
    expect([...state.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
    expect(state.cameras[1].enabled).toBe(false);
    expect(state.textures[0].destroyed).toBe(true);
    await expect(take(capture)).resolves.toBeDefined();
  });
  it.each(['scene', 'camera', 'disabled'] as const)('discards capture after a %s change', async change => {
    const { capture, source } = setup();
    const pending = capture.capture(720);
    await draw();
    if (change === 'scene') state.scene = { getComponentsInChildren: () => [] };
    if (change === 'camera') source.node.destroy();
    if (change === 'disabled') source.enabled = false;
    await draw();
    await expect(pending).resolves.toBeUndefined();
    expect(state.textures[0].destroyed).toBe(true);
  });
  it('cancels on explicit camera changes and never auto-selects the replay camera', async () => {
    const { capture, source } = setup();
    const pending = capture.capture(720);
    capture.setCamera(source);
    await expect(pending).resolves.toBeUndefined();
    await take(capture);
    capture.setCamera(undefined);
    source.enabled = false;
    await expect(capture.capture(720)).resolves.toBeUndefined();
  });
  it('rejects concurrent readback and recovers after GPU failure', async () => {
    const { capture } = setup();
    const pending = capture.capture(720);
    await expect(capture.capture(720)).resolves.toBeUndefined();
    state.readError = true;
    const assertion = expect(pending).rejects.toThrow('GPU read failed');
    await draw();
    await draw();
    await assertion;
    expect(state.textures[0].destroyed).toBe(true);
    state.readError = false;
    await expect(take(capture)).resolves.toBeDefined();
  });
});
