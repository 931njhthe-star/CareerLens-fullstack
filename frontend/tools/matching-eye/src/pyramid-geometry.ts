export type Point3 = [number, number, number];

/** A regular tetrahedron centred at its centroid; each vertex is one 100-point axis. */
export const PYRAMID_VERTICES: readonly Point3[] = [
  [0, 1.28, 0],
  [0, -1.28 / 3, 1.28 * Math.sqrt(8 / 9)],
  [-1.28 * Math.sqrt(2 / 3), -1.28 / 3, -1.28 * Math.sqrt(2 / 9)],
  [1.28 * Math.sqrt(2 / 3), -1.28 / 3, -1.28 * Math.sqrt(2 / 9)],
];

export const PYRAMID_FACES = [0, 2, 1, 0, 3, 2, 0, 1, 3, 1, 2, 3] as const;
export const PYRAMID_EDGES = [0, 1, 0, 2, 0, 3, 1, 2, 2, 3, 3, 1] as const;

/** A full yaw envelope keeps automatic rotation steady; only viewport/pitch changes refit it. */
export function pyramidFraming(width: number, height: number, pitch: number) {
  const radius = 1.28 * Math.sqrt(8 / 9);
  let minY = Infinity,
    maxY = -Infinity,
    extentX = 0;
  const include = (x: number, y: number, z: number) => {
    const ry = y * Math.cos(pitch) - z * Math.sin(pitch);
    const depth = y * Math.sin(pitch) + z * Math.cos(pitch);
    const perspective = 5.6 / (5.6 - depth);
    extentX = Math.max(extentX, Math.abs(x * perspective));
    minY = Math.min(minY, -ry * perspective);
    maxY = Math.max(maxY, -ry * perspective);
  };
  include(0, 1.28, 0);
  for (let index = 0; index < 96; index++) {
    const angle = (index / 96) * Math.PI * 2;
    include(Math.sin(angle) * radius, -1.28 / 3, Math.cos(angle) * radius);
  }
  const padding = Math.min(24, Math.min(width, height) * 0.09);
  return {
    centerY: (minY + maxY) / 2,
    // Tiny envelope allowance covers angles between the sampled positions.
    scale:
      Math.min(
        (width - padding * 2) / (extentX * 2.002),
        (height - padding * 2) / ((maxY - minY) * 1.001),
      ) / 1.16,
  };
}

export function pyramidPoints(scores: readonly number[]): Point3[] {
  return PYRAMID_VERTICES.map((vertex, index) => {
    const score = scores[index];
    const fraction = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) / 100 : 0;
    return vertex.map((value) => value * fraction) as Point3;
  });
}

/** Quintic easing starts and ends with zero velocity and acceleration. */
export function pyramidEase(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function interpolateScores(
  from: readonly number[],
  to: readonly number[],
  progress: number,
): number[] {
  const mix = pyramidEase(progress);
  return from.map((value, index) => value + (to[index] - value) * mix);
}
