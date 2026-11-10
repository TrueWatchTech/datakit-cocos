/// <reference path="../src/creator2/shims.d.ts" />
/// <reference path="../src/creator3/shims.d.ts" />

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as creator3Engine from 'cc';
import { FTCreator2CanvasCapture } from '../src/session-replay/creator2/capture';
import { FTCreator3CanvasCapture } from '../src/session-replay/creator3/capture';
import { applyPrivacyRegions } from '../src/session-replay/core/replay';

const state = vi.hoisted(() => ({ scene: undefined as any }));
vi.mock('cc', () => ({
  Camera: class { static ClearFlags = { COLOR: 1 }; static ClearFlag = { SOLID_COLOR: 7 }; },
  Node: class {
    active = false;
    parent: any;
    get scene() { return this.parent?.scene; }
    addComponent() {
      return { enabled: false, node: this, worldToScreen: (point: unknown) => state.scene.getComponentInChildren().worldToScreen(point) };
    }
    destroy(): void {}
  },
  isValid: (value: any) => !!value && value.isValid !== false,
  Component: class { enabledInHierarchy = true; isValid = true; },
  EditBox: class {},
  UITransform: class {},
  Enum: (value: unknown) => value,
  _decorator: {
    ccclass: (_name: string) => (type: unknown) => type,
    menu: (_path: string) => (type: unknown) => type,
    disallowMultiple: (type: unknown) => type,
    property: (_options: unknown) => () => {},
  },
  Vec3: class { constructor(public x: number, public y: number, public z: number) {} },
  v3: (x: number, y: number, z: number) => ({ x, y, z }),
  v2: (x: number, y: number) => ({ x, y }),
  RenderTexture: class {
    initWithSize(): void {}
    reset(): void {}
    readPixels(): Uint8Array { return new Uint8Array(10 * 10 * 4).fill(255); }
    destroy(): void {}
  },
  Director: { EVENT_BEFORE_DRAW: 'before', EVENT_AFTER_DRAW: 'after' },
  director: {
    getScene: () => state.scene,
    once: (_event: string, callback: () => void) => callback(),
    off(): void {},
  },
  view: { getScaleX: () => 1, getScaleY: () => 1, getViewportRect: () => ({ x: 0, y: 0 }), getCanvasSize: () => ({ width: 10, height: 10 }) },
  screen: { windowSize: { width: 10, height: 10 } },
  visibleRect: { width: 10, height: 10 },
  gfx: { RB_FMT_D24S8: 7 },
  sys: { os: 'Android', OS: { IOS: 'iOS' } },
  native: {},
}));

// Execute the actual distributed asset scripts, including their enum and getter.
function loadComponent(creator: number): any {
  const source = readFileSync(`src/session-replay/components/creator${creator}/ReplayPrivacy.ts`, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2018,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
      useDefineForClassFields: false,
    },
  });
  const exports = {};
  runInNewContext(compiled.outputText, { exports, cc: creator3Engine, require: () => creator3Engine });
  return exports;
}

afterEach(() => vi.unstubAllGlobals());

function privacyNode(x: number, y: number, width: number, height: number): any {
  const transform = {
    contentSize: { width, height }, anchorPoint: { x: 0, y: 0 },
    convertToWorldSpaceAR: (point: { x: number; y: number }) => ({ x: point.x + x, y: point.y + y }),
  };
  const node: any = {
    worldPosition: { z: 0 }, children: [], mask: undefined,
    worldMatrix: { m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1] },
    renderers: {} as Record<string, any>,
    getContentSize: () => transform.contentSize,
    getAnchorPoint: () => transform.anchorPoint,
    convertToWorldSpaceAR: transform.convertToWorldSpaceAR,
    getComponent: (type: unknown) => type === creator3Engine.UITransform ? transform : type === 'cc.Mask' ? node.mask : node.renderers[String(type)],
  };
  return node;
}

function guardLegacyScene(scene: any): ReturnType<typeof vi.fn> {
  const access = vi.fn();
  // Creator 2.4.9 reports an error when these properties are read, then returns a fallback.
  Object.defineProperties(scene, {
    activeInHierarchy: { get: () => { access('activeInHierarchy'); return true; } },
    getComponent: { get: () => { access('getComponent'); return () => null; } },
  });
  return access;
}

