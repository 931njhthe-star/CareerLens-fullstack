import * as THREE from 'three';
import { lineFragment, lineVertex, pointFragment, pointVertex } from './shaders.ts';
import type { MatchingJob } from './data.ts';

export type Position = [number, number, number];
export type RGB = [number, number, number];

export interface Stroke {
  points: Position[];
  start: number;
  duration: number;
  width: number;
  color: RGB;
}

/** Continuous anti-aliased strips retain the original film's fine line detail. */
export function createStrokes(strokes: Stroke[]) {
  const positions: number[] = [];
  const sides: number[] = [];
  const distances: number[] = [];
  const widths: number[] = [];
  const starts: number[] = [];
  const durations: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const stroke of strokes) {
    const { points } = stroke;
    const base = positions.length / 3;
    const lengths = [0];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      lengths.push(
        lengths[index - 1] + Math.hypot(current[0] - previous[0], current[1] - previous[1]),
      );
    }
    const total = lengths[lengths.length - 1] || 1;

    for (let index = 0; index < points.length; index += 1) {
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const length = Math.hypot(next[0] - previous[0], next[1] - previous[1]) || 1;
      const normalX = -(next[1] - previous[1]) / length;
      const normalY = (next[0] - previous[0]) / length;

      for (const side of [-1, 1]) {
        positions.push(
          points[index][0] + normalX * (stroke.width + 0.8) * side,
          points[index][1] + normalY * (stroke.width + 0.8) * side,
          points[index][2],
        );
        sides.push(side);
        widths.push(stroke.width);
        distances.push(lengths[index] / total);
        starts.push(stroke.start);
        durations.push(stroke.duration);
        colors.push(...stroke.color);
      }

      if (index < points.length - 1) {
        const vertex = base + index * 2;
        indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  for (const [name, values, size] of [
    ['position', positions, 3],
    ['aSide', sides, 1],
    ['aWidth', widths, 1],
    ['aDistance', distances, 1],
    ['aStart', starts, 1],
    ['aDuration', durations, 1],
    ['aColor', colors, 3],
  ] as const) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
  }
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    // Normal alpha compositing prevents hundreds of crossing rays adding into
    // a white bloom mass; the separate résumé light keeps its gold emission.
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

/** This is the only white-point batch: one vertex per supplied job ID. */
export function createJobPoints(jobs: MatchingJob[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      jobs.flatMap((job) => [job.x, job.y, 3]),
      3,
    ),
  );
  geometry.setAttribute(
    'aIndex',
    new THREE.Float32BufferAttribute(
      jobs.map((_, index) => index),
      1,
    ),
  );
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uHighlight: { value: -1 },
      uPointSize: { value: 3.5 },
    },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

export function arc(radius: number, start = -Math.PI / 2, span = Math.PI * 2): Position[] {
  const segments = 180;
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = start + (index / segments) * span;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius, 0];
  });
}

export function eyeBoundary(upper: boolean): Position[] {
  return Array.from({ length: 161 }, (_, index) => {
    const progress = index / 160;
    const x = upper ? -442 + progress * 884 : 442 - progress * 884;
    const y = Math.sin(progress * Math.PI) * (upper ? 231 : -231);
    return [x, y, 0];
  });
}
