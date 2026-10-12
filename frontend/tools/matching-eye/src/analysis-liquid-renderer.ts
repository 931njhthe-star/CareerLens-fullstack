import { analysisFoldScale, analysisViewport } from './analysis-projection.ts';
import { LIQUID_INNER_RADIUS, LIQUID_OUTER_RADIUS, liquidPaths } from './analysis-liquid.ts';
import type { LiquidKnot } from './analysis-liquid.ts';
import { EYE_DRAW_MS, smoothstep } from './analysis-timing.ts';

const ns = 'http://www.w3.org/2000/svg';
let nextId = 0;
function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

/** Filled annular water in an SVG: identical geometry with or without WebGL. */
export class AnalysisLiquidRenderer {
  readonly svg = svg('svg', {
    class: 'cl-analysis-eye__fallback',
    'aria-hidden': 'true',
    preserveAspectRatio: 'xMidYMid meet',
  });
  private readonly eye = svg('g');
  private readonly area: SVGPathElement;
  private readonly frontier: SVGPathElement;
  private readonly outlines: SVGGeometryElement[];
  private pausedTime = 0;

  constructor(private readonly knots: readonly LiquidKnot[]) {
    const id = `cl-eye-water-${++nextId}`;
    const defs = svg('defs');
    const gradient = svg('linearGradient', {
      id,
      x1: '-150',
      y1: '-150',
      x2: '130',
      y2: '170',
      gradientUnits: 'userSpaceOnUse',
    });
    gradient.append(
      svg('stop', { offset: '0', 'stop-color': 'var(--eye-highlight, #35d8e7)' }),
      svg('stop', { offset: '.42', 'stop-color': 'var(--eye-fiber, #2361ed)' }),
      svg('stop', { offset: '1', 'stop-color': 'var(--eye-outline, #1748be)' }),
    );
    defs.append(gradient);
    this.area = svg('path', {
      fill: `url(#${id})`,
      'fill-rule': 'evenodd',
      'fill-opacity': '.84',
      'data-liquid-area': 'true',
    });
    this.frontier = svg('path', {
      fill: 'none',
      stroke: 'var(--eye-highlight, #35d8e7)',
      'stroke-width': '1.5',
      'stroke-opacity': '.86',
      'data-liquid-frontier': 'true',
    });
    const outer = svg('circle', {
      r: String(LIQUID_OUTER_RADIUS),
      stroke: 'var(--eye-outline, #1748be)',
      'stroke-opacity': '.2',
      'stroke-width': '.8',
      fill: 'none',
      pathLength: '100',
    });
    const pupil = svg('circle', {
      r: String(LIQUID_INNER_RADIUS - 1),
      stroke: `url(#${id})`,
      'stroke-width': '1.8',
      fill: 'none',
      pathLength: '100',
    });
    const lids = ['M-352 0Q0-365 352 0', 'M352 0Q0 365-352 0'].map((d) =>
      svg('path', {
        d,
        stroke: `url(#${id})`,
        'stroke-width': '1.8',
        'stroke-opacity': '.82',
        fill: 'none',
        pathLength: '100',
      }),
    );
    this.outlines = [...lids, outer, pupil];
    this.eye.append(outer, this.area, this.frontier, pupil, ...lids);
    this.svg.append(defs, this.eye);
  }

  resize(width: number, height: number): void {
    const { halfWidth, halfHeight } = analysisViewport(width, height);
    this.svg.setAttribute(
      'viewBox',
      `${-halfWidth} ${-halfHeight} ${halfWidth * 2} ${halfHeight * 2}`,
    );
  }

  render(
    elapsedMs: number,
    progress: number,
    fold: number,
    reducedMotion: boolean,
    failed: boolean,
  ): void {
    if (!failed) this.pausedTime = elapsedMs;
    const reveal = reducedMotion ? 1 : smoothstep(elapsedMs / 480);
    const paths = liquidPaths(this.knots, progress, this.pausedTime, reducedMotion);
    this.area.setAttribute('d', paths.area);
    this.frontier.setAttribute('d', paths.frontier);
    this.area.setAttribute('opacity', String(reveal));
    this.frontier.setAttribute('opacity', String(reveal * (progress > 0 ? 1 : 0)));
    this.area.style.filter = failed ? 'saturate(.35)' : '';
    this.outlines.forEach((outline) =>
      outline.setAttribute(
        'stroke-dasharray',
        `${100 * (reducedMotion ? 1 : smoothstep(elapsedMs / EYE_DRAW_MS))} 100`,
      ),
    );
    this.eye.setAttribute('transform', `scale(1 ${analysisFoldScale(fold, reducedMotion)})`);
  }

  dispose(): void {
    this.svg.remove();
  }
}

/** Ring keeps turning as it accelerates into the fixed pupil, before the lids draw. */
export function createEntranceRing(): { svg: SVGSVGElement; ring: SVGGElement } {
  const root = svg('svg', {
    class: 'cl-analysis-eye__entrance',
    'aria-hidden': 'true',
    preserveAspectRatio: 'xMidYMid meet',
  });
  const ring = svg('g');
  ring.append(
    svg('circle', {
      r: '61',
      fill: 'none',
      stroke: 'var(--eye-fiber, #2361ed)',
      'stroke-width': '3',
      'stroke-opacity': '.4',
    }),
  );
  for (const [start, length, color, width] of [
    [0, 2.7, 'var(--eye-fiber, #2361ed)', 4],
    [3.3, 1.4, 'var(--eye-highlight, #35d8e7)', 4],
    [5.0, 0.65, 'var(--eye-highlight, #35d8e7)', 2],
  ] as const) {
    const end = start + length;
    const d = `M${Math.cos(start) * 61} ${Math.sin(start) * 61}A61 61 0 0 1 ${Math.cos(end) * 61} ${Math.sin(end) * 61}`;
    ring.append(
      svg('path', {
        d,
        fill: 'none',
        stroke: color,
        'stroke-width': String(width),
        'stroke-linecap': 'round',
      }),
    );
  }
  root.append(ring);
  return { svg: root, ring };
}
