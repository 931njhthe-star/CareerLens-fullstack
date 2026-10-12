const TAU = Math.PI * 2;
const DURATION = 2300;
const REVEAL_AT = 0.6;
const STYLES = {
  orbit: { count: 144, turn: 1.12, spread: 0.2, trail: 0.035, width: 0.8 },
  ribbon: { count: 156, turn: 0.7, spread: 0.15, trail: 0.055, width: 1.15 },
  constellation: { count: 128, turn: 0.42, spread: 0.24, trail: 0.018, width: 0.6 },
  prism: { count: 144, turn: 0.56, spread: 0.18, trail: 0.032, width: 0.85 },
  comet: { count: 168, turn: 1.28, spread: 0.26, trail: 0.075, width: 1 },
};

const clamp = (value) => Math.max(0, Math.min(1, value));
const mix = (from, to, progress) => from + (to - from) * progress;
const smooth = (value) => {
  const progress = clamp(value);
  return progress * progress * (3 - 2 * progress);
};
const easeOut = (value) => 1 - (1 - clamp(value)) ** 3;
const noise = (index) => {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

function validRect(rect) {
  return (
    rect &&
    ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key])) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function color(value, fallback) {
  return typeof value === 'string' && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value)
    ? value
    : fallback;
}

// Arc-length parameterization keeps the particle density even on every edge.
function perimeterPoint(rect, progress) {
  const radius = Math.min(20, rect.width / 4, rect.height / 4);
  const horizontal = rect.width - radius * 2;
  const vertical = rect.height - radius * 2;
  const arc = (Math.PI * radius) / 2;
  let distance = (((progress % 1) + 1) % 1) * (2 * horizontal + 2 * vertical + 4 * arc);
  const sections = [horizontal, arc, vertical, arc, horizontal, arc, vertical, arc];
  let section = 0;
  while (section < sections.length - 1 && distance > sections[section]) {
    distance -= sections[section++];
  }
  const { x, y, width, height } = rect;
  if (section === 0) return { x: x + radius + distance, y };
  if (section === 2) return { x: x + width, y: y + radius + distance };
  if (section === 4) return { x: x + width - radius - distance, y: y + height };
  if (section === 6) return { x, y: y + height - radius - distance };
  const corner = (section - 1) / 2;
  const angle = -Math.PI / 2 + corner * (Math.PI / 2) + distance / radius;
  const centerX = corner < 2 ? x + width - radius : x + radius;
  const centerY = corner === 0 || corner === 3 ? y + radius : y + height - radius;
  return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
}

// A document stays open below: each branch starts at its top centre, rounds
// one upper corner and descends its own edge. Progress never wraps around.
function documentPoint(rect, progress, side) {
  const radius = Math.min(20, rect.width / 4, rect.height / 4);
  const horizontal = rect.width / 2 - radius;
  const arc = (Math.PI * radius) / 2;
  const vertical = rect.height - radius;
  const distance = clamp(progress) * (horizontal + arc + vertical);
  const centerX = rect.x + rect.width / 2;
  if (distance <= horizontal) return { x: centerX + side * distance, y: rect.y };
  if (distance <= horizontal + arc) {
    const angle = (distance - horizontal) / radius;
    return {
      x: centerX + side * (horizontal + Math.sin(angle) * radius),
      y: rect.y + radius * (1 - Math.cos(angle)),
    };
  }
  return {
    x: centerX + (side * rect.width) / 2,
    y: rect.y + radius + distance - horizontal - arc,
  };
}

function cubic(start, first, second, end, progress) {
  const remaining = 1 - progress;
  return {
    x:
      remaining ** 3 * start.x +
      3 * remaining ** 2 * progress * first.x +
      3 * remaining * progress ** 2 * second.x +
      progress ** 3 * end.x,
    y:
      remaining ** 3 * start.y +
      3 * remaining ** 2 * progress * first.y +
      3 * remaining * progress ** 2 * second.y +
      progress ** 3 * end.y,
  };
}

