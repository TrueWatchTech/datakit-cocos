import { describe, expect, it } from 'vitest';
import { privacyBoxPoints, privacyProjectionWeight, projectPrivacyPoints, rendererPrivacyBounds, transformPrivacyPoint } from '../src/session-replay/core/replay-renderer-bounds';
import type { PrivacyGeometry } from '../src/session-replay/core/replay-renderer-bounds';

function fixture(creator: 2 | 3 = 3) {
  const components: Record<string, any> = {};
  const node: any = { x: 0, y: 0, z: 0, getComponent: (name: string) => components[name] };
  const geometry: PrivacyGeometry = {
    creator,
    toWorld: (node: any, p) => ({ x: node.x + p.x, y: node.y + p.y, z: node.z + (p.z ?? 0) }),
    project: p => p,
  };
  return { node, components, geometry };
}

describe('renderer privacy geometry', () => {
  it.each([2, 3] as const)('bounds Creator %s mesh vertices even without a UI size', (creator) => {
    const { node, components, geometry } = fixture(creator);
    node.x = 130; node.y = 40; node.z = 25;
    components['cc.MeshRenderer'] = { mesh: creator === 2
      ? { _minPos: { x: -110, y: -35, z: -5 }, _maxPos: { x: 110, y: 35, z: 5 } }
      : { struct: { minPosition: { x: -110, y: -35, z: -5 }, maxPosition: { x: 110, y: 35, z: 5 } } } };
    expect(rendererPrivacyBounds(node, geometry)).toEqual({ clipped: undefined,
      unclipped: { x: 19, y: 4, width: 222, height: 72 } });
  });

  it('uses animated world bounds and projects depth instead of the protected parent plane', () => {
    const { node, components, geometry } = fixture();
    components['cc.MeshRenderer'] = { mesh: {}, skeleton: {}, model: {
      worldBounds: { center: { x: 100, y: 50, z: 5 }, halfExtents: { x: 10, y: 5, z: 1 } },
    } };
    geometry.project = p => ({ x: p.x / (10 - p.z!), y: p.y / (10 - p.z!), clipW: 10 - p.z! });
    expect(rendererPrivacyBounds(node, geometry).unclipped).toEqual({ x: 14, y: 6.5, width: 14.5, height: 8.25 });
  });

  it('keeps UI models in the UI stencil path', () => {
    const { node, components, geometry } = fixture();
    components['cc.MeshRenderer'] = { mesh: { minPosition: { x: 0, y: 0 }, maxPosition: { x: 5, y: 5 } } };
    components['cc.UIMeshRenderer'] = {};
    expect(rendererPrivacyBounds(node, geometry)).toEqual({ clipped: { x: -1, y: -1, width: 7, height: 7 }, unclipped: undefined });
  });

  it.each([0, 1, 2])('uses the actual 2D particle position space %s and rotated quad', (positionType) => {
    const { node, components, geometry } = fixture();
    node.x = 100; node.parent = { x: 10, y: 0, z: 0 };
    components['cc.ParticleSystem2D'] = { positionType, _simulator: { particles: [{
      pos: { x: 20, y: 30 }, startPos: { x: 5, y: 6 }, size: 10, aspectRatio: 1, rotation: 45,
    }] } };
    const x = positionType === 0 ? 25 : positionType === 1 ? 35 : 120;
    const y = positionType === 2 ? 30 : 36;
    const bounds = rendererPrivacyBounds(node, geometry).clipped!;
    expect(bounds.x).toBeCloseTo(x - Math.sqrt(50) - 1);
    expect(bounds.y).toBeCloseTo(y - Math.sqrt(50) - 1);
    expect(bounds.width).toBeCloseTo(Math.sqrt(200) + 2);
    expect(bounds.height).toBeCloseTo(Math.sqrt(200) + 2);
  });

  it('reads Creator 2 native submitted vertices and fails closed on an older bridge', () => {
    const { node, components, geometry } = fixture(2);
    node._proxy = {}; node.x = 10;
    components['cc.ParticleSystem'] = { positionType: 2, particleCount: 1, _simulator: {} };
    expect(() => rendererPrivacyBounds(node, geometry)).toThrow(/native particle bounds/);
    geometry.nativeParticleBounds = proxy => {
      expect(proxy).toBe(node._proxy);
      return [-50, -20, 5, 100, 80, 5];
    };
    expect(rendererPrivacyBounds(node, geometry).clipped).toEqual({ x: -51, y: -21, width: 152, height: 102 });
    components['cc.ParticleSystem'].particleCount = 0;
    expect(rendererPrivacyBounds(node, geometry).clipped).toBeUndefined();
  });

  it.each([2, 3] as const)('bounds live Creator %s 3D particles without stale recycled entries', (creator) => {
    const { node, components, geometry } = fixture(creator);
    node.x = 120; node.y = 40;
    const processor = { _node_scale: { x: 2, y: 1, z: 1 }, _particles: { length: 1,
      data: [{ position: { x: 0, y: 0, z: 0 }, size: { x: 10, y: 10, z: 10 } }, { position: { x: NaN }, size: {} }] } };
    components[creator === 2 ? 'cc.ParticleSystem3D' : 'cc.ParticleSystem'] = {
      simulationSpace: 1, renderMode: 0, _assembler: processor, processor, renderer: { renderMode: 0, useGPU: false },
    };
    const bounds = rendererPrivacyBounds(node, geometry).unclipped!;
    expect(bounds.x).toBeCloseTo(120 - Math.sqrt(500) / 2 - 1);
    expect(bounds.y).toBeCloseTo(40 - Math.sqrt(500) / 2 - 1);
    expect(bounds.width).toBeCloseTo(Math.sqrt(500) + 2);
  });

  it('does not emit unprotected frames when GPU, trails or native geometry cannot be read', () => {
    const { node, components, geometry } = fixture();
    const system = components['cc.ParticleSystem'] = { renderer: { useGPU: true } };
    expect(() => rendererPrivacyBounds(node, geometry)).toThrow(/privacy/);
    system.renderer.useGPU = false;
    expect(() => rendererPrivacyBounds(node, geometry)).toThrow(/privacy/);
    components['cc.ParticleSystem'] = { trailModule: { enable: true }, renderer: {} };
    expect(() => rendererPrivacyBounds(node, geometry)).toThrow(/privacy/);
  });

  it('includes stretched particle length and transformed velocity', () => {
    const { node, components, geometry } = fixture();
    node.x = 100;
    geometry.toWorld = (node, p) => ({ x: node.x + p.x * 2, y: p.y * 3, z: p.z ?? 0 });
    components['cc.ParticleSystem'] = {
      simulationSpace: 1, renderer: { renderMode: 1, lengthScale: 5, velocityScale: 2 },
      processor: { _node_scale: { x: 2, y: 3, z: 1 }, _particles: { length: 1, data: [{
        position: { x: 0, y: 0, z: 0 }, size: { x: 10, y: 20, z: 1 },
        ultimateVelocity: { x: 3, y: 4, z: 0 },
      }] } },
    };
    const radius = 10 + 300 + Math.hypot(6, 12) * 2;
    const bounds = rendererPrivacyBounds(node, geometry).unclipped!;
    expect(bounds.x).toBeCloseTo(100 - radius - 1);
    expect(bounds.width).toBeCloseTo(radius * 2 + 2);
  });

  it.each(['2d', '3d'])('projects one combined box for a large %s emitter', (type) => {
    const { node, components, geometry } = fixture();
    let projections = 0;
    geometry.project = point => { projections++; return point; };
    if (type === '2d') {
      components['cc.ParticleSystem2D'] = { positionType: 0, _simulator: { particles:
        Array.from({ length: 1000 }, (_, i) => ({ pos: { x: i, y: 0 }, startPos: { x: 0, y: 0 },
          size: 2, aspectRatio: 1, rotation: 0 })) } };
    } else {
      components['cc.ParticleSystem'] = { simulationSpace: 1, renderer: { renderMode: 0 },
        processor: { _node_scale: { x: 1, y: 1, z: 1 }, _particles: { length: 1000,
          data: Array.from({ length: 1000 }, (_, i) => ({ position: { x: i, y: 0, z: 0 }, size: { x: 2, y: 2, z: 1 } })) } } };
    }
    const bounds = rendererPrivacyBounds(node, geometry);
    expect(projections).toBe(8);
    expect((bounds.clipped || bounds.unclipped)!.width).toBeGreaterThan(1000);
  });

  it('falls back to separate particle visibility when the combined box crosses the camera plane', () => {
    const { node, components, geometry } = fixture();
    geometry.project = p => ({ x: p.x / (10 - p.z!), y: p.y / (10 - p.z!), clipW: 10 - p.z! });
    components['cc.ParticleSystem'] = { simulationSpace: 1, renderer: { renderMode: 0 },
      processor: { _node_scale: { x: 1, y: 1, z: 1 }, _particles: { length: 2,
        data: [0, 20].map(z => ({ position: { x: 0, y: 0, z }, size: { x: 2, y: 2, z: 1 } })) } } };
    const radius = Math.sqrt(2);
    const bounds = rendererPrivacyBounds(node, geometry).unclipped!;
    expect(bounds.x).toBeCloseTo(-radius / (10 - radius) - 1);
    expect(bounds.width).toBeCloseTo(2 * radius / (10 - radius) + 2);
  });

  it('transforms a large grouped 2D emitter once and keeps its rotated quad covered', () => {
    const { node, components, geometry } = fixture();
    let transforms = 0;
    geometry.toWorld = (_node, p) => { transforms++; return { x: p.x - p.y + 20, y: p.x + p.y + 30, z: 5 }; };
    components['cc.ParticleSystem2D'] = { positionType: 2, _simulator: { particles:
      Array.from({ length: 1000 }, (_, i) => ({ pos: { x: i, y: 0 }, size: 10,
        aspectRatio: 1, rotation: 45 })) } };
    const bounds = rendererPrivacyBounds(node, geometry).clipped!;
    expect(transforms).toBe(8);
    expect(bounds.x).toBeLessThanOrEqual(10);
    expect(bounds.y).toBeLessThanOrEqual(20);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(1029);
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(1039);
  });

  it.each([NaN, Infinity])('rejects a nonfinite 2D particle before treating its box as empty: %s', (x) => {
    const { node, components, geometry } = fixture();
    components['cc.ParticleSystem2D'] = { positionType: 0, _simulator: { particles: [{
      pos: { x, y: 0 }, startPos: { x: 0, y: 0 }, size: 4, aspectRatio: 1, rotation: 0,
    }] } };
    expect(() => rendererPrivacyBounds(node, geometry)).toThrow(/privacy/);
  });

  it('rejects invalid, zero-area and camera-plane-crossing geometry', () => {
    const { geometry } = fixture();
    expect(() => privacyBoxPoints({ x: 2, y: 0 }, { x: 1, y: 0 })).toThrow(/privacy/);
    expect(() => projectPrivacyPoints([{ x: NaN, y: 0 }], geometry)).toThrow(/privacy/);
    expect(() => projectPrivacyPoints([{ x: 0, y: 0 }], geometry)).toThrow(/privacy/);
    geometry.project = p => ({ ...p, clipW: p.z });
    expect(projectPrivacyPoints(privacyBoxPoints({ x: 0, y: 0, z: -2 }, { x: 1, y: 1, z: -1 }), geometry)).toBeUndefined();
    expect(() => projectPrivacyPoints(privacyBoxPoints({ x: 0, y: 0, z: -1 }, { x: 1, y: 1, z: 1 }), geometry)).toThrow(/camera plane/);
  });

  it('reads perspective weights from both engine matrix layouts', () => {
    expect(privacyProjectionWeight({ m03: 0, m07: 0, m11: -1, m15: 10 }, { x: 2, y: 4, z: 3 })).toBe(7);
    expect(privacyProjectionWeight({ m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 10] }, { x: 2, y: 4, z: 3 })).toBe(7);
  });

  it('transforms through native world matrices without relying on Node convenience methods', () => {
    const point = { x: 2, y: 3, z: 4 };
    expect(transformPrivacyPoint(point, { m: [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 4, 0, 10, 20, 30, 1] }))
      .toEqual({ x: 1, y: 24, z: 46 });
    expect(transformPrivacyPoint(point, { m00: 0, m01: 2, m02: 0, m04: -3, m05: 0, m06: 0,
      m08: 0, m09: 0, m10: 4, m12: 10, m13: 20, m14: 30 })).toEqual({ x: 1, y: 24, z: 46 });
  });
});
