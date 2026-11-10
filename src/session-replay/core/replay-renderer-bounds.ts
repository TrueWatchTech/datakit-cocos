import type { PrivacyBounds } from './replay-privacy-bounds.js';

export interface PrivacyPoint { x: number; y: number; z?: number }
interface ProjectedPoint extends PrivacyPoint { clipW?: number }
export interface PrivacyGeometry {
  creator: 2 | 3;
  toWorld(node: any, point: PrivacyPoint): PrivacyPoint;
  project(point: PrivacyPoint): ProjectedPoint;
  nativeParticleBounds?(proxy: unknown): number[] | null;
}

export function privacyProjectionWeight(matrix: any, point: PrivacyPoint): number | undefined {
  if (!matrix) return undefined;
  const m = matrix.m;
  const value = m ? m[3] * point.x + m[7] * point.y + m[11] * (point.z ?? 0) + m[15]
    : matrix.m03 * point.x + matrix.m07 * point.y + matrix.m11 * (point.z ?? 0) + matrix.m15;
  if (!Number.isFinite(value)) throw new Error('Invalid Replay privacy camera projection');
  return value;
}

export function transformPrivacyPoint(point: PrivacyPoint, matrix: any): PrivacyPoint {
  if (!matrix || !valid(point)) throw new Error('Missing Replay privacy world transform');
  const m = matrix.m; const x = point.x; const y = point.y; const z = point.z ?? 0;
  const result = m ? {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
  } : {
    x: matrix.m00 * x + matrix.m04 * y + matrix.m08 * z + matrix.m12,
    y: matrix.m01 * x + matrix.m05 * y + matrix.m09 * z + matrix.m13,
    z: matrix.m02 * x + matrix.m06 * y + matrix.m10 * z + matrix.m14,
  };
  if (!valid(result)) throw new Error('Invalid Replay privacy world transform');
  return result;
}

function valid(point: PrivacyPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z ?? 0);
}

const CAMERA_PLANE_ERROR = new Error('Replay privacy geometry crosses the camera plane');

/** Coordinates stay bottom-left based until the complete region is assembled. */
export function projectPrivacyPoints(points: PrivacyPoint[], geometry: PrivacyGeometry): PrivacyBounds | undefined {
  if (!points.length) return undefined;
  if (points.some(point => !valid(point))) throw new Error('Invalid Replay privacy geometry');
  const screen = points.map(point => geometry.project(point));
  if (screen.every(point => point.clipW !== undefined && point.clipW <= 0)) return undefined;
  if (screen.some(point => point.clipW !== undefined && point.clipW <= 0)) {
    throw CAMERA_PLANE_ERROR;
  }
  if (screen.some(point => !valid(point))) throw new Error('Unable to project Replay privacy geometry');
  const x = Math.min(...screen.map(point => point.x));
  const y = Math.min(...screen.map(point => point.y));
  const width = Math.max(...screen.map(point => point.x)) - x;
  const height = Math.max(...screen.map(point => point.y)) - y;
  if (width <= 0 || height <= 0) throw new Error('Zero-area Replay privacy projection');
  return { x, y, width, height };
}

export function privacyBoxPoints(min: PrivacyPoint, max: PrivacyPoint): PrivacyPoint[] {
  if (!valid(min) || !valid(max) || min.x > max.x || min.y > max.y || (min.z ?? 0) > (max.z ?? 0)) {
    throw new Error('Invalid Replay privacy renderer bounds');
  }
  const points: PrivacyPoint[] = [];
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z ?? 0, max.z ?? 0]) {
    points.push({ x, y, z });
  }
  return points;
}

function merge(a: PrivacyBounds | undefined, b: PrivacyBounds | undefined): PrivacyBounds | undefined {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x); const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function component(node: any, name: string): any {
  const value = node.getComponent?.(name);
  return value && value.enabled !== false && value.enabledInHierarchy !== false && value.isValid !== false ? value : undefined;
}

function rasterBounds(bounds?: PrivacyBounds): PrivacyBounds | undefined {
  // Include rasterization at the projected edge without growing world geometry.
  return bounds && { x: bounds.x - 1, y: bounds.y - 1, width: bounds.width + 2, height: bounds.height + 2 };
}

function localBox(node: any, min: PrivacyPoint, max: PrivacyPoint, geometry: PrivacyGeometry): PrivacyBounds | undefined {
  return projectPrivacyPoints(privacyBoxPoints(min, max).map(point => geometry.toWorld(node, point)), geometry);
}

/** Accumulate on the CPU; native camera projection is needed once per emitter. */
class ParticleWorldBounds {
  private minX = Infinity;
  private minY = Infinity;
  private minZ = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  private maxZ = -Infinity;

  include(point: PrivacyPoint, radius = 0): void {
    if (!valid(point) || !Number.isFinite(radius)) throw new Error('Invalid Replay privacy particle geometry');
    const z = point.z ?? 0;
    this.minX = Math.min(this.minX, point.x - radius); this.maxX = Math.max(this.maxX, point.x + radius);
    this.minY = Math.min(this.minY, point.y - radius); this.maxY = Math.max(this.maxY, point.y + radius);
    this.minZ = Math.min(this.minZ, z - radius); this.maxZ = Math.max(this.maxZ, z + radius);
  }

