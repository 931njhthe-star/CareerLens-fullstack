import { fibreSegment } from './analysis-fibres.ts';
import type { AnalysisFibre } from './analysis-fibres.ts';

/** WebGL camera, SVG viewBox and callout tips share the same orthographic view. */
export function analysisViewport(width: number, height: number) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const aspect = safeWidth / safeHeight;
  const halfWidth = safeWidth < 700 ? Math.max(375, 210 * aspect) : Math.max(500, 230 * aspect);
  return { width: safeWidth, height: safeHeight, halfWidth, halfHeight: halfWidth / aspect };
}

export const analysisFoldScale = (fold: number, reducedMotion: boolean): number =>
  reducedMotion ? 1 : Math.max(0.001, Math.cos((fold * Math.PI) / 2));

export function projectFibreTip(
  fibre: AnalysisFibre,
  progress: number,
  width: number,
  height: number,
  fold = 0,
  reducedMotion = false,
): { x: number; y: number; growth: number } {
  const view = analysisViewport(width, height);
  const { tip, growth } = fibreSegment(fibre, progress);
  return {
    x: ((tip[0] / view.halfWidth + 1) * view.width) / 2,
    y:
      ((1 - (tip[1] * analysisFoldScale(fold, reducedMotion)) / view.halfHeight) * view.height) / 2,
    growth,
  };
}
