import { fibreGrowth } from './analysis-fibres.ts';
import type { CriterionFibreAssignment } from './analysis-criteria.ts';
import { analysisFoldScale, analysisViewport } from './analysis-projection.ts';
import { MIN_ANALYSIS_PRESENTATION_MS, smoothstep } from './analysis-timing.ts';

export const LIQUID_INNER_RADIUS = 62;
export const LIQUID_OUTER_RADIUS = 164;
const TAU = Math.PI * 2;
const angleOf = (angle: number): number => ((angle % TAU) + TAU) % TAU;
const clamp = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

export interface LiquidKnot {
  assignment: CriterionFibreAssignment;
  angle: number;
}

/** Stable angular bindings, shared by the filled surface and its callout anchors. */
export function createLiquidKnots(assignments: readonly CriterionFibreAssignment[]): LiquidKnot[] {
  return assignments
    .map((assignment) => ({ assignment, angle: angleOf(assignment.fibre.angle) }))
    .sort((a, b) => a.angle - b.angle);
}

/** A single periodic water frontier, expanding radially out of an empty pupil.
 * The twelve heights represent presentation progress, never actual server scores.
 */
export function liquidFrontier(
  knots: readonly LiquidKnot[],
  angle: number,
  progress: number,
  elapsedMs = 0,
  reducedMotion = false,
): { radius: number; growth: number; point: [number, number] } {
  const value = clamp(progress);
  const theta = Number.isFinite(angle) ? angleOf(angle) : 0;
  let growth = value;
  if (knots.length) {
    let right = knots.findIndex((knot) => knot.angle >= theta);
    if (right < 0) right = 0;
    const left = (right + knots.length - 1) % knots.length;
    const span = angleOf(knots[right].angle - knots[left].angle) || TAU;
    const blend = smoothstep(angleOf(theta - knots[left].angle) / span);
    const start = fibreGrowth(knots[left].assignment.fibre, value);
    const end = fibreGrowth(knots[right].assignment.fibre, value);
    growth = start + (end - start) * blend;
  }
  // The ripples are displacements of a filled surface, not stroked concentric gauges.
  // They settle at both boundaries; no point can enter the pupil or cross the iris.
  const time = reducedMotion || !Number.isFinite(elapsedMs) ? 0 : elapsedMs / 1000;
  const ripple = reducedMotion
    ? 0
    : Math.sin(theta * 9 - time * 1.65) * 0.028 + Math.sin(theta * 17 + time * 1.1) * 0.011;
  growth = clamp(growth + ripple * 4 * growth * (1 - growth));
  if (value < 1) growth = Math.min(growth, 0.999999);
  const radius = LIQUID_INNER_RADIUS + (LIQUID_OUTER_RADIUS - LIQUID_INNER_RADIUS) * growth;
  return { radius, growth, point: [Math.cos(theta) * radius, Math.sin(theta) * radius] };
}

export function liquidPaths(
  knots: readonly LiquidKnot[],
  progress: number,
  elapsedMs: number,
  reducedMotion: boolean,
): { area: string; frontier: string } {
  const points = Array.from({ length: 240 }, (_, index) => {
    const { point } = liquidFrontier(
      knots,
      (index / 240) * TAU,
      progress,
      elapsedMs,
      reducedMotion,
    );
    return `${point[0].toFixed(2)} ${(-point[1]).toFixed(2)}`;
  });
  const frontier = `M${points.join('L')}Z`;
  const r = LIQUID_INNER_RADIUS;
  const pupilHole = `M${r} 0A${r} ${r} 0 1 0 ${-r} 0A${r} ${r} 0 1 0 ${r} 0Z`;
  return { area: `${frontier}${pupilHole}`, frontier };
}

export function projectLiquidTip(
  knots: readonly LiquidKnot[],
  angle: number,
  progress: number,
  elapsedMs: number,
  width: number,
  height: number,
  fold = 0,
  reducedMotion = false,
): { x: number; y: number; growth: number } {
  const { point, growth } = liquidFrontier(knots, angle, progress, elapsedMs, reducedMotion);
  const view = analysisViewport(width, height);
  return {
    x: ((point[0] / view.halfWidth + 1) * view.width) / 2,
    y:
      ((1 - (point[1] * analysisFoldScale(fold, reducedMotion)) / view.halfHeight) * view.height) /
      2,
    growth,
  };
}

export interface AnalysisEyeEntrance {
  rotation?: number;
  durationMs?: number;
  delayMs?: number;
}

export function eyeEntranceFrame(
  elapsedMs: number,
  options?: AnalysisEyeEntrance,
  reducedMotion = false,
) {
  const duration =
    !options || reducedMotion
      ? 0
      : Math.max(
          300,
          Math.min(1200, Number.isFinite(options.durationMs) ? options.durationMs! : 720),
        );
  const delay =
    !options || reducedMotion
      ? 0
      : Math.max(0, Math.min(1500, Number.isFinite(options.delayMs) ? options.delayMs! : 0));
  const elapsed = Math.max(0, (Number.isFinite(elapsedMs) ? elapsedMs : 0) - delay);
  const phase = duration ? Math.min(1, elapsed / duration) : 1;
  const eyeElapsed = Math.max(0, elapsed - duration);
  const initialRotation = Number.isFinite(options?.rotation) ? options!.rotation! : 0;
  return {
    duration,
    delay,
    eyeElapsed,
    // Three groups of four remain visible even when a bridge precedes the eye.
    calloutElapsed:
      (eyeElapsed * MIN_ANALYSIS_PRESENTATION_MS) /
      (MIN_ANALYSIS_PRESENTATION_MS - duration - delay),
    fillReveal: duration ? smoothstep((elapsed - duration) / 360) : 1,
    radius: 126 - 65 * smoothstep((phase - 0.22) / 0.78),
    rotation: initialRotation + phase * 2.6 + phase ** 3 * 15,
    opacity: duration ? 1 - smoothstep((elapsed - duration) / 200) : 0,
    synchronized: phase === 1,
  };
}