  include2D(x: number, y: number, halfWidth: number, halfHeight: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(halfWidth) || !Number.isFinite(halfHeight)) {
      throw new Error('Invalid Replay privacy particle geometry');
    }
    this.minX = Math.min(this.minX, x - halfWidth); this.maxX = Math.max(this.maxX, x + halfWidth);
    this.minY = Math.min(this.minY, y - halfHeight); this.maxY = Math.max(this.maxY, y + halfHeight);
    this.minZ = 0; this.maxZ = 0;
  }

  toWorld(node: any, geometry: PrivacyGeometry): ParticleWorldBounds {
    if (this.minX === Infinity) return this;
    const result = new ParticleWorldBounds();
    for (const point of privacyBoxPoints(
      { x: this.minX, y: this.minY, z: this.minZ }, { x: this.maxX, y: this.maxY, z: this.maxZ })) {
      result.include(geometry.toWorld(node, point));
    }
    return result;
  }

  project(geometry: PrivacyGeometry, crossingFallback: () => PrivacyBounds | undefined): PrivacyBounds | undefined {
    if (this.minX === Infinity) return undefined;
    try {
      return projectPrivacyPoints(privacyBoxPoints(
        { x: this.minX, y: this.minY, z: this.minZ }, { x: this.maxX, y: this.maxY, z: this.maxZ }), geometry);
    } catch (error) {
      // A combined box can cross the camera plane even when separate particles
      // do not. Preserve the per-particle visibility rules in that rare case.
      if (error === CAMERA_PLANE_ERROR) return crossingFallback();
      throw error;
    }
  }
}

function meshBounds(mesh: any, node: any, geometry: PrivacyGeometry): PrivacyBounds | undefined {
  if (!mesh.mesh) return undefined;
  const world = mesh.model?.worldBounds;
  if (world?.center && world?.halfExtents) {
    const c = world.center; const h = world.halfExtents;
    return projectPrivacyPoints(privacyBoxPoints({ x: c.x - h.x, y: c.y - h.y, z: c.z - h.z },
      { x: c.x + h.x, y: c.y + h.y, z: c.z + h.z }), geometry);
  }
  // Skinned geometry cannot be bounded by the undeformed source mesh.
  if (mesh.skeleton || mesh.skinningRoot) throw new Error('Missing Replay privacy skinned bounds');
  const source = mesh.mesh;
  const min = source._minPos || source.struct?.minPosition || source.minPosition;
  const max = source._maxPos || source.struct?.maxPosition || source.maxPosition;
  if (!min || !max) throw new Error('Missing Replay privacy mesh bounds');
  return localBox(node, min, max, geometry);
}

function particles2D(system: any, node: any, geometry: PrivacyGeometry, aggregate = true): PrivacyBounds | undefined {
  const simulation = system._simulator;
  const particles = simulation?.particles;
  const space = system.positionType;
  const basis = space === 1 ? node.parent : space === 2 ? node : undefined;
  const world = (point: PrivacyPoint): PrivacyPoint => basis ? geometry.toWorld(basis, point) : point;
  if (![0, 1, 2].includes(space)) throw new Error('Unknown Replay privacy particle space');
  let bounds: PrivacyBounds | undefined;
  if (!particles) {
    if (system.particleCount === 0) return undefined;
    const box = geometry.nativeParticleBounds?.(node._proxy);
    if (!box || box.length !== 6) throw new Error('Missing Replay privacy native particle bounds');
    return projectPrivacyPoints(privacyBoxPoints({ x: box[0]!, y: box[1]!, z: box[2]! },
      { x: box[3]!, y: box[4]!, z: box[5]! }), geometry);
  }
  const worldBounds = aggregate ? new ParticleWorldBounds() : undefined;
  for (const particle of particles) {
    const position = particle.pos; const start = space === 2 ? { x: 0, y: 0 } : particle.startPos;
    const size = particle.size; const aspect = particle.aspectRatio;
    if (!position || !start || !Number.isFinite(size) || size < 0 || !Number.isFinite(aspect) || aspect <= 0) {
      throw new Error('Invalid Replay privacy particle geometry');
    }
    const hw = size * Math.min(1, aspect) / 2; const hh = size / Math.max(1, aspect) / 2;
    const rotation = -particle.rotation * Math.PI / 180;
    if (!Number.isFinite(rotation)) throw new Error('Invalid Replay privacy particle rotation');
    const cosine = Math.cos(rotation); const sine = Math.sin(rotation);
    if (worldBounds) {
      // Rotated-quad extents are exact in simulation space. Combine scalars
      // before transforming so large emitters do not allocate four points per particle.
      worldBounds.include2D(position.x + start.x, position.y + start.y,
        Math.abs(hw * cosine) + Math.abs(hh * sine), Math.abs(hw * sine) + Math.abs(hh * cosine));
      continue;
    }
    const points: PrivacyPoint[] = [];
    for (const x of [-hw, hw]) for (const y of [-hh, hh]) {
      const point = world({ x: position.x + start.x + x * cosine - y * sine,
        y: position.y + start.y + x * sine + y * cosine, z: 0 });
      points.push(point);
    }
    bounds = merge(bounds, projectPrivacyPoints(points, geometry));
  }
  const combined = worldBounds && (basis ? worldBounds.toWorld(basis, geometry) : worldBounds);
  return combined ? combined.project(geometry, () => particles2D(system, node, geometry, false)) : bounds;
}

