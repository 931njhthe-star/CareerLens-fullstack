import { drawPupilFrame, pupilMotionFrame } from './pupil-motion.js';

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = (value) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

// Retained for the historical journey previews, not used by the production pupil.
export function liveMotionViewport(width, height) {
  const w = Math.max(1, finite(width, 1200));
  const h = Math.max(1, finite(height, 800));
  const scale = Math.max(0.1, Math.min(0.9, (w - 32) / 1200, (h - 120) / 620));
  const centerX = w / 2;
  const centerY = Math.min(h * 0.48, Math.max(w <= 1000 ? 288 : 270, Math.min(330, h * 0.3)));
  return {
    left: 0,
    top: 0,
    width: w,
    height: h,
    scale,
    centerX,
    centerY,
    radius: 60 * scale,
    offsetX: centerX - 600 * scale,
    offsetY: centerY - 245 * scale,
    stageBottom: centerY + 196 * scale + 32,
  };
}

/** Illustrative progress never reaches 100 until the final request has succeeded. */
export class LiveAnalysisClock {
  constructor() {
    this.completedAt = null;
    this.readyAt = null;
    this.from = 0;
  }
  progress(elapsed) {
    const time = Math.max(0, elapsed);
    if (this.completedAt !== null) {
      return (
        this.from +
        (1 - this.from) * smooth((time - this.completedAt) / (this.readyAt - this.completedAt))
      );
    }
    return time < 4000
      ? 0.92 * Math.pow(time / 4000, 0.85)
      : Math.min(0.99, 0.92 + 0.07 * (1 - Math.exp(-(time - 4000) / 6500)));
  }
  complete(elapsed) {
    if (this.completedAt !== null) return;
    this.from = this.progress(elapsed);
    this.completedAt = Math.max(0, elapsed);
    this.readyAt = Math.max(4000, this.completedAt + 400);
  }
  frame(elapsed) {
    const done = this.readyAt !== null && elapsed >= this.readyAt;
    const amount = this.progress(elapsed);
    return {
      percent: done ? 100 : Math.min(99, Math.floor(amount * 100)),
      active: !done,
      sceneTime: 12 + Math.min(6, Math.max(0, elapsed) * 0.0015),
      amount,
    };
  }
}

/** Eye, traced wordmark and shared edge use one canvas and one motion clock. */
export function mountLiveAnalysisEye(host, { onProgress, ready = false } = {}) {
  const element = document.createElement('div');
  element.className = 'live-analysis-motion';
  const canvas = document.createElement('canvas');
  canvas.className = 'live-analysis-scene';
  canvas.setAttribute('aria-hidden', 'true');
  element.append(canvas);
  host.replaceChildren(element);
  const context = canvas.getContext('2d');
  if (!context) {
    element.remove();
    throw new Error('Analysis graphics are unavailable.');
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const started = performance.now() - (ready ? 4000 : 0);
  const clock = new LiveAnalysisClock();
  let size = 320;
  let disposed = false;
  let raf = 0;
  let progressTimer;
  let finishTimer;
  let lastPercent = -1;
  let hiddenAt = document.hidden ? started : null;
  let hiddenDuration = 0;
  let resolveSettled;
  const settled = new Promise((resolve) => {
    resolveSettled = resolve;
  });

  function motionElapsed(now) {
    return Math.max(0, (hiddenAt ?? now) - started - hiddenDuration);
  }
  function render(now = performance.now()) {
    if (disposed) return;
    const loading = clock.frame(Math.max(0, now - started));
    const frame = pupilMotionFrame(motionElapsed(now), { reduced: reduced.matches });
    if (!document.hidden) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPupilFrame(context, size, frame);
    }
    element.dataset.percent = String(loading.percent);
    element.dataset.loading = String(loading.active);
    element.dataset.rotation = String(frame.rotation);
    element.dataset.eyeYaw = String(frame.eyeYaw);
    element.dataset.face = frame.face;
    element.dataset.logoReveal = String(frame.logoReveal);
    element.dataset.outline = String(frame.outline);
    element.dataset.stage = frame.scale < 1 ? 'entry' : 'analysis';
    if (lastPercent !== loading.percent) {
      lastPercent = loading.percent;
      onProgress?.(loading.percent);
    }
  }
  function resize() {
    if (disposed) return;
    size = Math.max(120, Math.min(520, element.clientWidth || 320));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    render();
  }
  function stopDrawing() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(progressTimer);
  }
  function tick() {
    raf = 0;
    if (disposed || document.hidden) return;
    render();
    if (!clock.frame(performance.now() - started).active) return;
    // Reduced motion still reports progress, without a continuous animation loop.
    if (reduced.matches) progressTimer = setTimeout(tick, 250);
    else raf = requestAnimationFrame(tick);
  }
  function refresh() {
    stopDrawing();
    if (disposed) return;
    const now = performance.now();
    if (document.hidden && hiddenAt === null) hiddenAt = now;
    if (!document.hidden && hiddenAt !== null) {
      hiddenDuration += now - hiddenAt;
      hiddenAt = null;
    }
    if (!document.hidden) tick();
  }
  function complete() {
    if (disposed || clock.completedAt !== null) return;
    const elapsed = performance.now() - started;
    clock.complete(elapsed);
    finishTimer = setTimeout(() => {
      if (disposed) return;
      render();
      stopDrawing();
      resolveSettled();
    }, Math.max(0, clock.readyAt - elapsed) + 40);
    refresh();
  }
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', refresh);
  reduced.addEventListener('change', refresh);
  resize();
  refresh();
  return {
    element,
    scene: canvas,
    complete,
    update(value) {
      if (value?.complete) complete();
    },
    whenSettled() {
      return settled;
    },
    finish() {
      complete();
      return settled;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopDrawing();
      clearTimeout(finishTimer);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', refresh);
      reduced.removeEventListener('change', refresh);
      element.remove();
      resolveSettled();
    },
  };
}
