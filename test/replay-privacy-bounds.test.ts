import { describe, expect, it } from 'vitest';
import { clippedPrivacyBounds, ownPrivacyBounds, PrivacyBounds } from '../src/session-replay/core/replay-privacy-bounds';

interface TestNode {
  bounds?: PrivacyBounds;
  clip?: boolean;
  activeInHierarchy?: boolean;
  children?: TestNode[];
  parent?: TestNode;
}
const adapter = {
  ownBounds: (node: TestNode) => node.bounds,
  clipsChildren: (node: TestNode) => !!node.clip,
};

describe('visible privacy bounds', () => {
  it('transforms all own corners through translation, rotation and scale', () => {
    expect(ownPrivacyBounds(10, 20, 0.5, 0.5, (x, y) => ({ x: 50 - y * 2, y: 30 + x * 2 })))
      .toEqual({ x: 30, y: 20, width: 40, height: 20 });
  });

  it('intersects nested ancestor and descendant clips, ignoring hidden subtrees', () => {
    const outer: TestNode = { bounds: { x: 5, y: 5, width: 8, height: 8 }, clip: true };
    const node: TestNode = { parent: outer, children: [
      { bounds: { x: 0, y: 0, width: 10, height: 10 }, clip: true,
        children: [{ bounds: { x: -20, y: -20, width: 60, height: 60 } }] },
      { bounds: { x: -100, y: -100, width: 300, height: 300 }, activeInHierarchy: false },
    ] };
    expect(clippedPrivacyBounds(node, adapter)).toEqual({ x: 5, y: 5, width: 5, height: 5 });
  });

  it('preserves unclipped descendant extent and treats an empty clip as invisible', () => {
    const node: TestNode = { bounds: { x: 2, y: 2, width: 4, height: 4 },
      children: [{ bounds: { x: -2, y: -3, width: 10, height: 12 } }] };
    expect(clippedPrivacyBounds(node, adapter)).toEqual({ x: -2, y: -3, width: 10, height: 12 });
    node.parent = { bounds: { x: 0, y: 0, width: 0, height: 4 }, clip: true };
    expect(clippedPrivacyBounds(node, adapter)).toBeUndefined();
  });

  it('fails closed for invalid transforms or a clip without geometry', () => {
    const invalid: TestNode = { bounds: { x: NaN, y: 0, width: 4, height: 4 } };
    const missing: TestNode = { clip: true };
    expect(() => clippedPrivacyBounds(invalid, adapter)).toThrow(/privacy/i);
    expect(() => clippedPrivacyBounds(missing, adapter)).toThrow(/privacy/i);
  });

  it('uses stencil geometry separately from overflowing renderers', () => {
    const node: TestNode = { bounds: { x: -20, y: -20, width: 50, height: 50 }, clip: true };
    expect(clippedPrivacyBounds(node, { ...adapter,
      clipBounds: () => ({ x: 2, y: 3, width: 4, height: 5 }),
    })).toEqual({ x: 2, y: 3, width: 4, height: 5 });
  });

  it('keeps world-space mesh geometry visible outside an unrelated ancestor stencil', () => {
    const child: TestNode = {};
    const node: TestNode = { parent: { bounds: { x: 0, y: 0, width: 0, height: 0 }, clip: true }, children: [child] };
    expect(clippedPrivacyBounds(node, { ...adapter,
      unclippedBounds: current => current === child ? { x: 20, y: 30, width: 40, height: 50 } : undefined,
    })).toEqual({ x: 20, y: 30, width: 40, height: 50 });
  });
});