describe.each([2, 3])('Creator %s ReplayPrivacy component', (creator) => {
  let capture: FTCreator2CanvasCapture | FTCreator3CanvasCapture;
  let components: any[];
  let editBoxes: any[];
  let component: any;
  let node: any;
  let asset: any;

  beforeEach(() => {
    vi.stubGlobal('cc', creator3Engine);
    asset = loadComponent(creator);
    node = privacyNode(2, 2, 4, 4);
    component = new asset.default();
    component.node = node;
    components = [component];
    editBoxes = [];
    const camera = {
      enabledInHierarchy: true,
      node: { get scene() { return state.scene; } },
      rect: { clone: () => ({ x: 0, y: 0, width: 1, height: 1 }) },
      clearFlags: 0,
      targetTexture: undefined,
      render() {}, beforeDraw() {},
      getWorldToScreenPoint: (point: unknown) => point,
      _camera: { worldToScreen: (_out: unknown, point: unknown) => point },
      worldToScreen: (point: unknown) => point,
    };
    state.scene = {
      getComponentInChildren: () => camera,
      getComponentsInChildren: (type: unknown) => {
        if (type === creator3Engine.Camera) return [camera];
        if (type === 'ReplayPrivacy') return components;
        if (type === creator3Engine.EditBox) return editBoxes;
        throw new Error('Unexpected component query');
      },
    };
    capture = creator === 2 ? new FTCreator2CanvasCapture() : new FTCreator3CanvasCapture();
  });

  afterEach(() => { if (capture instanceof FTCreator3CanvasCapture) capture.dispose(); });

  async function expectMode(mode?: 'mask' | 'hide') {
    const frame = (await capture.capture(10))!;
    expect(frame.privacyRegions).toEqual(mode
      ? [{ x: 2, y: 4, width: 4, height: 4, mode }]
      : []);
    applyPrivacyRegions(frame.rgba, frame.width, frame.height, frame.privacyRegions!);
    expect(Array.from(frame.rgba.slice((5 * 10 + 3) * 4, (5 * 10 + 3) * 4 + 4)))
      .toEqual(mode === 'hide' ? [0, 0, 0, 255] : mode === 'mask' ? [128, 128, 128, 255] : [255, 255, 255, 255]);
    expect(Array.from(frame.rgba.slice(0, 4))).toEqual([255, 255, 255, 255]);
  }

  it('masks by default and applies mode changes on the next capture', async () => {
    await expectMode('mask');
    component.mode = asset.ReplayPrivacyMode.Hide;
    await expectMode('hide');
  });

  it('gives code overrides priority and restores component rules after unmask', async () => {
    component.mode = asset.ReplayPrivacyMode.Hide;
    capture.setPrivacy(node, 'mask');
    await expectMode('mask');
    capture.setPrivacy(node, 'unmask');
    await expectMode('hide');
    component.mode = asset.ReplayPrivacyMode.Mask;
    capture.setPrivacy(node, 'hide');
    await expectMode('hide');
  });

  it('discovers dynamic prefabs and stops using disabled, destroyed or removed components', async () => {
    components = [];
    await expectMode();
    components.push(component);
    await expectMode('mask');
    component.enabledInHierarchy = false;
    await expectMode();
    component.enabledInHierarchy = true;
    await expectMode('mask');
    component.isValid = false;
    await expectMode();
    component.isValid = true;
    components = [];
    await expectMode();
  });

  it('keeps default input masking after disabling a component or clearing an override', async () => {
    editBoxes.push({ node });
    component.mode = asset.ReplayPrivacyMode.Hide;
    await expectMode('hide');
    component.enabledInHierarchy = false;
    await expectMode('mask');
    capture.setPrivacy(node, 'hide');
    await expectMode('hide');
    capture.setPrivacy(node, 'unmask');
    await expectMode('mask');
  });

  it('retains the code API for nodes without the editor component', async () => {
    components = [];
    capture.setPrivacy(node, 'mask');
    await expectMode('mask');
    capture.setPrivacy(node, 'unmask');
    await expectMode();
  });

  it('removes hidden or destroyed input masks and restores overrides when the node reactivates', async () => {
    components = [];
    editBoxes.push({ node });
    await expectMode('mask');
    node.activeInHierarchy = false;
    await expectMode();
    capture.setPrivacy(node, 'hide');
    await expectMode();
    node.activeInHierarchy = true;
    await expectMode('hide');
    capture.setPrivacy(node, 'unmask');
    await expectMode('mask');
    node.isValid = false;
    await expectMode();
  });

  it('fails closed when a component region cannot be projected', async () => {
    const camera = state.scene.getComponentInChildren();
    camera.getWorldToScreenPoint = camera.worldToScreen = () => ({ x: NaN, y: 0 });
    camera._camera.worldToScreen = () => ({ x: NaN, y: 0 });
    await expect(capture.capture(10)).rejects.toThrow(/privacy/i);
    expect(camera.targetTexture).toBeUndefined();
  });

  it('clips scrolling and oversized descendants without covering public siblings', async () => {
    const viewport = privacyNode(3, 3, 2, 2);
    viewport.mask = { enabledInHierarchy: true, inverted: false };
    viewport.children = [privacyNode(-2, -2, 12, 12)];
    node.children = [viewport];
    await expectMode('mask');
    component.mode = asset.ReplayPrivacyMode.Hide;
    await expectMode('hide');
    viewport.mask.enabledInHierarchy = false;
    expect((await capture.capture(10))!.privacyRegions).toEqual([{ x: -2, y: 0, width: 12, height: 12, mode: 'hide' }]);
    viewport.mask.enabledInHierarchy = true;
    viewport.mask.inverted = true;
    expect((await capture.capture(10))!.privacyRegions).toEqual([{ x: -2, y: 0, width: 12, height: 12, mode: 'hide' }]);
  });

  it('omits a private node outside an ancestor clip and restores it when scrolled into view', async () => {
    const viewport = privacyNode(0, 0, 1, 1);
    viewport.mask = { enabledInHierarchy: true, inverted: false };
    node.parent = viewport;
    await expectMode();
    node.parent = privacyNode(2, 2, 4, 4);
    node.parent.mask = viewport.mask;
    await expectMode('mask');
  });

  it.runIf(creator === 2)('stops ancestor component queries at the Scene while preserving Mask clipping', async () => {
    const viewport = privacyNode(3, 3, 2, 2);
    viewport.mask = { enabledInHierarchy: true, inverted: false };
    viewport.parent = state.scene;
    viewport.children = [node];
    node.parent = viewport;
    state.scene.children = [viewport, privacyNode(0, 0, 1, 1)];
    const sceneAccess = guardLegacyScene(state.scene);

    const frame = (await capture.capture(10))!;
    expect(frame.privacyRegions).toEqual([{ x: 3, y: 5, width: 2, height: 2, mode: 'mask' }]);
    applyPrivacyRegions(frame.rgba, 10, 10, frame.privacyRegions!);
    expect(Array.from(frame.rgba.slice((5 * 10 + 3) * 4, (5 * 10 + 3) * 4 + 4))).toEqual([128, 128, 128, 255]);
    expect(Array.from(frame.rgba.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(sceneAccess).not.toHaveBeenCalled();
  });

  it.runIf(creator === 2)('protects Scene descendants without reading normal node properties on the Scene', async () => {
    components = [];
    const hidden = privacyNode(7, 7, 3, 3);
    hidden.activeInHierarchy = false;
    node.parent = state.scene;
    state.scene.children = [node, hidden];
    const sceneAccess = guardLegacyScene(state.scene);
    capture.setPrivacy(state.scene, 'hide');

    await expectMode('hide');
    node.convertToWorldSpaceAR = (point: { x: number; y: number }) => ({ x: point.x + 3, y: point.y + 3 });
    expect((await capture.capture(10))!.privacyRegions).toEqual([{ x: 3, y: 3, width: 4, height: 4, mode: 'hide' }]);
    capture.setPrivacy(state.scene, 'unmask');
    await expectMode();
    expect(sceneAccess).not.toHaveBeenCalled();
  });

  it('captures an overflowing zero-size mesh child and preserves pixels outside the protected region', async () => {
    const mesh = privacyNode(7, 2, 0, 0);
    mesh.renderers['cc.MeshRenderer'] = { mesh: {
      _minPos: { x: 0, y: 0, z: 0 }, _maxPos: { x: 1, y: 3, z: 1 },
    } };
    node.children = [mesh];
    const frame = (await capture.capture(10))!;
    expect(frame.privacyRegions).toEqual([{ x: 2, y: 4, width: 7, height: 5, mode: 'mask' }]);
    applyPrivacyRegions(frame.rgba, 10, 10, frame.privacyRegions!);
    expect(Array.from(frame.rgba.slice((5 * 10 + 7) * 4, (5 * 10 + 7) * 4 + 4))).toEqual([128, 128, 128, 255]);
    expect(Array.from(frame.rgba.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });

  it('fails closed if a protected particle renderer has no readable geometry', async () => {
    node.renderers['cc.ParticleSystem'] = creator === 2
      ? { particleCount: 1, positionType: 0, _simulator: {} }
      : { renderer: { useGPU: true } };
    await expect(capture.capture(10)).rejects.toThrow(/privacy/i);
  });

  it('reads a native world matrix once per emitter and refreshes it on the next capture', async () => {
    if (creator !== 3) return;
    const emitter = privacyNode(3, 3, 0, 0);
    const matrix = emitter.worldMatrix;
    let reads = 0;
    Object.defineProperty(emitter, 'worldMatrix', { get: () => { reads++; return matrix; } });
    emitter.renderers['cc.ParticleSystem'] = { simulationSpace: 1, renderer: { renderMode: 0 },
      processor: { _node_scale: { x: 1, y: 1, z: 1 }, _particles: { length: 1000,
        data: Array.from({ length: 1000 }, () => ({ position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } })) } } };
    node.children = [emitter];
    await capture.capture(10);
    expect(reads).toBe(1);
    matrix.m[12] += 1;
    await capture.capture(10);
    expect(reads).toBe(2);
  });
});
