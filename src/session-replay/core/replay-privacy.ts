import type { FTPrivacyRegion } from './types.js';

interface FTPoint {
  x: number;
  y: number;
}

interface FTRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Projects a world-space node rectangle into a top-left-origin Replay frame. */
export function projectPrivacyBounds(
  bounds: FTRect,
  frameWidth: number,
  frameHeight: number,
  screenWidth: number,
  screenHeight: number,
  project: (x: number, y: number) => FTPoint | undefined,
): Omit<FTPrivacyRegion, 'mode'> | undefined {
  if ([frameWidth, frameHeight, screenWidth, screenHeight].some((size) => !Number.isFinite(size) || size <= 0)) {
    return undefined;
  }
  const points = [
    project(bounds.x, bounds.y),
    project(bounds.x + bounds.width, bounds.y),
    project(bounds.x, bounds.y + bounds.height),
    project(bounds.x + bounds.width, bounds.y + bounds.height),
  ];
  if (points.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return undefined;
  }
  const projected = points as FTPoint[];
  const minimumX = Math.min(...projected.map((point) => point.x));
  const maximumX = Math.max(...projected.map((point) => point.x));
  const minimumY = Math.min(...projected.map((point) => point.y));
  const maximumY = Math.max(...projected.map((point) => point.y));
  // A native projection can reject its input without throwing and return a
  // zero vector. Do not treat its zero-area result as a valid privacy mask.
  if (maximumX <= minimumX || maximumY <= minimumY) return undefined;
  const scaleX = frameWidth / screenWidth;
  const scaleY = frameHeight / screenHeight;
  return {
    x: minimumX * scaleX,
    y: (screenHeight - maximumY) * scaleY,
    width: (maximumX - minimumX) * scaleX,
    height: (maximumY - minimumY) * scaleY,
  };
}