function createParticles(from, to, style, settings, colors, outline) {
  const center = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const size = Math.min(from.width, from.height);
  return Array.from({ length: settings.count }, (_, index) => {
    const fraction = index / settings.count;
    const angle = fraction * TAU;
    const iris = index % 3 === 0;
    const radius = iris ? 0.18 + noise(index) * 0.11 : 0.65 + noise(index) * 0.35;
    const start = {
      x: center.x + Math.cos(angle) * (iris ? size : from.width * 0.43) * radius,
      y: center.y + Math.sin(angle) * (iris ? size : from.height * 0.22) * radius,
    };
    const launchAngle = angle + settings.turn * 0.42;
    const spread = size * settings.spread * (0.65 + noise(index + 19) * 0.35);
    const burst = {
      x: start.x + Math.cos(launchAngle) * spread,
      y: start.y + Math.sin(launchAngle) * spread * 0.75,
    };
    // Document fibres gather at the top before travelling down separate edges.
    // The comparison lab keeps its original closed-frame destinations.
    const target =
      outline === 'document' ? documentPoint(to, 0, 1) : perimeterPoint(to, fraction + 0.125);
    const group = index % 3;
    const handedness = style === 'ribbon' && group === 1 ? -1 : 1;
    const bend = Math.min(size * 0.72, 230) * settings.turn;
    const tangent = { x: -Math.sin(angle) * handedness, y: Math.cos(angle) * handedness };
    const first = {
      x: burst.x + tangent.x * bend,
      y: burst.y + tangent.y * bend,
    };
    const second = {
      x: target.x + tangent.x * bend * 0.6,
      y: target.y + tangent.y * bend * 0.6,
    };
    if (style === 'ribbon') {
      first.x = center.x + (group - 1) * size * 0.48;
      first.y = center.y - size * 0.5 + group * size * 0.42;
      second.x += (group - 1) * size * 0.14;
    } else if (style === 'prism') {
      first.x = mix(first.x, center.x + Math.sign(Math.cos(angle)) * size * 0.48, 0.75);
      first.y = mix(first.y, center.y + Math.sign(Math.sin(angle)) * size * 0.3, 0.75);
    } else if (style === 'comet') {
      first.x += Math.sin(group * 2.1) * size * 0.28;
      first.y -= size * 0.32;
    }
    const delay = style === 'comet' ? group * 0.045 + noise(index) * 0.025 : noise(index) * 0.075;
    return {
      start,
      burst,
      first,
      second,
      target,
      angle,
      delay,
      document:
        outline === 'document'
          ? {
              rect: to,
              side: index % 2 === 0 ? -1 : 1,
              arrival: 0.5 + delay,
              departure: 0.91 + noise(index + 37) * 0.07,
            }
          : null,
      size: (index % 11 === 0 ? 2 : 0.75) + noise(index + 7) * 0.65,
      color: colors[style === 'prism' ? group : index % 5 === 0 ? 2 : index % 2],
    };
  });
}

function particlePosition(particle, progress, style) {
  const document = particle.document;
  if (document && progress >= document.arrival) {
    const flow = smooth((progress - document.arrival) / (document.departure - document.arrival));
    return documentPoint(document.rect, flow, document.side);
  }
  const arrival = document ? document.arrival : 0.78;
  const local = clamp((progress - particle.delay) / (arrival - particle.delay));
  if (local < 0.24) {
    const release = easeOut(local / 0.24);
    return {
      x: mix(particle.start.x, particle.burst.x, release),
      y: mix(particle.start.y, particle.burst.y, release),
    };
  }
  const travel = smooth((local - 0.24) / 0.76);
  const point = cubic(particle.burst, particle.first, particle.second, particle.target, travel);
  // A shared, tapering coil reads as flow, while the final edge remains perfectly still.
  if (style === 'orbit' || style === 'comet') {
    const coil = Math.sin(Math.PI * travel) * (style === 'comet' ? 16 : 25);
    point.x += Math.cos(particle.angle + travel * TAU) * coil;
    point.y += Math.sin(particle.angle + travel * TAU) * coil * 0.65;
  }
  return point;
}

function tracePerimeter(context, rect, start, length, opacity, stroke, width) {
  context.globalAlpha = opacity;
  context.strokeStyle = stroke;
  context.lineWidth = width;
  context.beginPath();
  const steps = Math.max(2, Math.ceil(length * 180));
  for (let index = 0; index <= steps; index++) {
    const point = perimeterPoint(rect, start + (length * index) / steps);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.stroke();
}

function drawBorder(context, rect, progress, colors, reducedMotion) {
  const formation = reducedMotion ? smooth(progress * 3) : smooth((progress - 0.52) / 0.3);
  const fade = 1 - smooth((progress - 0.88) / 0.12);
  if (formation <= 0 || fade <= 0) return;
  context.shadowColor = colors[2];
  context.shadowBlur = 12;
  // Opposing strokes establish the rectangle, followed by a single traveling highlight.
  for (const start of [0, 0.5]) {
    tracePerimeter(context, rect, start, formation * 0.5, fade * 0.75, colors[0], 1.1);
  }
  if (!reducedMotion) {
    const head = clamp((progress - 0.68) / 0.22);
    if (head > 0 && head < 1) {
      tracePerimeter(context, rect, head - 0.07, 0.07, fade, colors[2], 3);
      tracePerimeter(context, rect, head - 0.022, 0.022, fade, '#ffffff', 1.3);
    }
  }
  context.shadowBlur = 0;
}

function documentStroke(context, rect, color) {
  const gradient = context.createLinearGradient(0, rect.y, 0, rect.y + rect.height);
  const expanded =
    color.length === 4
      ? `#${[...color.slice(1)].map((character) => character.repeat(2)).join('')}`
      : color;
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.72, color);
  gradient.addColorStop(1, `${expanded}00`);
  return gradient;
}