function particles3D(system: any, node: any, geometry: PrivacyGeometry, aggregate = true): PrivacyBounds | undefined {
  const processor = geometry.creator === 2 ? system._assembler : system.processor;
  const renderer = geometry.creator === 2 ? system : system.renderer;
  if (renderer?.useGPU || system.trailModule?.enable) throw new Error('Unsupported Replay privacy particle renderer');
  const pool = processor?._particles;
  if (!pool || !pool.data || !Number.isInteger(pool.length) || pool.length < 0 || pool.length > pool.data.length) {
    throw new Error('Missing Replay privacy particle geometry');
  }
  if (system.simulationSpace !== 0 && system.simulationSpace !== 1) throw new Error('Unknown Replay privacy particle space');
  const scale = processor._node_scale;
  if (!scale || !valid(scale)) throw new Error('Missing Replay privacy particle scale');
  const renderMode = renderer.renderMode;
  let meshRadius = 0;
  if (renderMode === 4) {
    const mesh = renderer.mesh;
    const min = mesh?._minPos || mesh?.struct?.minPosition || mesh?.minPosition;
    const max = mesh?._maxPos || mesh?.struct?.maxPosition || mesh?.maxPosition;
    if (!min || !max) throw new Error('Missing Replay privacy particle mesh bounds');
    meshRadius = Math.max(...privacyBoxPoints(min, max).map(p => Math.hypot(p.x, p.y, p.z ?? 0)));
  } else if (![0, 1, 2, 3].includes(renderMode)) throw new Error('Unknown Replay privacy particle render mode');
  let bounds: PrivacyBounds | undefined;
  const worldBounds = aggregate ? new ParticleWorldBounds() : undefined;
  for (let i = 0; i < pool.length; i++) {
    const particle = pool.data[i]; const size = particle.size;
    if (!size || !valid(size)) throw new Error('Invalid Replay privacy particle size');
    const center = system.simulationSpace === 1 ? geometry.toWorld(node, particle.position) : particle.position;
    let radius = renderMode === 4 ? meshRadius * Math.max(Math.abs(size.x * scale.x), Math.abs(size.y * scale.y), Math.abs(size.z * scale.z))
      : Math.hypot(size.x * scale.x, size.y * scale.y) / 2;
    if (renderMode === 1) {
      const velocity = particle.ultimateVelocity;
      if (!velocity || !valid(velocity) || !Number.isFinite(renderer.velocityScale) || !Number.isFinite(renderer.lengthScale)) {
        throw new Error('Invalid Replay privacy stretched particle');
      }
      const end = system.simulationSpace === 1 ? geometry.toWorld(node, {
        x: particle.position.x + velocity.x, y: particle.position.y + velocity.y, z: particle.position.z + velocity.z,
      }) : { x: center.x + velocity.x, y: center.y + velocity.y, z: (center.z ?? 0) + velocity.z };
      radius = Math.abs(size.x * scale.x) / 2 + Math.abs(size.y * scale.y * renderer.lengthScale)
        + Math.hypot(end.x - center.x, end.y - center.y, (end.z ?? 0) - (center.z ?? 0)) * Math.abs(renderer.velocityScale);
    }
    if (worldBounds) worldBounds.include(center, radius);
    else bounds = merge(bounds, projectPrivacyPoints(privacyBoxPoints(
      { x: center.x - radius, y: center.y - radius, z: (center.z ?? 0) - radius },
      { x: center.x + radius, y: center.y + radius, z: (center.z ?? 0) + radius }), geometry));
  }
  return worldBounds ? worldBounds.project(geometry, () => particles3D(system, node, geometry, false)) : bounds;
}

/** Keep native world renderers independent of the UI stencil hierarchy. */
export function rendererPrivacyBounds(node: any, geometry: PrivacyGeometry): { clipped?: PrivacyBounds; unclipped?: PrivacyBounds } {
  const particle2D = component(node, geometry.creator === 2 ? 'cc.ParticleSystem' : 'cc.ParticleSystem2D');
  const particle3D = component(node, geometry.creator === 2 ? 'cc.ParticleSystem3D' : 'cc.ParticleSystem');
  const mesh = component(node, 'cc.MeshRenderer');
  const uiModel = component(node, 'cc.UIMeshRenderer');
  let clipped = particle2D && particles2D(particle2D, node, geometry);
  let world = particle3D && particles3D(particle3D, node, geometry);
  if (mesh) world = merge(world, meshBounds(mesh, node, geometry));
  if (uiModel) clipped = merge(clipped, world);
  return { clipped: rasterBounds(clipped), unclipped: uiModel ? undefined : rasterBounds(world) };
}
