import { WORDMARK_LETTERS } from './wordmark-geometry.js';

export const WORDMARK_REVEAL_MS = 3600;

const clamp = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const paths = WORDMARK_LETTERS.map(({ contours }) => contours.map((points) => {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return { points, distances, length: distances.at(-1) };
}));

function pointAt(path, amount) {
  const distance = clamp(amount) * path.length;
  let i = 1;
  while (i < path.distances.length - 1 && path.distances[i] < distance) i++;
  const t = (distance - path.distances[i - 1]) / (path.distances[i] - path.distances[i - 1] || 1);
  return {
    x: path.points[i - 1][0] + (path.points[i][0] - path.points[i - 1][0]) * t,
    y: path.points[i - 1][1] + (path.points[i][1] - path.points[i - 1][1]) * t,
  };
}

function trace(context, path, from, to, project, size) {
  if (to <= from) return;
  const first = project(pointAt(path, from));
  context.beginPath();
  context.moveTo(first.x * size, first.y * size);
  for (let i = 1; i < path.points.length; i++) {
    if (path.distances[i] <= from * path.length || path.distances[i] >= to * path.length) continue;
    const point = project({ x: path.points[i][0], y: path.points[i][1] });
    context.lineTo(point.x * size, point.y * size);
  }
  const last = project(pointAt(path, to));
  context.lineTo(last.x * size, last.y * size);
  context.stroke();
}

/** Progressively drawn outlines with an even, soft glow; no moving highlights. */
export function drawWordmark(context, size, frame, project, visibility) {
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  paths.forEach((contours, letter) => {
    const reveal = smooth((frame.logoReveal - letter * 0.045) / 0.58);
    if (!reveal) return;
    for (const path of contours) {
      context.globalAlpha = visibility * 0.86;
      context.lineWidth = 0.9;
      context.strokeStyle = '#3e83c9';
      context.shadowColor = '#62c5fb';
      context.shadowBlur = 4;
      trace(context, path, 0, reveal, project, size);
    }
  });
  context.restore();
}
