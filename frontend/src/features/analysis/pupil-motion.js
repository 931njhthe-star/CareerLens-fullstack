import { drawWordmark, WORDMARK_REVEAL_MS } from './wordmark-motion.js';
import { WORDMARK_BOUNDS } from './wordmark-geometry.js';

const TAU = Math.PI * 2;
export const PUPIL_ENTRY_MS = 1100;
export const PUPIL_ROTATION_MS = 24000;
export const EYE_DRAW_MS = 1600;
export const EYE_DRAW_DELAY_MS = 180;
export const EYE_YAW_MS = 40000;
const CAMERA_DISTANCE = 2.5;
const clamp = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

/** Separate periods produce continuous deceleration and reversal, without angle resets. */
export function pupilMotionFrame(elapsed, { reduced = false } = {}) {
  const time = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  const moving = reduced ? 0 : Math.max(0, time - PUPIL_ENTRY_MS);
  const seconds = moving / 1000;
  const eyeYaw = reduced
    ? 0
    : (Math.max(0, time - EYE_DRAW_DELAY_MS - EYE_DRAW_MS) / EYE_YAW_MS) * TAU;
  const phase = eyeYaw % TAU;
  const logoTime = reduced ? 0 : Math.max(0, (phase - Math.PI / 2) * EYE_YAW_MS / TAU);
  return {
    scale: reduced ? 1 : smooth(time / PUPIL_ENTRY_MS),
    opacity: reduced ? 1 : smooth(time / 440),
    rotation: (moving / PUPIL_ROTATION_MS) * TAU,
    outline: reduced ? 1 : smooth((time - EYE_DRAW_DELAY_MS) / EYE_DRAW_MS),
    eyeYaw,
    face: Math.cos(eyeYaw) < 0 ? 'logo' : 'eye',
    // The back face is pre-turned by half a revolution, so its lettering is never mirrored.
    logoYaw: eyeYaw - Math.PI,
    logoReveal: clamp(logoTime / WORDMARK_REVEAL_MS),
    outer: seconds * 0.14,
    dashes: 1.8 * Math.sin((moving / 8200) * TAU),
    innerDashes: 1.55 * (Math.sin((moving / 11300) * TAU + 1.1) - Math.sin(1.1)),
    reactor: seconds * 0.038,
    pulse: reduced ? 0.65 : 0.5 + 0.5 * Math.sin(seconds * 1.7),
    lights: reduced ? 0 : (moving / 5400) * TAU,
  };
}

/** Upper lid starts at the left corner; lower lid starts at the right corner. */
export function eyeContourPoint(progress, upper = true) {
  const t = clamp(progress);
  const u = 1 - t;
  const points = upper
    ? [[-0.435, 0], [-0.185, -0.265], [0.16, -0.295], [0.435, 0]]
    : [[0.435, 0], [0.18, 0.255], [-0.19, 0.25], [-0.435, 0]];
  const weights = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
  return {
    x: points.reduce((sum, point, index) => sum + point[0] * weights[index], 0),
    y: points.reduce((sum, point, index) => sum + point[1] * weights[index], 0),
  };
}

function projectWithYaw({ x, y }, cosine, sine) {
  // Every eye mark occupies the same flat plane as the wordmark's reverse face.
  const turnedX = x * cosine;
  const turnedZ = -x * sine;
  const scale = CAMERA_DISTANCE / (CAMERA_DISTANCE - turnedZ);
  return { x: turnedX * scale, y: y * scale, z: turnedZ, scale };
}

/** Normalized coordinates turn toward the right around the vertical axis. */
export function projectEyePoint(point, yaw = 0) {
  return projectWithYaw(point, Math.cos(yaw), Math.sin(yaw));
}

function drawEyeContour(context, size, progress, project, visibility) {
  if (progress <= 0) return;
  // Sample only the visible length: each contour grows from its own eye corner.
  for (const upper of [true, false]) {
    const steps = Math.max(1, Math.ceil(progress * 80));
    context.beginPath();
    for (let step = 0; step <= steps; step++) {
      const t = (step / steps) * progress;
      const point = project(eyeContourPoint(t, upper));
      if (step === 0) context.moveTo(point.x * size, point.y * size);
      else context.lineTo(point.x * size, point.y * size);
    }
    context.strokeStyle = '#63abd9';
    context.lineWidth = 1.35;
    context.globalAlpha = 0.8 * visibility;
    context.shadowColor = '#8bdcff';
    context.shadowBlur = 5 * visibility;
    context.stroke();
    context.shadowBlur = 0;
    context.strokeStyle = '#beeaff';
    context.lineWidth = 0.55;
    context.globalAlpha = 0.7 * visibility;
    context.stroke();
  }
}

function drawTurnSeam(context, size, cosine, opacity) {
  const strength = 1 - smooth(Math.abs(cosine) / 0.16);
  if (!strength) return;
  // A single edge passes the light between faces. It cannot vanish at the handoff,
  // and does not stack the many iris strokes into a bright, thick vertical stripe.
  const logoMix = smooth((0.16 - cosine) / 0.32);
  const height = size * (0.40 + (WORDMARK_BOUNDS.height - 0.40) * logoMix);
  const gradient = context.createLinearGradient(0, -height / 2, 0, height / 2);
  gradient.addColorStop(0, 'rgba(90,188,245,0)');
  gradient.addColorStop(0.22, '#72cbf4');
  gradient.addColorStop(0.55, '#3591db');
  gradient.addColorStop(0.8, '#72cbf4');
  gradient.addColorStop(1, 'rgba(90,188,245,0)');
  context.globalAlpha = strength * opacity * 0.9;
  context.strokeStyle = gradient;
  context.shadowColor = '#78cdff';
  context.shadowBlur = 5;
  context.lineWidth = 1.1;
  context.beginPath();
  context.moveTo(0, -height / 2);
  context.lineTo(0, height / 2);
  context.stroke();
  context.shadowBlur = 0;
}

