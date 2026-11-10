import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

function loadSample(generation: 2 | 3) {
  const withSessionReplay = vi.fn(() => { throw new Error('Native replay requested in Web preview'); });
  const engine = {
    Component: class {}, Color: class {}, color: () => ({}),
    sys: { isNative: false },
    _decorator: { ccclass: (name: unknown) => typeof name === 'function' ? name : (klass: unknown) => klass },
    view: { setDesignResolutionSize: vi.fn() },
    ResolutionPolicy: { SHOW_ALL: 1, FIXED_HEIGHT: 2 },
  };
  const source = readFileSync(`examples/hybrid-creator${generation}/assets/${generation === 2 ? 'Script/' : ''}HybridTelemetrySample.ts`, 'utf8');
  const compiled = ts.transpileModule(source + '\nexport { HybridTelemetryRuntime };', {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(compiled, {
    exports, cc: engine,
    require: (name: string) => name === 'cc' ? engine
      : name.includes('session-replay/') ? { withSessionReplay }
        : name.includes('cocos-sdk/') ? { truewatchSdk: {} } : {},
  });
  const Runtime = exports.HybridTelemetryRuntime;
  const status = vi.fn();
  Runtime.prototype.createScene = () => ({ root: { parent: {} }, camera: {} });
  Runtime.prototype.render = vi.fn();
  Runtime.prototype.setStatus = status;
  return { exports, Runtime, status, withSessionReplay };
}

describe('Hybrid sample Web preview', () => {
  it.each([2, 3] as const)('Creator %s starts and its buttons avoid the native SDK', generation => {
    const { exports, Runtime, status, withSessionReplay } = loadSample(generation);
    const Startup = generation === 2 ? exports.default : exports.HybridTelemetrySample;
    expect(() => new Startup().start()).not.toThrow();
    expect(status).toHaveBeenCalledWith(expect.stringContaining('Editor preview only'), expect.anything());
    expect(withSessionReplay).not.toHaveBeenCalled();
    const runtime = new Runtime();
    for (const method of ['emitRumAndLog', 'emitAutomaticResource', 'emitManualTraceResource', 'emitError', 'openNativePage', 'changeReplayState', 'toggleMaskFit']) {
      expect(() => runtime[method](), method).not.toThrow();
    }
    expect(withSessionReplay).not.toHaveBeenCalled();
  });

  it('Creator 2 motion module does not access the removed ToggleGroup getter', () => {
    const cc = {
      Component: class {}, Color: class {},
      _decorator: { ccclass: () => (klass: unknown) => klass },
    };
    Object.defineProperty(cc, 'ToggleGroup', { get() { throw new Error('Removed API'); } });
    const source = readFileSync('examples/hybrid-creator2/assets/Script/ReplayMotionScene.ts', 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
    }).outputText;
    expect(() => runInNewContext(compiled, { cc, exports: {}, require: () => ({}) })).not.toThrow();
  });
});

it('cooks JSB accessor-backed batch meshes with correctly encoded IDs, UVs and indices', () => {
  class Mesh {
    struct: any;
    data = new Uint8Array();
    reset(info: any) { this.struct = info.struct; this.data = info.data; }
  }
  class Renderer {
    private currentMesh: any;
    private currentSkeleton: any;
    get mesh() { return this.currentMesh; }
    set mesh(value: any) { this.currentMesh = value; }
    get skeleton() { return this.currentSkeleton; }
    set skeleton(value: any) { this.currentSkeleton = value; }
  }
  const exports: Record<string, any> = {};
  const compiled = ts.transpileModule(readFileSync('examples/hybrid-creator3/assets/ReplayBatchRenderer.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
  }).outputText;
  runInNewContext(compiled, { exports, require: () => ({
    _decorator: { ccclass: () => (klass: unknown) => klass },
    Mesh, SkinnedMeshRenderer: Renderer, SkinnedMeshBatchRenderer: class extends Renderer {},
    sys: { isLittleEndian: true },
    gfx: { Attribute: class { constructor(public name: string, public format: number) {} }, AttributeName: { ATTR_TEX_COORD: 'uv', ATTR_BATCH_ID: 'id', ATTR_BATCH_UV: 'batch-uv' }, Format: { R32F: 1, RG32F: 2 } },
  }) });
  const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 1, 0]);
  const nativeStruct = {};
  Object.defineProperties(nativeStruct, {
    vertexBundles: { get: () => [{ attributes: [{ name: 'uv', format: 2 }], view: { offset: 0, length: 8, count: 1, stride: 8 } }] },
    primitives: { get: () => [{ primitiveMode: 7, vertexBundelIndices: [0], indexView: { offset: 8, length: 4, count: 2, stride: 2 } }] },
  });
  expect(JSON.parse(JSON.stringify(nativeStruct))).toEqual({});
  const renderer = new exports.ReplayBatchRenderer();
  const skeleton = {};
  renderer.skeleton = skeleton;
  expect(renderer.skeleton).toBe(skeleton);
  const cooked = renderer._createUnitMesh(1, { struct: nativeStruct, data, readAttribute: () => new Float32Array([0.25, 0.75]) });
  renderer.mesh = cooked;
  expect(renderer.mesh).toBe(cooked);
  expect(cooked.struct.vertexBundles[0].view).toEqual({ offset: 0, length: 20, count: 1, stride: 20 });
  expect(Array.from(cooked.data.slice(0, 8))).toEqual(Array.from(data.slice(0, 8)));
  const view = new DataView(cooked.data.buffer);
  expect(view.getFloat32(8, true)).toBe(1);
  expect(view.getFloat32(12, true)).toBe(0.25);
  expect(view.getFloat32(16, true)).toBe(0.75);
  expect(Array.from(cooked.data.slice(20))).toEqual([0, 0, 1, 0]);
});

it.each([2, 3] as const)('Creator %s evidence cleanup skips audio components already destroyed with their child node', generation => {
  const engine = { Component: class {}, _decorator: { ccclass: () => (klass: unknown) => klass } };
  const exports: Record<string, any> = {};
  const source = readFileSync(`examples/hybrid-creator${generation}/assets/${generation === 2 ? 'Script/' : ''}ReplayEvidenceScene.ts`, 'utf8');
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
  }).outputText, { exports, cc: engine, require: () => engine });
  const scene = new exports.ReplayEvidenceScene();
  const destroyed = { isValid: false, stop: vi.fn(() => { throw new Error('Audio backend already released'); }) };
  const alive = { isValid: true, stop: vi.fn() };
  scene.rows = [{ audio: destroyed }, { audio: alive }];
  scene.stopPhysics = vi.fn();
  scene.unscheduleAllCallbacks = vi.fn();
  expect(() => scene.onDestroy()).not.toThrow();
  expect(destroyed.stop).not.toHaveBeenCalled();
  expect(alive.stop).toHaveBeenCalledOnce();
});
