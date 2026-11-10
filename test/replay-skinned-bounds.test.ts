/// <reference path="../src/creator2/shims.d.ts" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { creator2SkinnedBounds } from '../src/session-replay/core/replay-skinned-bounds';
import { rendererPrivacyBounds, type PrivacyGeometry } from '../src/session-replay/core/replay-renderer-bounds';
import { FTCreator2CanvasCapture } from '../src/session-replay/creator2/capture';
import { applyPrivacyRegions } from '../src/session-replay/core/replay';

afterEach(() => vi.unstubAllGlobals());

const matrix = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

function part(packed = false) {
  const stride = packed ? 24 : 44;
  const elements: Record<string, any> = {
    a_position: { type: 5126, num: 3, offset: 0, stride },
    a_joints: { type: packed ? 5123 : 5126, num: 4, offset: 12, stride },
    a_weights: { type: packed ? 5121 : 5126, num: 4, offset: packed ? 20 : 28, stride, normalize: packed },
  };
  // Include a nonzero byte offset as in an imported vertex bundle.
  const vData = new Uint8Array(new ArrayBuffer(16 + 3 * stride), 16);
  const view = new DataView(vData.buffer, vData.byteOffset, vData.byteLength);
  const positions = [[0, 0, 0], [2, 0, 0], [0, 2, 0]];
  positions.forEach((position, vertex) => {
    position.forEach((value, channel) => view.setFloat32(vertex * stride + channel * 4, value, true));
    for (let channel = 0; channel < 4; channel++) {
      const joint = channel === 1 ? 1 : 0;
      const weight = channel === 0 ? 0.25 : channel === 1 ? 0.75 : 0;
      if (packed) {
        view.setUint16(vertex * stride + 12 + channel * 2, joint, true);
        view.setUint8(vertex * stride + 20 + channel, channel === 0 ? 64 : channel === 1 ? 191 : 0);
      } else {
        view.setFloat32(vertex * stride + 12 + channel * 4, joint, true);
        view.setFloat32(vertex * stride + 28 + channel * 4, weight, true);
      }
    }
  });
  return { vData, view, vfm: { _bytes: stride, element: (name: string) => elements[name] }, elements };
}

function fixture(packed = false) {
  const data = part(packed);
  const renderer = {
    mesh: { subDatas: [data], _minPos: { x: 0, y: 0, z: 0 }, _maxPos: { x: 2, y: 2, z: 0 } },
    skeleton: {}, _joints: [{}, {}], _jointsFloat32Data: new Float32Array([...matrix(10, 0, 4), ...matrix(30, 8, 4)]),
    _useJointMatrix: () => false, _usingRGBA8Texture: false,
    rootBone: { convertToWorldSpaceAR: (p: any) => ({ x: 100 - p.y * 2, y: 50 + p.x * 3, z: 20 + p.z }) },
  };
  const geometry: PrivacyGeometry = { creator: 2, toWorld: (node, point) => node.convertToWorldSpaceAR(point), project: p => p };
  const node = { getComponent: (name: string) => name === 'cc.MeshRenderer' ? renderer : undefined };
  return { data, renderer, node, geometry };
}

