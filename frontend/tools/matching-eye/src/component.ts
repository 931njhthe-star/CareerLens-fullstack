import { CONNECTION_START, normalizeMatching, SETTLED_TIME } from './data.ts';
import type { MatchingData, MatchingJob } from './data.ts';
import { MatchingEyeRenderer } from './renderer.ts';
import { componentStyles } from './styles.ts';
export { mountAnalysisEye } from './analysis-component.ts';
export { analysisViewport } from './analysis-projection.ts';
export { eyeEntranceFrame } from './analysis-liquid.ts';
export { ScorePyramidRenderer } from './score-pyramid.ts';

const mounts = new WeakMap<HTMLElement, () => void>();
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function svgElement(tag: string, attributes: Record<string, string>) {
  const node = document.createElementNS(SVG_NAMESPACE, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function fallbackGraphic(data: MatchingData): SVGSVGElement {
  const svg = svgElement('svg', {
    viewBox: '-482 -260 964 520',
    'aria-hidden': 'true',
    preserveAspectRatio: 'xMidYMid meet',
  }) as SVGSVGElement;
  svg.append(
    svgElement('path', {
      d: 'M-442 0 Q0-462 442 0 Q0 462-442 0Z',
      fill: 'none',
      stroke: '#c9cac1',
      'stroke-width': '1.6',
    }),
  );
  for (const radius of [46, 62, 208, 215]) {
    svg.append(
      svgElement('circle', {
        cx: '0',
        cy: '0',
        r: String(radius),
        fill: 'none',
        stroke: '#686b60',
        'stroke-width': '1',
      }),
    );
  }
  for (const job of data.jobs) {
    if (job.matched) {
      svg.append(
        svgElement('line', {
          x1: '0',
          y1: '0',
          x2: String(job.x),
          y2: String(-job.y),
          stroke: '#f4f4ed',
          'stroke-width': '1.4',
          'data-line-job-id': job.id,
        }),
      );
    }
    svg.append(
      svgElement('circle', {
        cx: String(job.x),
        cy: String(-job.y),
        r: '3.7',
        fill: '#f8f8f2',
        'data-point-job-id': job.id,
      }),
    );
  }
  for (const [radius, opacity] of [
    [29, 0.07],
    [17, 0.14],
    [8, 0.7],
    [4, 1],
  ]) {
    svg.append(
      svgElement('circle', {
        cx: '0',
        cy: '0',
        r: String(radius),
        fill: '#f7de7d',
        opacity: String(opacity),
      }),
    );
  }
  return svg;
}

function jobDescription(job: MatchingJob): string {
  const title = [job.company, job.role].filter(Boolean).join(' · ') || `공고 ${job.id}`;
  const score = job.score === null ? '점수 미산정' : `${job.score}점`;
  const connection = job.matched ? '연결됨' : '연결 대상 아님';
  return [title, job.location, score, connection].filter(Boolean).join(' · ');
}

/**
 * Mount a self-contained visualization using report.job_matches only.
 * Calling again on the same host disposes the previous résumé's complete scene.
 */
export function mountMatchingEye(container: HTMLElement, matching: unknown): () => void {
  mounts.get(container)?.();
  const data = normalizeMatching(matching);
  const abort = new AbortController();
  const { signal } = abort;
  const root = element('div', 'cl-matching-eye');
  const style = element('style');
  style.textContent = componentStyles;
  const stage = element('div', 'cl-matching-eye__stage');
  stage.setAttribute('role', 'img');
  stage.setAttribute(
    'aria-label',
    `중앙의 내 이력서와 채용 공고 ${data.jobs.length}개. ${data.matchedCount}개 공고가 60점 이상으로 연결됩니다.`,
  );
  const canvas = element('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const center = element('span', 'cl-matching-eye__center', '내 이력서');
  stage.append(canvas, center);

  const selection = element('p', 'cl-matching-eye__selection');
  selection.setAttribute('role', 'status');
  selection.setAttribute('aria-live', 'polite');
  const defaultMessage =
    data.status === 'resume_required'
      ? '이력서를 등록하면 공고와의 연결을 확인할 수 있습니다.'
      : data.jobs.length
        ? '공고 점을 누르거나 아래 목록에서 매칭 점수를 확인하세요.'
        : '연결할 채용 공고가 아직 없습니다.';
  selection.textContent = defaultMessage;

  const details = element('details');
  const summary = element('summary', undefined, `공고별 매칭 점수 · ${data.jobs.length}개`);
  const list = element('ul', 'cl-matching-eye__list');
  const searchLabel = element('label', 'cl-matching-eye__search', '공고 검색');
  const search = element('input');
  search.type = 'search';
  search.placeholder = '회사·직무·지역';
  searchLabel.append(search);
  const pageControls = element('div', 'cl-matching-eye__pages');
  const previous = element('button', undefined, '이전');
  const next = element('button', undefined, '다음');
  previous.type = next.type = 'button';
  const pageLabel = element('span');
  pageLabel.setAttribute('aria-live', 'polite');
  pageControls.append(previous, pageLabel, next);
  const buttons = new Map<string, HTMLButtonElement>();
  const jobsById = new Map(data.jobs.map((job) => [job.id, job]));
  let listPage = 0;
  const pageSize = 40;

  function renderJobList(): void {
    const terms = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const filtered = terms.length
      ? data.jobs.filter((job) => {
          const text = `${job.company} ${job.role} ${job.location} ${job.id}`.toLocaleLowerCase();
          return terms.every((term) => text.includes(term));
        })
      : data.jobs;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    listPage = Math.max(0, Math.min(listPage, pages - 1));
    const shown = filtered.slice(listPage * pageSize, (listPage + 1) * pageSize);
    const fragment = document.createDocumentFragment();
    buttons.clear();
    for (const job of shown) {
      const row = element('li');
      const button = element('button');
      button.type = 'button';
      button.dataset.jobId = job.id;
      button.dataset.connected = String(job.matched);
      button.dataset.positionSource = job.positionSource;
      button.dataset.x = String(job.x);
      button.dataset.y = String(job.y);
      if (job.connectionStart !== null)
        button.dataset.connectionStart = String(job.connectionStart);
      button.setAttribute('aria-pressed', String(job.id === selectedId));
      button.setAttribute('aria-label', jobDescription(job));
      button.append(
        element('span', undefined, [job.company, job.role].filter(Boolean).join(' · ') || job.id),
        element(
          'span',
          undefined,
          job.score === null ? '미산정' : `${job.score}점${job.matched ? ' · 연결' : ''}`,
        ),
      );
      row.append(button);
      fragment.append(row);
      buttons.set(job.id, button);
    }
    if (!shown.length) fragment.append(element('li', undefined, '검색에 맞는 공고가 없습니다.'));
    list.replaceChildren(fragment);
    list.scrollTop = 0;
    pageLabel.textContent = `${filtered.length}개 · ${listPage + 1}/${pages}`;
    previous.disabled = listPage === 0;
    next.disabled = listPage >= pages - 1;
    container.dataset.renderedJobCount = String(shown.length);
  }

  details.append(summary, searchLabel, list, pageControls);
  root.append(style, stage, selection, details);
  container.replaceChildren(root);
  container.dataset.jobCount = String(data.jobs.length);
  container.dataset.matchCount = String(data.matchedCount);
  container.dataset.threshold = String(data.threshold);
  container.dataset.jobIds = JSON.stringify(data.jobs.map((job) => job.id));
  container.dataset.lineJobIds = JSON.stringify(
    data.jobs.filter((job) => job.matched).map((job) => job.id),
  );
  container.dataset.matchingStatus = data.status;
  container.dataset.animationState = 'waiting';
  container.dataset.connectionStart = String(CONNECTION_START);
  container.dataset.renderedJobCount = '0';

  let renderer: MatchingEyeRenderer | null = null;
  let disposed = false;
  let fallback = false;
  let elapsed = 0;
  let previousFrame: number | null = null;
  let frameRequest = 0;
  let visible = true;
  let selectedId: string | null = null;
  let highlightedId: string | null = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function draw(): void {
    if (disposed || !renderer) return;
    renderer.render(elapsed);
    container.dataset.animationTime = elapsed.toFixed(3);
  }

  function stopFrame(): void {
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    previousFrame = null;
  }

  function useFallback(): void {
    if (disposed || fallback) return;
    fallback = true;
    stopFrame();
    renderer?.dispose();
    renderer = null;
    canvas.replaceWith(fallbackGraphic(data));
    container.dataset.renderer = 'svg';
    container.dataset.animationState = 'settled';
  }

  function frame(timestamp: number): void {
    frameRequest = 0;
    if (disposed || !renderer || !visible || document.hidden) {
      previousFrame = null;
      return;
    }
    if (previousFrame !== null) elapsed += Math.min((timestamp - previousFrame) / 1000, 0.08);
    previousFrame = timestamp;
    elapsed = Math.min(SETTLED_TIME, elapsed);
    try {
      draw();
    } catch {
      useFallback();
      return;
    }
    if (elapsed < SETTLED_TIME) {
      container.dataset.animationState = 'playing';
      frameRequest = requestAnimationFrame(frame);
    } else {
      container.dataset.animationState = 'settled';
      previousFrame = null;
    }
  }

  function resume(): void {
    if (disposed || !renderer) return;
    if (reducedMotion.matches) {
      stopFrame();
      elapsed = SETTLED_TIME;
      draw();
      container.dataset.animationState = 'settled';
    } else if (visible && !document.hidden && elapsed < SETTLED_TIME && !frameRequest) {
      frameRequest = requestAnimationFrame(frame);
    }
  }

  function select(job: MatchingJob | null, committed: boolean): void {
    const id = job?.id ?? (committed ? null : selectedId);
    if (id === highlightedId && !committed) return;
    const current = id === null ? null : (jobsById.get(id) ?? null);
    if (committed) {
      if (selectedId) buttons.get(selectedId)?.setAttribute('aria-pressed', 'false');
      selectedId = id;
      if (id) buttons.get(id)?.setAttribute('aria-pressed', 'true');
      container.dataset.selectedJobId = id ?? '';
    }
    if (id !== highlightedId) {
      highlightedId = id;
      renderer?.highlight(id);
      if (renderer) draw();
    }
    selection.textContent = current ? jobDescription(current) : defaultMessage;
    selection.title = selection.textContent;
    if (committed && current) {
      container.dispatchEvent(
        new CustomEvent('matching-eye:select', {
          bubbles: true,
          detail: { id: current.id, score: current.score, matched: current.matched },
        }),
      );
    }
  }

  // Hundreds of postings stay in the GPU batch; only one list page becomes DOM.
  details.addEventListener(
    'toggle',
    () => {
      if (details.open) renderJobList();
    },
    { signal },
  );
  search.addEventListener(
    'input',
    () => {
      listPage = 0;
      renderJobList();
    },
    { signal },
  );
  previous.addEventListener(
    'click',
    () => {
      listPage -= 1;
      renderJobList();
    },
    { signal },
  );
  next.addEventListener(
    'click',
    () => {
      listPage += 1;
      renderJobList();
    },
    { signal },
  );
  list.addEventListener(
    'click',
    (event) => {
      const id = (event.target as Element).closest<HTMLButtonElement>('[data-job-id]')?.dataset
        .jobId;
      if (id) select(jobsById.get(id) ?? null, true);
    },
    { signal },
  );
  list.addEventListener(
    'focusin',
    (event) => {
      const id = (event.target as HTMLElement).dataset.jobId;
      if (id) select(jobsById.get(id) ?? null, false);
    },
    { signal },
  );
  list.addEventListener('focusout', () => select(null, false), { signal });

  function pick(event: PointerEvent): MatchingJob | null {
    const bounds = stage.getBoundingClientRect();
    return renderer?.pick(event.clientX - bounds.left, event.clientY - bounds.top) ?? null;
  }
  canvas.addEventListener(
    'pointermove',
    (event) => {
      const job = pick(event);
      canvas.style.cursor = job ? 'pointer' : 'default';
      select(job, false);
    },
    { signal },
  );
  canvas.addEventListener('pointerleave', () => select(null, false), { signal });
  canvas.addEventListener('pointerup', (event) => select(pick(event), true), { signal });
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      useFallback();
    },
    { signal },
  );

  try {
    renderer = new MatchingEyeRenderer(canvas, data);
    container.dataset.renderer = 'webgl';
    const bounds = stage.getBoundingClientRect();
    renderer.resize(bounds.width || 240, bounds.height || 200);
    draw();
  } catch {
    useFallback();
  }

  const resize = new ResizeObserver(() => {
    if (!renderer || disposed) return;
    const bounds = stage.getBoundingClientRect();
    if (bounds.width > 0 && bounds.height > 0) {
      renderer.resize(bounds.width, bounds.height);
      draw();
    }
  });
  resize.observe(stage);
  const intersection = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) resume();
      else stopFrame();
    },
    { threshold: 0.01 },
  );
  intersection.observe(stage);
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) stopFrame();
      else resume();
    },
    { signal },
  );
  reducedMotion.addEventListener('change', resume, { signal });
  window.addEventListener(
    'beforeprint',
    () => {
      stopFrame();
      elapsed = SETTLED_TIME;
      draw();
      container.dataset.animationState = 'settled';
    },
    { signal },
  );
  resume();

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    stopFrame();
    abort.abort();
    resize.disconnect();
    intersection.disconnect();
    renderer?.dispose();
    renderer = null;
    root.remove();
    if (mounts.get(container) === dispose) {
      mounts.delete(container);
      for (const key of [
        'jobCount',
        'matchCount',
        'threshold',
        'jobIds',
        'lineJobIds',
        'matchingStatus',
        'animationState',
        'animationTime',
        'renderer',
        'connectionStart',
        'renderedJobCount',
        'selectedJobId',
      ])
        delete container.dataset[key];
    }
  }
  mounts.set(container, dispose);
  return dispose;
}