/** Both flat faces and their shared luminous edge are painted in a single frame. */
export function drawPupilFrame(context, size, frame) {
  context.clearRect(0, 0, size, size);
  if (frame.scale <= 0) return;
  const radius = 0.155 * frame.scale;
  const cosine = Math.cos(frame.eyeYaw);
  const sine = Math.sin(frame.eyeYaw);
  const visibility = smooth(Math.abs(cosine) / 0.16);
  context.save();
  context.translate(size / 2, size / 2);
  context.lineCap = 'round';
  drawTurnSeam(context, size, cosine, frame.opacity);
  if (cosine < 0) {
    drawWordmark(context, size, frame, (point) => projectWithYaw(point, -cosine, -sine), visibility);
    context.restore();
    return;
  }
  frame = { ...frame, opacity: frame.opacity * visibility };
  const project = (point) => projectWithYaw(point, cosine, sine);
  drawEyeContour(context, size, frame.outline, project, visibility);
  context.globalAlpha = frame.opacity;

  const pointAt = (r, angle) => project({
    x: Math.cos(angle) * radius * r,
    y: Math.sin(angle) * radius * r,
  });
  const ring = (r, start, end, rotation, color, width = 1, alpha = 1) => {
    context.globalAlpha = frame.opacity * alpha;
    context.strokeStyle = color;
    context.lineWidth = width * frame.scale;
    context.beginPath();
    const steps = Math.max(2, Math.ceil(((end - start) / TAU) * 96));
    for (let step = 0; step <= steps; step++) {
      const point = pointAt(r, start + ((end - start) * step) / steps + rotation);
      if (step === 0) context.moveTo(point.x * size, point.y * size);
      else context.lineTo(point.x * size, point.y * size);
    }
    context.stroke();
  };

  // A flat light field also narrows to the same central line at the side view.
  const lightField = (r, stops) => {
    context.save();
    context.transform(cosine, 0, 0, 1, 0, 0);
    const lightRadius = radius * r * size;
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, lightRadius);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    context.globalAlpha = frame.opacity;
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(0, 0, lightRadius, 0, TAU);
    context.fill();
    context.restore();
  };
  lightField(1.15, [
    [0, 'rgba(207,244,255,0.20)'],
    [0.46, 'rgba(213,237,255,0.16)'],
    [1, 'rgba(234,247,255,0)'],
  ]);

  const outerRotation = frame.rotation + frame.outer;
  ring(1, 0, TAU, outerRotation, '#86c9ef', 1, 0.62);
  ring(0.958, 0, TAU, outerRotation, '#4b89ce', 1.15, 0.82);
  ring(0.925, 0, TAU, outerRotation, '#addcff', 0.7, 0.65);
  for (let i = 0; i < 72; i++) {
    const angle = (i / 72) * TAU + outerRotation;
    const major = i % 6 === 0;
    const length = major ? 0.075 : 0.037;
    context.globalAlpha = frame.opacity * (major ? 0.73 : 0.27);
    context.strokeStyle = major ? '#397dd0' : '#69b8e8';
    context.lineWidth = (major ? 1.25 : 0.85) * frame.scale;
    context.beginPath();
    const start = pointAt(1.06, angle);
    const end = pointAt(1.06 + length, angle);
    context.moveTo(start.x * size, start.y * size);
    context.lineTo(end.x * size, end.y * size);
    context.stroke();
  }
  for (const start of [0.28, 2.1, 4.48]) {
    ring(1, start, start + 0.3, outerRotation, '#3679ce', 2, 0.9);
    ring(0.958, start + 0.11, start + 0.31, outerRotation, '#b4eeff', 2, 0.9);
  }

  const dashRotation = frame.rotation + frame.dashes;
  for (let i = 0; i < 18; i++) {
    const start = (i / 18) * TAU;
    ring(0.805, start, start + (i % 3 === 0 ? 0.12 : 0.225), dashRotation, '#3377c5', 1.45, 0.8);
  }
  ring(0.855, 0, TAU, dashRotation, '#a4d2ed', 0.65, 0.7);

  const innerRotation = frame.rotation + frame.innerDashes;
  for (let i = 0; i < 12; i++) {
    const start = (i / 12) * TAU;
    ring(0.688, start, start + (i % 3 === 1 ? 0.1 : 0.34), innerRotation, '#57aee0', 1.1, 0.8);
  }
  for (let i = 0; i < 64; i++) {
    const start = (i / 64) * TAU;
    ring(0.615, start, start + 0.013, innerRotation, '#397cc1', 1, 0.55);
  }

  const reactorRotation = frame.rotation + frame.reactor;
  ring(0.505, 0, TAU, reactorRotation, '#8bd2f1', 0.8, 0.45);
  for (let i = 0; i < 28; i++) {
    const start = (i / 28) * TAU;
    const light = (0.5 + 0.5 * Math.cos(start - frame.lights)) ** 3;
    context.shadowColor = '#65d6f3';
    context.shadowBlur = light * 9 * visibility;
    ring(0.456, start, start + 0.137, reactorRotation, '#44b9df', 4.5, 0.32 + 0.68 * light);
  }
  context.shadowBlur = 0;

  lightField(0.38, [
    [0, 'rgba(255,255,255,1)'],
    [0.36, 'rgba(215,251,255,0.8)'],
    [0.7, `rgba(101,216,244,${0.21 + frame.pulse * 0.14})`],
    [1, 'rgba(130,217,255,0)'],
  ]);
  // The center is only a fading light field, without a circular stroke or hard edge.
  context.restore();
}