function traceDocument(context, rect, side, start, end, opacity, stroke, width) {
  if (end <= start) return;
  context.globalAlpha = opacity;
  context.strokeStyle = stroke;
  context.lineWidth = width;
  context.beginPath();
  const steps = Math.max(2, Math.ceil((end - start) * 140));
  for (let index = 0; index <= steps; index++) {
    const point = documentPoint(rect, mix(start, end, index / steps), side);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.stroke();
}

function drawDocumentBorder(context, rect, progress, colors, reducedMotion) {
  const head = reducedMotion ? 1 : smooth((progress - 0.5) / 0.44);
  const fade = (reducedMotion ? smooth(progress * 3) : 1) * (1 - smooth((progress - 0.86) / 0.14));
  if (head <= 0 || fade <= 0) return;
  const edge = documentStroke(context, rect, colors[0]);
  const glow = documentStroke(context, rect, colors[2]);
  const highlight = documentStroke(context, rect, '#ffffff');
  context.shadowColor = colors[2];
  context.shadowBlur = 10;
  for (const side of [-1, 1]) {
    traceDocument(context, rect, side, 0, head, fade * 0.24, edge, 0.85);
    if (!reducedMotion) {
      traceDocument(context, rect, side, Math.max(0, head - 0.22), head, fade * 0.7, glow, 2);
      traceDocument(context, rect, side, Math.max(0, head - 0.055), head, fade, highlight, 1);
    }
  }
  context.shadowBlur = 0;
}

function drawParticles(context, particles, progress, style, settings) {
  const document = particles[0]?.document;
  const fade = document
    ? 1 - smooth((progress - 0.88) / 0.12)
    : 1 - smooth((progress - 0.77) / 0.13);
  if (fade <= 0) return;
  const points = [];
  for (const particle of particles) {
    const point = particlePosition(particle, progress, style);
    points.push(point);
    const edgeFade =
      particle.document && progress >= particle.document.arrival
        ? 1 -
          smooth(
            ((point.y - particle.document.rect.y) / particle.document.rect.height - 0.72) / 0.28,
          )
        : 1;
    const opacity = fade * edgeFade * (0.6 + particle.size * 0.12);
    context.strokeStyle = particle.color;
    context.lineWidth = settings.width;
    context.globalAlpha = opacity * 0.55;
    context.beginPath();
    for (let index = 0; index <= 7; index++) {
      const tail = particlePosition(
        particle,
        Math.max(0, progress - settings.trail * (1 - index / 7)),
        style,
      );
      if (index === 0) context.moveTo(tail.x, tail.y);
      else context.lineTo(tail.x, tail.y);
    }
    context.stroke();
    context.globalAlpha = opacity;
    context.fillStyle = particle.color;
    context.beginPath();
    if (style === 'prism') {
      context.moveTo(point.x, point.y - particle.size * 1.6);
      context.lineTo(point.x + particle.size, point.y);
      context.lineTo(point.x, point.y + particle.size * 1.6);
      context.lineTo(point.x - particle.size, point.y);
      context.closePath();
    } else {
      context.arc(point.x, point.y, particle.size, 0, TAU);
    }
    context.fill();
    // Only a few anchor particles carry a halo; the fine fibres stay crisp.
    if (particle.size > 2) {
      context.globalAlpha = opacity * 0.12;
      context.beginPath();
      context.arc(point.x, point.y, particle.size * 3, 0, TAU);
      context.fill();
    }
  }
  if (style === 'constellation' && !(document && progress >= 0.5)) {
    context.globalAlpha = fade * Math.sin(clamp(progress / 0.8) * Math.PI) * 0.28;
    context.lineWidth = 0.65;
    for (let index = 0; index < points.length - 8; index += 4) {
      const first = points[index];
      const second = points[index + 8];
      if (Math.hypot(first.x - second.x, first.y - second.y) > 125) continue;
      context.beginPath();
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
      context.stroke();
    }
  }
}

/**
 * Shared eye → report bridge. Both rectangles use the host's local CSS pixels.
 * Callers own the eye/report DOM and reveal it in onReveal (at 1,380 ms).
 * `outline: 'document'` forms only the top and descending side edges; the
 * default 'frame' remains a closed outline for bounded comparison cards.
 * Aborting rejects with AbortError; resize/hidden-tab changes finish without waiting.
 */
export async function playReportTransition({
  host,
  fromRect,
  toRect,
  palette = {},
  signal,
  reducedMotion = false,
  outline = 'frame',
  onReveal = () => {},
}) {
  const abortError = () => new DOMException('Report transition cancelled', 'AbortError');
  if (signal?.aborted) throw abortError();
  if (!host?.append || !validRect(fromRect) || !validRect(toRect)) {
    throw new TypeError('A host and finite, positive local source/target rectangles are required.');
  }
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const bounds = host.getBoundingClientRect();
  const width = host.clientWidth || bounds.width;
  const height = host.clientHeight || bounds.height;
  if (doc.hidden || !width || !height) {
    onReveal();
    return;
  }
  const style = Object.hasOwn(STYLES, palette.style) ? palette.style : 'orbit';
  const settings = STYLES[style];
  const colors = [
    color(palette.primary, '#3f84ff'),
    color(palette.secondary, '#b7e5ff'),
    color(palette.glow, '#eaf8ff'),
  ];
  const canvas = doc.createElement('canvas');
  canvas.className = 'report-particle-transition';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '30',
  });
  const ratio = Math.min(win.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  let context;
  try {
    context = canvas.getContext('2d');
  } catch {
    // An unavailable graphics context must never prevent the report from appearing.
  }
  if (!context) {
    onReveal();
    return;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const target = {
    x: toRect.x + 1,
    y: toRect.y + 1,
    width: Math.max(1, toRect.width - 2),
    height: Math.max(1, toRect.height - 2),
  };
  const particles = reducedMotion
    ? []
    : createParticles(fromRect, target, style, settings, colors, outline);
  const duration = reducedMotion ? 160 : DURATION;
  host.append(canvas);

  return new Promise((resolve, reject) => {
    let frame = 0;
    let startedAt = null;
    let finished = false;
    let revealed = false;
    let resizeObserver;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      onReveal();
    };
    const finish = (error) => {
      if (finished) return;
      finished = true;
      win.cancelAnimationFrame(frame);
      signal?.removeEventListener('abort', abort);
      doc.removeEventListener('visibilitychange', visibility);
      win.removeEventListener('resize', resize);
      resizeObserver?.disconnect();
      canvas.remove();
      if (error) reject(error);
      else {
        try {
          reveal();
          resolve();
        } catch (callbackError) {
          reject(callbackError);
        }
      }
    };
    const abort = () => finish(abortError());
    const visibility = () => {
      if (doc.hidden) finish();
    };
    const resize = () => {
      const current = host.getBoundingClientRect();
      if (
        Math.abs((host.clientWidth || current.width) - width) > 1 ||
        Math.abs((host.clientHeight || current.height) - height) > 1
      ) {
        finish();
      }
    };
    const draw = (timestamp) => {
      if (finished) return;
      if (startedAt === null) startedAt = timestamp;
      const progress = clamp((timestamp - startedAt) / duration);
      try {
        if (progress >= (reducedMotion ? 0.3 : REVEAL_AT)) reveal();
        if (finished) return;
        context.clearRect(0, 0, width, height);
        if (!reducedMotion) drawParticles(context, particles, progress, style, settings);
        if (outline === 'document') {
          drawDocumentBorder(context, target, progress, colors, reducedMotion);
        } else {
          drawBorder(context, target, progress, colors, reducedMotion);
        }
        if (progress >= 1) finish();
        else frame = win.requestAnimationFrame(draw);
      } catch (error) {
        finish(error);
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    doc.addEventListener('visibilitychange', visibility);
    win.addEventListener('resize', resize);
    if (win.ResizeObserver) {
      resizeObserver = new win.ResizeObserver(resize);
      resizeObserver.observe(host);
    }
    if (signal?.aborted) abort();
    else frame = win.requestAnimationFrame(draw);
  });
}
