import { normalizeAnalysis } from './analysis-state.ts';
import { AnalysisEyeRenderer, EYE_BACKGROUND } from './analysis-renderer.ts';
import type { AnalysisEyePalette } from './analysis-renderer.ts';
import {
  AnalysisTimeline,
  ANALYSIS_FOLD_MS,
  EYE_DRAW_MS,
  calloutFrame,
  criterionCalloutFrame,
  smoothstep,
} from './analysis-timing.ts';
import { analysisReadouts } from './analysis-readouts.ts';
import type { AnalysisReadout, AnalysisPurpose } from './analysis-readouts.ts';
import { analysisStyles } from './analysis-styles.ts';
import {
  createAnalysisFibres,
  fibreCountForWidth,
  fibrePoint,
  fibreSegment,
  groupFibreProgress,
} from './analysis-fibres.ts';
import type { AnalysisFibre } from './analysis-fibres.ts';
import {
  assignCriterionFibres,
  createAnalysisRunSeed,
  criterionAssignmentsForSlot,
} from './analysis-criteria.ts';
import { analysisFoldScale, analysisViewport, projectFibreTip } from './analysis-projection.ts';
import {
  createLiquidKnots,
  eyeEntranceFrame,
  liquidFrontier,
  projectLiquidTip,
} from './analysis-liquid.ts';
import type { AnalysisEyeEntrance } from './analysis-liquid.ts';
import { AnalysisLiquidRenderer, createEntranceRing } from './analysis-liquid-renderer.ts';

const mounts = new WeakMap<HTMLElement, () => void>();
const ns = 'http://www.w3.org/2000/svg';
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

interface Panel {
  root: HTMLDivElement;
  label: HTMLHeadingElement;
  state: HTMLSpanElement;
  detail: HTMLParagraphElement;
  fill: HTMLSpanElement;
  leader: SVGGElement;
  line: SVGPathElement;
  anchor: SVGCircleElement;
  sequence: number;
  readout: AnalysisReadout | null;
  fibre: AnalysisFibre | null;
}
function makePanel(leaders: SVGSVGElement): Panel {
  const root = element('div', 'cl-analysis-eye__panel');
  const header = element('div', 'cl-analysis-eye__panel-header');
  const label = element('h3', 'cl-analysis-eye__label');
  const state = element('span', 'cl-analysis-eye__state');
  const detail = element('p', 'cl-analysis-eye__detail');
  const measure = element('div', 'cl-analysis-eye__measure');
  const fill = element('span', 'cl-analysis-eye__measure-fill');
  measure.append(fill);
  header.append(label, state);
  root.append(header, detail, measure);
  const leader = svgElement('g');
  const line = svgElement('path', { class: 'cl-analysis-eye__leader-track', pathLength: '1' });
  const anchor = svgElement('circle', { r: '2', class: 'cl-analysis-eye__anchor' });
  leader.append(line, anchor);
  leaders.append(leader);
  return {
    root,
    label,
    state,
    detail,
    fill,
    leader,
    line,
    anchor,
    sequence: -1,
    readout: null,
    fibre: null,
  };
}

