/// <reference path="../src/creator2/shims.d.ts" />
/// <reference path="../src/creator3/shims.d.ts" />

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as creator3Engine from 'cc';
import { FTCreator2CanvasCapture } from '../src/creator2/capture';
import { FTCreator3CanvasCapture } from '../src/creator3/capture';
import { applyPrivacyRegions } from '../src/core/replay';

const state = vi.hoisted(() => ({ scene: undefined as any }));
vi.mock('cc', () => ({
  Camera: class { static ClearFlags = { COLOR: 1 }; },
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
  },
  view: { getVisibleSizeInPixel: () => ({ width: 10, height: 10 }) },
  visibleRect: { width: 10, height: 10 },
  gfx: { RB_FMT_D24S8: 7 },
  sys: { os: 'Android', OS: { IOS: 'iOS' } },
  native: {},
}));

// Execute the actual distributed asset scripts, including their enum and getter.
function loadComponent(creator: number): any {
  const source = readFileSync(`components/creator${creator}/ReplayPrivacy.ts`, 'utf8');
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
    const bounds = () => ({ x: 2, y: 2, width: 4, height: 4 });
    node = {
      worldPosition: { z: 0 },
      getBoundingBoxToWorld: bounds,
      getComponent: () => ({ getBoundingBoxToWorld: bounds }),
    };
    component = new asset.default();
    component.node = node;
    components = [component];
    editBoxes = [];
    const camera = {
      clearFlags: 0,
      targetTexture: undefined,
      getWorldToScreenPoint: (point: unknown) => point,
      worldToScreen: (point: unknown) => point,
    };
    state.scene = {
      getComponentInChildren: () => camera,
      getComponentsInChildren: (type: unknown) => {
        if (type === 'ReplayPrivacy') return components;
        if (type === creator3Engine.EditBox) return editBoxes;
        throw new Error('Unexpected component query');
      },
    };
    capture = creator === 2 ? new FTCreator2CanvasCapture() : new FTCreator3CanvasCapture();
  });

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

  it('fails closed when a component region cannot be projected', async () => {
    const camera = state.scene.getComponentInChildren();
    camera.getWorldToScreenPoint = camera.worldToScreen = () => ({ x: NaN, y: 0 });
    await expect(capture.capture(10)).rejects.toThrow(/privacy/i);
    expect(camera.targetTexture).toBeUndefined();
  });
});