describe('Creator 2 animated skin privacy bounds', () => {
  it('follows blended world-space skinning, ignoring the undeformed AABB and mesh-node transform', () => {
    const f = fixture();
    const toWorld = vi.fn(() => { throw new Error('world-space skin must not apply a node transform twice'); });
    expect(creator2SkinnedBounds(f.renderer, toWorld)).toEqual({ min: { x: 25, y: 6, z: 4 }, max: { x: 27, y: 8, z: 4 } });
    expect(toWorld).not.toHaveBeenCalled();
    expect(rendererPrivacyBounds(f.node, f.geometry).unclipped).toEqual({ x: 24, y: 5, width: 4, height: 4 });
  });

  it.each(['precomputed', 'rgba8'] as const)('applies the root transform for %s joint matrices', mode => {
    const f = fixture();
    f.renderer._useJointMatrix = () => mode === 'precomputed';
    f.renderer._usingRGBA8Texture = mode === 'rgba8';
    expect(creator2SkinnedBounds(f.renderer, f.geometry.toWorld))
      .toEqual({ min: { x: 84, y: 125, z: 24 }, max: { x: 88, y: 131, z: 24 } });
  });

  it('reads current bone and vertex data on every capture, including in-place updates', () => {
    const f = fixture();
    creator2SkinnedBounds(f.renderer, f.geometry.toWorld);
    f.renderer._jointsFloat32Data[28] = 50;
    f.data.view.setFloat32(44, 6, true);
    expect(creator2SkinnedBounds(f.renderer, f.geometry.toWorld))
      .toEqual({ min: { x: 40, y: 6, z: 4 }, max: { x: 46, y: 8, z: 4 } });
  });

  it('handles normalized integer weights, byte offsets and multiple native submeshes', () => {
    const f = fixture(true);
    const second = part(true);
    second.view.setFloat32(0, 100, true);
    f.renderer.mesh.subDatas.push(second);
    const bounds = creator2SkinnedBounds(f.renderer, f.geometry.toWorld)!;
    expect(bounds.min.x).toBeCloseTo((10 * 64 + 30 * 191) / 255);
    expect(bounds.max.x).toBeCloseTo(bounds.min.x + 100);
    expect(bounds.min.y).toBeCloseTo(8 * 191 / 255);
    expect(bounds.max.y).toBeCloseTo(bounds.min.y + 2);
  });

  it('projects animated depth through a perspective camera and keeps camera-plane protection', () => {
    const f = fixture();
    f.geometry.project = p => ({ x: p.x / (10 - p.z!), y: p.y / (10 - p.z!), clipW: 10 - p.z! });
    const bounds = rendererPrivacyBounds(f.node, f.geometry).unclipped!;
    expect(bounds.x).toBeCloseTo(25 / 6 - 1);
    expect(bounds.width).toBeCloseTo(2 / 6 + 2);
    // A weighted vertex moves behind the camera while others remain in front.
    f.data.view.setFloat32(8, 8, true);
    expect(() => rendererPrivacyBounds(f.node, f.geometry)).toThrow('crosses the camera plane');
  });

  it.each(['weights', 'index', 'matrix', 'layout', 'missing'] as const)('fails closed for invalid %s', kind => {
    const f = fixture();
    if (kind === 'weights') f.data.view.setFloat32(28, NaN, true);
    if (kind === 'index') f.data.view.setFloat32(12, 2, true);
    if (kind === 'matrix') f.renderer._jointsFloat32Data[0] = NaN;
    if (kind === 'layout') f.data.elements.a_weights.offset = 44;
    if (kind === 'missing') delete f.data.elements.a_joints;
    expect(() => rendererPrivacyBounds(f.node, f.geometry)).toThrow('[ft-cocos-sdk-internal]');
  });

  it.each(['mask', 'hide'] as const)('captures and %s-s the deformed pixels with a Creator 2.4.9 JSB camera', async mode => {
    const f = fixture();
    const camera = { ortho: false, node: { getWorldRT: (out: any) => { out.m = matrix(0, 0, 10); } },
      _camera: { worldToScreen: (_out: unknown, p: any) => ({ x: p.x, y: p.y }) },
      targetTexture: undefined, clearFlags: 6, render() {}, beforeDraw() {} };
    const destroy = vi.fn();
    vi.stubGlobal('cc', {
      Camera: { ClearFlags: { COLOR: 1 } }, EditBox: class {},
      RenderTexture: class { initWithSize() {} readPixels() { return new Uint8Array(64 * 64 * 4).fill(255); } destroy = destroy; },
      view: { getCanvasSize: () => ({ width: 64, height: 64 }) },
      director: { getScene: () => ({ getComponentInChildren: () => camera, getComponentsInChildren: () => [] }) },
      mat4: () => ({}), v3: (x: number, y: number, z: number) => ({ x, y, z }),
    });
    const capture = new FTCreator2CanvasCapture();
    capture.setPrivacy(f.node, mode);
    const frame = await capture.capture(64);
    expect(frame?.privacyRegions).toEqual([{ x: 24, y: 55, width: 4, height: 4, mode }]);
    applyPrivacyRegions(frame!.rgba, 64, 64, frame!.privacyRegions!);
    expect(frame!.rgba[(56 * 64 + 25) * 4]).not.toBe(255);
    expect(frame!.rgba[0]).toBe(255);
    expect(camera.targetTexture).toBeUndefined();
    expect(camera.clearFlags).toBe(6);
    expect(destroy).toHaveBeenCalledOnce();
  });
});