interface FallbackFibre {
  descriptor: AnalysisFibre;
  path: SVGPathElement;
  tip: SVGCircleElement;
}
interface Fallback {
  svg: SVGSVGElement;
  group: SVGGElement;
  outlines: SVGGeometryElement[];
  fibres: FallbackFibre[];
}
function makeFallback(transparentSurface: boolean, descriptors: AnalysisFibre[]): Fallback {
  const svg = svgElement('svg', {
    viewBox: '-500 -240 1000 480',
    preserveAspectRatio: 'xMidYMid meet',
    class: 'cl-analysis-eye__fallback',
    'aria-hidden': 'true',
  });
  const group = svgElement('g');
  const outlines: SVGGeometryElement[] = ['M-352 0Q0-365 352 0', 'M352 0Q0 365-352 0'].map((d) =>
    svgElement('path', {
      d,
      stroke: `var(--eye-outline, ${transparentSurface ? '#d0d6bf' : '#a5ad98'})`,
      fill: 'none',
      'stroke-width': transparentSurface ? '1.6' : '1',
      pathLength: '100',
    }),
  );
  group.append(...outlines);
  const fibres = descriptors.map((descriptor): FallbackFibre => {
    const path = svgElement('path', {
      fill: 'var(--eye-fiber, #d9b77c)',
      'data-fibre-group': descriptor.group,
      'data-fibre-id': String(descriptor.id),
    });
    const tip = svgElement('circle', {
      r: '.65',
      fill: 'var(--eye-highlight, #fff0c7)',
      opacity: '0',
    });
    group.append(path, tip);
    return { descriptor, path, tip };
  });
  for (const radius of [61, 164]) {
    const pupil = transparentSurface && radius === 61;
    const ring = svgElement('circle', {
      r: String(radius),
      stroke: pupil ? 'var(--eye-highlight, #e5c273)' : 'var(--eye-outline, #6c705e)',
      fill: 'none',
      'stroke-width': pupil ? '1.3' : '.65',
      pathLength: '100',
    });
    outlines.push(ring);
    group.append(ring);
  }
  if (!transparentSurface)
    group.append(
      svgElement('circle', { r: '60', fill: `var(--eye-background, ${EYE_BACKGROUND})` }),
    );
  svg.append(group);
  return { svg, group, outlines, fibres };
}

export interface AnalysisEyeOptions {
  surface?: 'card' | 'overlay';
  purpose?: AnalysisPurpose;
  palette?: AnalysisEyePalette;
  /** Radial remains the default and the original renderer is kept for rollback. */
  gauge?: 'liquid' | 'radial';
  /** Rotation is in radians; the API request and four-second minimum run concurrently. */
  entrance?: AnalysisEyeEntrance;
}

