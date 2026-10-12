import { normalizeDemoScores } from './demo-score-data.js';
import { drawFixedAnchorFrame, studyRotation, studyTopics } from './fixed-anchor-study.js';
import { liveMotionViewport } from './live-eye-motion.js';
import { liveJourneyGeometry } from './journey-layout.js';

const PHASE_TIMES = Object.freeze({ idle: 0, uploading: 3.6, elements: 5.5, orbit: 10.4 });
const IDS = [
  'experience-specificity',
  'outcome-evidence',
  'structure-readability',
  'core-skills',
  'work-relevance',
  'preferred-capabilities',
  'required-experience',
  'education-major',
  'other-requirements',
  'work-scale',
  'operations-problems',
  'role-responsibility',
];

/** A score-free catalog; the shared painter selects only five topics per journey. */
export const JOURNEY_CRITERIA = Object.freeze(
  normalizeDemoScores([])
    .flatMap((axis) =>
      axis.subcriteria.map((criterion) => ({ axis: axis.label, label: criterion.label })),
    )
    .map((criterion, index) => Object.freeze({ id: IDS[index], ...criterion })),
);

const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const validPhase = (value) => (Object.hasOwn(PHASE_TIMES, value) ? value : 'idle');
export const journeyPhaseTime = (phase) => PHASE_TIMES[validPhase(phase)];

function phaseStartTime(phase, snapshot) {
  const target = journeyPhaseTime(phase);
  const start = phase === 'orbit' ? PHASE_TIMES.elements : phase === 'uploading' ? 0 : target;
  // Only a fresh entry chooses a starting scene. Navigation always resumes the visible frame.
  return clamp(finite(snapshot?.time, start), 0, PHASE_TIMES.orbit);
}

/**
 * The body-mounted layer shares its viewport geometry and painter with the analysis overlay.
 * The heading locates the initial dot once; scrolling or replacing it cannot move the pupil.
 */
export function mountJourneyMotion(host, { phase = 'idle', snapshot } = {}) {
  const element = document.createElement('div');
  element.className = 'journey-motion';
  element.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  element.append(canvas);
  document.body.append(element);
  host.classList.add('has-journey-motion');
  const context = canvas.getContext('2d');
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let currentPhase = validPhase(phase);
  const time = phaseStartTime(currentPhase, snapshot);
  const originSource = host.matches?.('.introduction__visual') ? 'intro' : 'heading';
  const state = {
    time,
    rotation: finite(snapshot?.rotation, studyRotation(time)),
    seed: Math.floor(finite(snapshot?.seed, Math.random() * 0xffffffff)) >>> 0 || 1,
    origin: snapshot?.originSource === originSource ? snapshot?.origin : undefined,
    originSource,
  };
  let journeyGeometry = snapshot?.journeyGeometry;
  let viewport;
  let frame;
  let previous;
  let disposed = false;

  function draw() {
    element.dataset.phase = currentPhase;
    const direction = Math.sign(journeyPhaseTime(currentPhase) - state.time);
    element.dataset.direction = direction < 0 ? 'reverse' : direction > 0 ? 'forward' : 'hold';
    // Keep seed breathing continuous when the target changes; never pulse a rewinding ring.
    const seedWeight = 1 - clamp(state.time / 1.2, 0, 1);
    canvas.style.opacity = String(
      media.matches ? 1 : 1 - seedWeight * 0.15 * (1 - Math.cos(state.rotation * 3.62)),
    );
    if (!context || !viewport) return;
    const result = drawFixedAnchorFrame(context, viewport.width, viewport.height, {
      time: state.time,
      seed: state.seed,
      rotation: state.rotation,
      layout: viewport,
      origin: state.origin,
      journeyGeometry,
    });
    Object.assign(canvas.dataset, {
      stage: result.stage.id,
      time: state.time.toFixed(3),
      rotation: state.rotation.toFixed(4),
      seed: String(state.seed),
      topicCount: String(result.topics.length),
      centerX: String(viewport.centerX),
      centerY: String(viewport.centerY),
      pupilRadius: String(viewport.radius),
    });
  }

  function stop() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    previous = undefined;
  }

  function canAnimate() {
    return context && !disposed && !document.hidden && !media.matches;
  }

  function schedule() {
    if (canAnimate() && frame === undefined) frame = requestAnimationFrame(tick);
  }

  function tick(now) {
    frame = undefined;
    if (!canAnimate()) return;
    const dt = previous === undefined ? 0 : Math.min(0.05, Math.max(0, now - previous) / 1000);
    previous = now;
    // Retarget the same timeline in either direction, including skipped pages and interruptions.
    const remaining = journeyPhaseTime(currentPhase) - state.time;
    const direction = Math.sign(remaining);
    state.time += direction * Math.min(Math.abs(remaining), dt * (direction < 0 ? 3.2 : 1.6));
    state.rotation += dt * 0.62 * (direction < 0 ? -1 : 1);
    draw();
    schedule();
  }

  function resize() {
    const previousViewport = viewport || snapshot?.frame;
    viewport = liveMotionViewport(window.innerWidth, window.innerHeight);
    const viewportChanged = Boolean(
      previousViewport &&
      (previousViewport.width !== viewport.width || previousViewport.height !== viewport.height),
    );
    Object.assign(element.style, {
      left: `${viewport.left}px`,
      top: `${viewport.top}px`,
      width: `${viewport.width}px`,
      height: `${viewport.height}px`,
    });
    if (!state.origin || viewportChanged) {
      const title =
        host.querySelector?.('h1') || host.closest?.('.introduction')?.querySelector('h1');
      const rect = (title || host).getBoundingClientRect();
      const description = host.querySelector?.('p') || title?.parentElement?.querySelector('p');
      // Reflow can change the title position. Remove the current document scroll from
      // that measurement so a resize does not pin the seed to the scrolled heading.
      const scrollY = finite(window.scrollY, 0);
      const seedY = Math.max(
        rect.bottom + scrollY + 38,
        description ? description.getBoundingClientRect().bottom + scrollY + 12 : 0,
      );
      state.origin = {
        x: (clamp(rect.left + 4, 20, viewport.width - 20) - viewport.offsetX) / viewport.scale,
        y: (clamp(seedY, 130, viewport.height - 100) - viewport.offsetY) / viewport.scale,
      };
    }
    if (!journeyGeometry || viewportChanged)
      journeyGeometry = liveJourneyGeometry(viewport, state.origin);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(viewport.width * ratio));
    canvas.height = Math.max(1, Math.round(viewport.height * ratio));
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  function refreshMotion() {
    stop();
    if (media.matches) state.time = journeyPhaseTime(currentPhase);
    draw();
    schedule();
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', refreshMotion);
  media.addEventListener('change', refreshMotion);
  if (media.matches) state.time = journeyPhaseTime(currentPhase);
  resize();
  schedule();

  return {
    update(options = {}) {
      if (disposed) return;
      if (options.host && options.host !== host) {
        host.classList.remove('has-journey-motion');
        host = options.host;
        host.classList.add('has-journey-motion');
      }
      currentPhase = validPhase(options.phase ?? currentPhase);
      if (media.matches) state.time = journeyPhaseTime(currentPhase);
      draw();
      schedule();
    },
    capture() {
      return {
        phase: currentPhase,
        ...state,
        journeyGeometry,
        topics: studyTopics(state.seed),
        centerX: viewport.centerX,
        centerY: viewport.centerY,
        radius: viewport.radius,
        frame: { ...viewport },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', refreshMotion);
      media.removeEventListener('change', refreshMotion);
      element.remove();
      host.classList.remove('has-journey-motion');
    },
  };
}
