import { replayError } from './internal-errors.js';
import type { PrivacyPoint } from './replay-renderer-bounds.js';

interface SkinnedBounds { min: PrivacyPoint; max: PrivacyPoint }

/** Creator 2 keeps interleaved CPU vertices even when JSB owns the draw buffers.
 * Use the matrices submitted by the renderer, including precomputed animation
 * and RGBA8 joint textures, rather than the undeformed source mesh's AABB.
 * Read afresh for each capture: setVertices and animation can change in place.
 */
export function creator2SkinnedBounds(
  renderer: any,
  toWorld: (node: any, point: PrivacyPoint) => PrivacyPoint,
): SkinnedBounds | undefined {
  const parts = renderer.mesh?.subDatas;
  const matrices = renderer._jointsFloat32Data;
  const jointCount = renderer._joints?.length;
  if (!Array.isArray(parts) || !matrices || !Number.isInteger(jointCount) || jointCount <= 0
    || matrices.length < jointCount * 16 || typeof renderer._useJointMatrix !== 'function') {
    throw replayError('Missing Replay privacy skinned bounds');
  }
  // In these two modes the shader also applies the root bone's world matrix.
  // Otherwise joint matrices already contain world transforms and the engine
  // renders with an identity dummy node, not the mesh node's transform.
  const rootRelative = renderer._useJointMatrix() || renderer._usingRGBA8Texture;
  if (rootRelative && !renderer.rootBone) throw replayError('Missing Replay privacy skinning root');
  let bounds: SkinnedBounds | undefined;
  for (const part of parts) {
    const bytes = part.vData;
    const stride = part.vfm?._bytes;
    if (!ArrayBuffer.isView(bytes) || !Number.isInteger(stride) || stride <= 0 || bytes.byteLength % stride !== 0) {
      throw replayError('Invalid Replay privacy skinned vertex buffer');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const position = attribute(view, part.vfm, 'a_position', 3);
    const joints = attribute(view, part.vfm, 'a_joints', 4);
    const weights = attribute(view, part.vfm, 'a_weights', 4);
    for (let vertex = 0; vertex < bytes.byteLength / stride; vertex++) {
      const px = position(vertex, 0), py = position(vertex, 1), pz = position(vertex, 2);
      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) throw replayError('Invalid Replay privacy skinned position');
      let x = 0, y = 0, z = 0, w = 0;
      for (let influence = 0; influence < 4; influence++) {
        const weight = weights(vertex, influence);
        const joint = joints(vertex, influence);
        if (!Number.isFinite(weight) || weight < 0 || !Number.isInteger(joint) || joint < 0 || joint >= jointCount) {
          throw replayError('Invalid Replay privacy skinned influence');
        }
        if (weight === 0) continue;
        const offset = joint * 16;
        x += weight * (matrices[offset] * px + matrices[offset + 4] * py + matrices[offset + 8] * pz + matrices[offset + 12]);
        y += weight * (matrices[offset + 1] * px + matrices[offset + 5] * py + matrices[offset + 9] * pz + matrices[offset + 13]);
        z += weight * (matrices[offset + 2] * px + matrices[offset + 6] * py + matrices[offset + 10] * pz + matrices[offset + 14]);
        w += weight * (matrices[offset + 3] * px + matrices[offset + 7] * py + matrices[offset + 11] * pz + matrices[offset + 15]);
      }
      if (!Number.isFinite(w) || w <= 0) throw replayError('Invalid Replay privacy skinned weight');
      bounds = include(bounds, x / w, y / w, z / w);
    }
  }
  if (bounds && rootRelative) {
    // Transform the enclosing box rather than crossing JSB once per vertex.
    // Affine root transforms keep this conservative under rotation and scale.
    let world: SkinnedBounds | undefined;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z!, bounds.max.z!]) {
        const point = toWorld(renderer.rootBone, { x, y, z });
        world = include(world, point.x, point.y, point.z ?? 0);
      }
    }
    return world;
  }
  return bounds;
}

function include(bounds: SkinnedBounds | undefined, x: number, y: number, z: number): SkinnedBounds {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw replayError('Invalid Replay privacy skinned transform');
  if (!bounds) return { min: { x, y, z }, max: { x, y, z } };
  bounds.min.x = Math.min(bounds.min.x, x); bounds.max.x = Math.max(bounds.max.x, x);
  bounds.min.y = Math.min(bounds.min.y, y); bounds.max.y = Math.max(bounds.max.y, y);
  bounds.min.z = Math.min(bounds.min.z!, z); bounds.max.z = Math.max(bounds.max.z!, z);
  return bounds;
}

/** gfx's GL attribute types. Respect byte offsets, strides and GPU normalization. */
function attribute(view: DataView, format: any, name: string, count: number): (vertex: number, channel: number) => number {
  const element = format.element?.(name);
  const readers: Record<number, { bytes: number; max?: number; read: (offset: number) => number }> = {
    5120: { bytes: 1, max: 127, read: offset => view.getInt8(offset) },
    5121: { bytes: 1, max: 255, read: offset => view.getUint8(offset) },
    5122: { bytes: 2, max: 32767, read: offset => view.getInt16(offset, true) },
    5123: { bytes: 2, max: 65535, read: offset => view.getUint16(offset, true) },
    5124: { bytes: 4, max: 2147483647, read: offset => view.getInt32(offset, true) },
    5125: { bytes: 4, max: 4294967295, read: offset => view.getUint32(offset, true) },
    5126: { bytes: 4, read: offset => view.getFloat32(offset, true) },
  };
  const reader = readers[element?.type];
  if (!element || !reader || element.num !== count || !Number.isInteger(element.offset) || element.offset < 0
    || element.offset + reader.bytes * count > format._bytes || element.stride !== format._bytes) {
    throw replayError(`Unsupported Replay privacy skinned attribute: ${name}`);
  }
  return (vertex, channel) => {
    const value = reader.read(vertex * element.stride + element.offset + channel * reader.bytes);
    return element.normalize && reader.max ? Math.max(-1, value / reader.max) : value;
  };
}