/** Actual API stages control completion; only their presentation has a minimum duration. */
export function mountAnalysisEye(
  container: HTMLElement,
  initial?: unknown,
  options: AnalysisEyeOptions = {},
): {
  update(value: unknown): void;
  finish(options?: { fold?: boolean }): Promise<void>;
  dispose(): void;
} {
  mounts.get(container)?.();
  const startedAt = performance.now();
  const timeline = new AnalysisTimeline(startedAt);
  let snapshot = normalizeAnalysis(initial);
  const transparentSurface = options.surface === 'overlay';
  const purpose = options.purpose === 'report' ? 'report' : 'preparation';
  const liquid = options.gauge === 'liquid';
  // One geometry and binding set survives API updates, resize and SVG fallback.
  const panelFibres = createAnalysisFibres(fibreCountForWidth(container.clientWidth));
  let readouts = analysisReadouts(initial, snapshot, purpose);
  const assignments = assignCriterionFibres(
    readouts.map(({ id }, index) => (purpose === 'report' ? id : `topic-${index}`)),
    panelFibres,
    createAnalysisRunSeed(),
  );
  const liquidKnots = createLiquidKnots(assignments);
  let compact = container.clientWidth < 700;
  const abort = new AbortController();
  const { signal } = abort;
  const root = element('div', 'cl-analysis-eye');
  for (const key of ['fiber', 'highlight', 'outline', 'background', 'panel', 'text'] as const) {
    const color = options.palette?.[key];
    if (color) root.style.setProperty(`--eye-${key}`, color);
  }
  if (options.palette?.outline) {
    root.style.setProperty(
      '--eye-panel-border',
      'color-mix(in srgb, var(--eye-outline) 32%, transparent)',
    );
    root.style.setProperty(
      '--eye-divider',
      'color-mix(in srgb, var(--eye-outline) 18%, transparent)',
    );
  }
  root.dataset.surface = transparentSurface ? 'overlay' : 'card';
  root.dataset.purpose = purpose;
  root.dataset.gauge = liquid ? 'liquid' : 'radial';
  const style = element('style');
  style.textContent = analysisStyles;
  const scene = element('div', 'cl-analysis-eye__scene');
  const visual = element('div', 'cl-analysis-eye__visual');
  const canvas = element('canvas', 'cl-analysis-eye__canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const leaders = svgElement('svg', {
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
    class: 'cl-analysis-eye__leaders',
  });
  const panelList = element('div', 'cl-analysis-eye__panels');
  panelList.setAttribute('aria-hidden', 'true');
  const panels = Array.from({ length: purpose === 'report' ? 4 : 2 }, () => makePanel(leaders));
  panelList.append(...panels.map((panel) => panel.root));
  const accessibleStages = element('ol', 'cl-analysis-eye__sr-only');
  accessibleStages.setAttribute('aria-label', '실제 분석 단계');
  const stageItems = snapshot.stages.map(() => element('li'));
  accessibleStages.append(...stageItems);
  const progress = element('div', 'cl-analysis-eye__sr-only');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', '분석 화면 시각화 진행');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  const summary = element('div', 'cl-analysis-eye__summary');
  const summaryMessage = element('span');
  summaryMessage.setAttribute('role', 'status');
  summaryMessage.setAttribute('aria-live', 'polite');
  const percent = element('strong');
  percent.setAttribute('aria-hidden', 'true');
  summary.append(summaryMessage, percent);
  const note = element(
    'p',
    'cl-analysis-eye__note',
    liquid
      ? '물결과 게이지는 시각화 진행이며, 항목별 평가 결과가 아닙니다.'
      : options.palette?.fiber
        ? '선과 게이지는 시각화 진행이며, 항목별 평가 결과가 아닙니다.'
        : '금빛 선과 게이지는 시각화 진행이며, 항목별 평가 결과가 아닙니다.',
  );
  visual.append(canvas);
  const entrance = options.entrance ? createEntranceRing() : null;
  if (entrance) visual.append(entrance.svg);
  scene.append(visual, leaders, panelList);
  root.append(style, scene, summary, note, accessibleStages, progress);
  container.replaceChildren(root);

  let disposed = false;
  let visible = true;
  let renderer: AnalysisEyeRenderer | null = null;
  let liquidRenderer: AnalysisLiquidRenderer | null = null;
  let fallback: Fallback | null = null;
  let frameRequest = 0;
  let finishTimer = 0;
  let finishRequested = false;
  let foldOnFinish = true;
  let finished = false;
  let finishPromise: Promise<void> | null = null;
  let resolveFinish: (() => void) | null = null;
  let rejectFinish: ((error: unknown) => void) | null = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let waveElapsed = 0;
  let motionElapsed = 0;

  function stopFrame(): void {
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = 0;
  }
  function useFallback(): void {
    if (disposed || fallback) return;
    renderer?.dispose();
    renderer = null;
    fallback = makeFallback(transparentSurface, panelFibres);
    canvas.replaceWith(fallback.svg);
    container.dataset.renderer = 'svg';
    resizeFallback();
  }
  function resizeFallback(): void {
    const bounds = visual.getBoundingClientRect();
    const { halfWidth, halfHeight } = analysisViewport(bounds.width, bounds.height);
    liquidRenderer?.resize(bounds.width, bounds.height);
    entrance?.svg.setAttribute(
      'viewBox',
      `${-halfWidth} ${-halfHeight} ${halfWidth * 2} ${halfHeight * 2}`,
    );
    fallback?.svg.setAttribute(
      'viewBox',
      `${-halfWidth} ${-halfHeight} ${halfWidth * 2} ${halfHeight * 2}`,
    );
  }
  function placeLeader(panel: Panel, fill: number, fold: number): void {
    const bounds = scene.getBoundingClientRect();
    const box = panel.root.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !panel.fibre) return;
    const visualBounds = visual.getBoundingClientRect();
    leaders.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    const isLeft = panel.root.dataset.corner?.includes('left');
    const isTop = panel.root.dataset.corner?.includes('top');
    const startX = compact
      ? (box.left + box.right) / 2 - bounds.left
      : isLeft
        ? box.right - bounds.left
        : box.left - bounds.left;
    const startY = compact
      ? box.top - bounds.top
      : isTop
        ? box.bottom - bounds.top - 19
        : box.top - bounds.top + 19;
    const projected = liquid
      ? projectLiquidTip(
          liquidKnots,
          panel.fibre.angle,
          fill,
          waveElapsed,
          visualBounds.width,
          visualBounds.height,
          fold,
          reducedMotion.matches,
        )
      : projectFibreTip(
          panel.fibre,
          fill,
          visualBounds.width,
          visualBounds.height,
          fold,
          reducedMotion.matches,
        );
    const endX = visualBounds.left - bounds.left + projected.x;
    const endY = visualBounds.top - bounds.top + projected.y;
    const elbowX = startX + (isLeft ? 22 : -22);
    panel.line.setAttribute('d', `M${startX} ${startY}H${elbowX}L${endX} ${endY}`);
    panel.anchor.setAttribute('cx', String(endX));
    panel.anchor.setAttribute('cy', String(endY));
    panel.anchor.dataset.fibreId = String(panel.fibre.id);
  }
  function renderPanels(
    now: number,
    fold: number,
    fill: number,
    reveal = 1,
    calloutElapsed?: number,
  ): void {
    const elapsed = calloutElapsed ?? now - startedAt;
    panels.forEach((panel, index) => {
      const report = purpose === 'report';
      const active = !compact || index < (report ? 2 : 1);
      panel.root.hidden = !active;
      panel.leader.style.display = active ? '' : 'none';
      if (!active) return;
      const cycle = report ? criterionCalloutFrame(elapsed, index) : calloutFrame(elapsed, index);
      // Reduced motion keeps a quiet cross-fade, without corner travel or folding.
      const sequence = report ? cycle.sequence : reducedMotion.matches ? 0 : cycle.sequence;
      if (panel.sequence !== sequence) {
        panel.sequence = sequence;
        const choices = criterionAssignmentsForSlot(assignments, index, compact);
        const assignment = report
          ? choices[sequence % choices.length]
          : assignments[(sequence * 2 + index) % assignments.length];
        panel.readout = report
          ? readouts.find(({ id }) => id === assignment.id)!
          : readouts[(sequence * 2 + index) % readouts.length];
        panel.fibre = assignment.fibre;
        panel.label.textContent = panel.readout.label;
        panel.detail.textContent = panel.readout.detail;
        panel.root.dataset.corner = report
          ? assignment.corner
          : reducedMotion.matches
            ? index
              ? 'bottom-right'
              : 'top-left'
            : calloutFrame(elapsed, index).corner;
        panel.root.dataset.topicId = panel.readout.id;
        panel.root.style.transform = '';
        panel.root.dataset.fibreId = String(assignment.fibre.id);
      }
      const stage = snapshot.stages.find((item) => item.id === panel.readout?.stageId);
      panel.state.textContent = report
        ? panel.readout?.axis || ''
        : stage?.status === 'error'
          ? '확인 필요'
          : stage?.status === 'complete'
            ? '확인 완료'
            : '확인 중';
      const opacity =
        reveal *
        (snapshot.hasError || (reducedMotion.matches && !report)
          ? 1 - fold
          : cycle.opacity * (1 - fold));
      panel.root.style.opacity = opacity.toFixed(3);
      panel.root.style.transform = reducedMotion.matches
        ? ''
        : `translate3d(${((1 - opacity) * (panel.root.dataset.corner?.includes('left') ? -5 : 5)).toFixed(2)}px, 0, 0) scale(${(0.985 + opacity * 0.015).toFixed(4)})`;
      panel.root.style.filter = reducedMotion.matches
        ? ''
        : `blur(${((1 - opacity) * 1.1).toFixed(2)}px)`;
      panel.leader.style.opacity = (opacity * 0.85).toFixed(3);
      panel.line.style.strokeDashoffset = reducedMotion.matches ? '0' : String(1 - opacity);
      const growth = panel.fibre
        ? liquid
          ? liquidFrontier(liquidKnots, panel.fibre.angle, fill, waveElapsed, reducedMotion.matches)
              .growth
          : fibreSegment(panel.fibre, fill).growth
        : 0;
      panel.root.dataset.gaugeProgress = (growth * 100).toFixed(2);
      panel.fill.style.transform = `scaleX(${growth.toFixed(6)})`;
      placeLeader(panel, fill, fold);
    });
  }
  function settle(now: number): void {
    const ready = foldOnFinish
      ? timeline.finished(now)
      : timeline.readyAt !== null && now >= timeline.readyAt;
    if (!finishRequested || finished || !snapshot.complete || !ready) return;
    finished = true;
    stopFrame();
    clearTimeout(finishTimer);
    finishTimer = 0;
    container.dataset.presentationState = 'finished';
    resolveFinish?.();
    resolveFinish = null;
    rejectFinish = null;
  }
  function draw(now = performance.now()): void {
    if (disposed) return;
    const fold = finishRequested && foldOnFinish ? timeline.fold(now) : 0;
    const elapsed = Math.max(0, now - startedAt);
    if (!snapshot.hasError) motionElapsed = elapsed;
    const entranceFrame = eyeEntranceFrame(motionElapsed, options.entrance, reducedMotion.matches);
    const eyeElapsed = entranceFrame.eyeElapsed;
    // Start water at the pupil after synchronization, while the API timer keeps running.
    const fill = timeline.progress(now) * entranceFrame.fillReveal;
    if (!snapshot.hasError) waveElapsed = eyeElapsed;
    const presented =
      liquid && liquidKnots.length
        ? liquidKnots.reduce(
            (total, knot) =>
              total + liquidFrontier(liquidKnots, knot.angle, fill, waveElapsed, true).growth,
            0,
          ) / liquidKnots.length
        : (groupFibreProgress(panelFibres, fill, 'resume') +
            groupFibreProgress(panelFibres, fill, 'role') +
            groupFibreProgress(panelFibres, fill, 'report')) /
          3;
    const percentValue = Math.floor(presented * 100);
    percent.textContent = `${percentValue}%`;
    progress.setAttribute('aria-valuenow', String(percentValue));
    container.dataset.visualProgress = (presented * 100).toFixed(2);
    container.dataset.presentationState = snapshot.hasError
      ? 'error'
      : fold > 0
        ? 'folding'
        : !entranceFrame.synchronized
          ? 'synchronizing'
          : eyeElapsed < EYE_DRAW_MS
            ? 'drawing'
            : snapshot.complete
              ? 'finishing'
              : 'analyzing';
    visual.style.opacity = (
      reducedMotion.matches ? 1 - fold : 1 - smoothstep((fold - 0.65) / 0.35)
    ).toFixed(3);
    renderPanels(
      now,
      fold,
      fill,
      reducedMotion.matches ? 1 : smoothstep(eyeElapsed / 180),
      purpose === 'report' ? entranceFrame.calloutElapsed : undefined,
    );
    if (visible && !document.hidden) {
      if (entrance) {
        entrance.svg.style.opacity = String(entranceFrame.opacity * (1 - fold));
        entrance.svg.style.display = entranceFrame.opacity ? '' : 'none';
        entrance.ring.setAttribute(
          'transform',
          `rotate(${(entranceFrame.rotation * 180) / Math.PI}) scale(${entranceFrame.radius / 61})`,
        );
      }
      liquidRenderer?.render(eyeElapsed, fill, fold, reducedMotion.matches, snapshot.hasError);
      try {
        renderer?.render(eyeElapsed, fill, fold, reducedMotion.matches, snapshot.hasError);
      } catch {
        useFallback();
      }
      if (fallback) {
        fallback.outlines.forEach((outline) =>
          outline.setAttribute(
            'stroke-dasharray',
            `${100 * (reducedMotion.matches ? 1 : smoothstep(eyeElapsed / EYE_DRAW_MS))} 100`,
          ),
        );
        fallback.fibres.forEach(({ descriptor, path, tip }) => {
          const segment = fibreSegment(descriptor, fill);
          const normal = [-Math.sin(descriptor.angle), Math.cos(descriptor.angle)];
          const edge = (step: number, side: number) => {
            const point = fibrePoint(descriptor, step * segment.growth);
            const halfWidth = descriptor.width * (1 - 0.9 * smoothstep((step - 0.48) / 0.52));
            return `${(point[0] + normal[0] * halfWidth * side).toFixed(2)} ${(-point[1] - normal[1] * halfWidth * side).toFixed(2)}`;
          };
          const steps = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
          path.setAttribute(
            'd',
            `M${steps.map((step) => edge(step, 1)).join('L')}L${steps
              .slice()
              .reverse()
              .map((step) => edge(step, -1))
              .join('L')}Z`,
          );
          path.setAttribute('fill', snapshot.hasError ? '#ad7560' : 'var(--eye-fiber, #d9b77c)');
          path.setAttribute(
            'opacity',
            String(
              segment.growth <= 0.00001
                ? 0
                : descriptor.brightness *
                    0.78 *
                    (reducedMotion.matches ? 1 : Math.min(1, eyeElapsed / 480)),
            ),
          );
          tip.setAttribute('cx', segment.tip[0].toFixed(2));
          tip.setAttribute('cy', (-segment.tip[1]).toFixed(2));
          tip.setAttribute(
            'opacity',
            String(
              reducedMotion.matches || snapshot.hasError || eyeElapsed <= 0 || segment.growth < 0.01
                ? 0
                : Math.min(0.4, (1 - fill) * 20),
            ),
          );
        });
        fallback.group.setAttribute(
          'transform',
          `scale(1 ${analysisFoldScale(fold, reducedMotion.matches)})`,
        );
      }
    }
    settle(now);
  }
  function frame(now: number): void {
    frameRequest = 0;
    if (disposed || !visible || document.hidden || finished) return;
    draw(now);
    if (!snapshot.hasError && !finished) frameRequest = requestAnimationFrame(frame);
  }
  function resume(): void {
    if (disposed) return;
    stopFrame();
    root.dataset.animated = String(visible && !document.hidden && !reducedMotion.matches);
    draw();
    if (visible && !document.hidden && !snapshot.hasError && !finished)
      frameRequest = requestAnimationFrame(frame);
  }
  function update(value: unknown): void {
    if (disposed) return;
    snapshot = normalizeAnalysis(value);
    readouts = analysisReadouts(value, snapshot, purpose);
    if (reducedMotion.matches)
      panels.forEach((panel) => {
        panel.sequence = -1;
      });
    timeline.setStatus(snapshot.complete, snapshot.hasError, performance.now());
    root.dataset.complete = String(snapshot.complete);
    container.dataset.analysisComplete = String(snapshot.complete);
    container.dataset.completedStages = String(snapshot.completedCount);
    container.dataset.analysisProgress = String(snapshot.progress);
    stageItems.forEach((item, index) => {
      const stage = snapshot.stages[index];
      item.textContent = `${stage.label}: ${{ pending: '대기', running: '확인 중', complete: '완료', error: '확인 필요' }[stage.status]}. ${stage.detail}`;
    });
    summaryMessage.textContent = snapshot.hasError
      ? '확인하지 못한 항목이 있어요. 다시 시도해 주세요.'
      : snapshot.complete
        ? purpose === 'report'
          ? '분석을 정리하고 보고서를 완성합니다.'
          : '분석을 정리하고 모의지원을 준비합니다.'
        : purpose === 'report'
          ? '이력서와 채용공고를 분석하고 있어요.'
          : '이력서와 희망 직무를 살펴보고 있어요.';
    if (!snapshot.complete && finishPromise && !finished) {
      clearTimeout(finishTimer);
      finishRequested = false;
      rejectFinish?.(new Error('분석을 완료하지 못했습니다.'));
      rejectFinish = null;
      resolveFinish = null;
      finishPromise = null;
    }
    resume();
  }
  function finish(options: { fold?: boolean } = {}): Promise<void> {
    if (disposed) return Promise.reject(new DOMException('Analysis view disposed', 'AbortError'));
    if (!snapshot.complete)
      return Promise.reject(new Error('All analysis stages must complete before finishing.'));
    if (finishPromise) return finishPromise;
    foldOnFinish = options.fold !== false;
    finishRequested = true;
    finishPromise = new Promise<void>((resolve, reject) => {
      resolveFinish = resolve;
      rejectFinish = reject;
    });
    const deadline =
      (timeline.readyAt ?? performance.now()) + (foldOnFinish ? ANALYSIS_FOLD_MS : 0);
    const check = () => {
      if (disposed) return;
      draw();
      if (!finished)
        finishTimer = window.setTimeout(check, Math.max(1, deadline - performance.now()));
    };
    finishTimer = window.setTimeout(check, Math.max(1, deadline - performance.now()));
    resume();
    return finishPromise;
  }

  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      if (!disposed && renderer) {
        useFallback();
        draw();
      }
    },
    { signal },
  );
  if (liquid) {
    liquidRenderer = new AnalysisLiquidRenderer(liquidKnots);
    canvas.replaceWith(liquidRenderer.svg);
    container.dataset.renderer = 'svg-liquid';
    resizeFallback();
  } else {
    try {
      renderer = new AnalysisEyeRenderer(canvas, transparentSurface, panelFibres, options.palette);
      container.dataset.renderer = 'webgl';
      const bounds = visual.getBoundingClientRect();
      renderer.resize(Math.max(1, bounds.width), Math.max(1, bounds.height));
    } catch {
      useFallback();
    }
    resizeFallback();
  }
  const resize = new ResizeObserver(() => {
    if (disposed) return;
    const bounds = visual.getBoundingClientRect();
    if (renderer && bounds.width > 0 && bounds.height > 0)
      renderer.resize(bounds.width, bounds.height);
    const nextCompact = bounds.width < 700;
    if (compact !== nextCompact) {
      compact = nextCompact;
      panels.forEach((panel) => {
        panel.sequence = -1;
      });
    }
    resizeFallback();
    draw();
  });
  resize.observe(visual);
  const intersection = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      resume();
    },
    { threshold: 0.01 },
  );
  intersection.observe(scene);
  document.addEventListener('visibilitychange', resume, { signal });
  reducedMotion.addEventListener('change', resume, { signal });
  window.addEventListener(
    'beforeprint',
    () => {
      stopFrame();
      draw();
    },
    { signal },
  );
  update(initial);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    stopFrame();
    clearTimeout(finishTimer);
    rejectFinish?.(new DOMException('Analysis view disposed', 'AbortError'));
    rejectFinish = null;
    resolveFinish = null;
    abort.abort();
    resize.disconnect();
    intersection.disconnect();
    renderer?.dispose();
    renderer = null;
    liquidRenderer?.dispose();
    liquidRenderer = null;
    root.remove();
    if (mounts.get(container) === dispose) {
      mounts.delete(container);
      for (const key of [
        'renderer',
        'analysisComplete',
        'completedStages',
        'analysisProgress',
        'visualProgress',
        'presentationState',
      ])
        delete container.dataset[key];
    }
  }
  mounts.set(container, dispose);
  return { update, finish, dispose };
}
