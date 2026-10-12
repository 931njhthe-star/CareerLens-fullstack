import { normalizeDemoScores } from './demo-score-data.js';
import {
  createStudyFibres,
  studyFibreGrowth,
  studyFibreTip,
  STUDY_FIBRE_STEPS,
} from './study-fibre-growth.js';

export const STUDY_DURATION = 22;
export const STUDY_STAGES = Object.freeze(
  [
    {
      id: 'light',
      label: '01 · 점등',
      title: '지원의 시작, 한 점의 빛',
      description: '제목 아래의 푸른 점이 은은하게 점등합니다.',
      time: 0,
    },
    {
      id: 'curve',
      label: '02 · 곡선',
      title: '빛이 길을 그립니다',
      description: '점이 오른쪽으로 이동하며 부드러운 곡선을 남깁니다.',
      time: 2.8,
    },
    {
      id: 'branches',
      label: '03 · 요소',
      title: '다섯 가지 가능성으로 갈라집니다',
      description: '평가 항목 중 다섯 요소가 곡선의 끝에서 나타납니다.',
      time: 5.5,
    },
    {
      id: 'formation',
      label: '04 · 원 형성',
      title: '요소가 돌며 원을 만듭니다',
      description: '각 요소가 최종 동공 자리를 공전하며 같은 궤적을 이어 그립니다.',
      time: 7.8,
    },
    {
      id: 'orbit',
      label: '05 · 회전 유지',
      title: '완성된 원이 계속 회전합니다',
      description: '이 위치와 크기를 그대로 유지한 채 모의지원 결과 확인을 기다립니다.',
      time: 10.4,
    },
    {
      id: 'acceleration',
      label: '06 · 제자리 가속',
      title: '자리와 크기는 그대로, 회전만 가속',
      description: '링이 제자리에서 가속하며, 위아래 눈 윤곽이 반대 방향으로 그려집니다.',
      time: 12.5,
    },
    {
      id: 'synchronization',
      label: '07 · 눈과 동기화',
      title: '회전하는 링이 눈 속으로 녹아듭니다',
      description: '동공의 반사광은 계속 회전하고, 가는 섬유가 안쪽에서 바깥쪽으로 자랍니다.',
      time: 14.5,
    },
    {
      id: 'analysis',
      label: '08 · 분석',
      title: '촘촘한 방사형 빛으로 분석합니다',
      description:
        '간결한 눈 안에서 홍채가 완성됩니다. 동공의 회전과 퍼센트는 시연용 진행을 나타냅니다.',
      time: 18,
    },
  ].map(Object.freeze),
);

const TAU = Math.PI * 2;
const WIDTH = 1200;
const HEIGHT = 620;
const CENTER_X = 600;
const CENTER_Y = 245;
const PUPIL_RADIUS = 60;
const IRIS_RADIUS = 194;
// Source-art measurements are calibrated once; neither the pupil nor artwork scales over time.
export const STUDY_ARTWORK = Object.freeze({
  src: '/public/motion-assets/sapphire-eye-v3.png',
  pupilX: 947,
  pupilY: 393,
  pupilRadius: 114,
});
const ART_SCALE = 2;
const ART_IRIS_RADIUS = IRIS_RADIUS;
const ART_IRIS_SIZE = ART_IRIS_RADIUS * 2;
let artworkState = 'pending';
let artworkPromise;
let artworkLayers;
let cachedFibres;
let cachedFibreSeed;

function createArtworkCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * ART_SCALE);
  canvas.height = Math.round(height * ART_SCALE);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The artwork requires a 2D canvas.');
  context.setTransform(ART_SCALE, 0, 0, ART_SCALE, 0, 0);
  return { canvas, context };
}

export function studyArtworkTransform(width, height) {
  const sourceScale = PUPIL_RADIUS / STUDY_ARTWORK.pupilRadius;
  return Object.freeze({
    x: CENTER_X - STUDY_ARTWORK.pupilX * sourceScale,
    y: CENTER_Y - STUDY_ARTWORK.pupilY * sourceScale,
    width: width * sourceScale,
    height: height * sourceScale,
    scale: sourceScale,
  });
}

function prepareArtwork(image) {
  const { x, y, width, height } = studyArtworkTransform(image.naturalWidth, image.naturalHeight);
  const source = createArtworkCanvas(ART_IRIS_SIZE, ART_IRIS_SIZE);
  const buffer = createArtworkCanvas(ART_IRIS_SIZE, ART_IRIS_SIZE);
  const irisMask = createArtworkCanvas(ART_IRIS_SIZE, ART_IRIS_SIZE);
  const ctx = source.context;
  ctx.save();
  ctx.translate(ART_IRIS_RADIUS - CENTER_X, ART_IRIS_RADIUS - CENTER_Y);
  traceEyeInterior(ctx, true);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(CENTER_X, CENTER_Y, IRIS_RADIUS, 0, TAU);
  ctx.arc(CENTER_X, CENTER_Y, PUPIL_RADIUS, TAU, 0, true);
  ctx.clip('evenodd');
  // Preserve the fine iris only. The old multilayer glass wings are no longer drawn.
  ctx.drawImage(image, x, y, width, height);
  ctx.restore();
  return { source, buffer, irisMask };
}

/** Shared readiness promise for the live canvas, still images, and deterministic PNG exports. */
export function loadStudyArtwork() {
  if (artworkPromise) return artworkPromise;
  artworkState = 'loading';
  artworkPromise = new Promise((resolve, reject) => {
    if (typeof Image !== 'function' || typeof document === 'undefined') {
      artworkState = 'error';
      reject(new Error('The eye artwork requires a browser image decoder.'));
      return;
    }
    const image = new Image();
    image.decoding = 'async';
    image.onload = async () => {
      try {
        await image.decode();
        artworkLayers = prepareArtwork(image);
        artworkState = 'ready';
        resolve(image);
      } catch (error) {
        artworkState = 'error';
        reject(error);
      }
    };
    image.onerror = () => {
      artworkState = 'error';
      reject(new Error('The sapphire eye artwork could not be loaded.'));
    };
    image.src = STUDY_ARTWORK.src;
  });
  return artworkPromise;
}
const TOPICS = Object.freeze(
  normalizeDemoScores([]).flatMap((axis) => axis.subcriteria.map((criterion) => criterion.label)),
);
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (value) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const progress = (time, start, end) => smooth((time - start) / (end - start));

export function studyGeometry(width = WIDTH, height = HEIGHT) {
  const scale = Math.min(Math.max(1, width) / WIDTH, Math.max(1, height) / HEIGHT);
  return Object.freeze({
    width: WIDTH,
    height: HEIGHT,
    centerX: CENTER_X,
    centerY: CENTER_Y,
    radius: PUPIL_RADIUS,
    irisRadius: IRIS_RADIUS,
    startX: 70,
    startY: 140,
    scale,
    offsetX: (width - WIDTH * scale) / 2,
    offsetY: (height - HEIGHT * scale) / 2,
  });
}

/** The integral is continuous through acceleration; the circle itself never scales or moves. */
export function studyRotation(time) {
  const t = Math.max(0, finite(time, 0));
  const ramp = 0.85;
  const gain = TAU * 3.5 - 0.62;
  const u = clamp((t - 12) / ramp);
  return t * 0.62 + gain * ramp * (u ** 3 - u ** 4 / 2) + gain * Math.max(0, t - 12 - ramp);
}

export function studyRingOpacity(time) {
  return progress(time, 6.85, 9.5) * (1 - progress(time, 13.35, 15.15));
}

/** Preview progress is illustrative; production progress must come from its analysis lifecycle. */
export function studyLoadingState(time) {
  const active = time >= 12 && time < STUDY_DURATION;
  const percent =
    time < 12
      ? null
      : Math.min(
          100,
          Math.floor(
            time < 18 ? 92 * progress(time, 12, 18) : 92 + 8 * progress(time, 18, STUDY_DURATION),
          ),
        );
  return {
    active,
    percent,
    reflection:
      progress(time, 6.85, 9.5) * (1 - progress(time, STUDY_DURATION - 0.35, STUDY_DURATION)),
    rotation: studyRotation(Math.min(time, STUDY_DURATION)),
  };
}

export function studyTopics(seed = 1) {
  let state = Math.floor(finite(seed, 1)) >>> 0 || 1;
  const indices = TOPICS.map((_, index) => index);
  for (let i = indices.length - 1; i > 0; i--) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, 5).map((index) => ({ index, label: TOPICS[index] }));
}

export function studyStageAt(time) {
  return [...STUDY_STAGES].reverse().find((stage) => time >= stage.time) || STUDY_STAGES[0];
}

function cubic(a, b, c, d, t) {
  const u = 1 - t;
  return {
    x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
  };
}

function strokePoints(ctx, points, color, width, opacity = 1) {
  if (!points.length || opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((point, index) =>
    index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y),
  );
  ctx.stroke();
  ctx.restore();
}

function luminousPoint(ctx, x, y, radius = 3, alpha = 1) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 7);
  gradient.addColorStop(0, '#c8ffff');
  gradient.addColorStop(0.08, '#b1fbff');
  gradient.addColorStop(0.2, '#397cffcc');
  gradient.addColorStop(0.46, '#306aff55');
  gradient.addColorStop(1, '#306aff00');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius * 7, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#eeffff';
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.5, 0, TAU);
  ctx.fill();
  ctx.restore();
}

const BRANCH_DESTINATIONS = [
  { x: 495, y: 115 },
  { x: 735, y: 112 },
  { x: 870, y: 225 },
  { x: 750, y: 367 },
  { x: 515, y: 377 },
];

export function studyNode(index, time, destinations = BRANCH_DESTINATIONS) {
  const endpoint = destinations[index % 5];
  const gathered = progress(time, 6.0, 9.2);
  const angleAtStart = studyRotation(6) + (index / 5) * TAU - Math.PI / 2;
  const distance = mix(
    Math.hypot(endpoint.x - CENTER_X, endpoint.y - CENTER_Y),
    PUPIL_RADIUS,
    gathered,
  );
  const originalAngle = Math.atan2(endpoint.y - CENTER_Y, endpoint.x - CENTER_X);
  const targetAngle =
    angleAtStart +
    Math.round((originalAngle - angleAtStart) / TAU) * TAU +
    studyRotation(time) -
    studyRotation(6);
  // Every element spirals inward before the completed circle exists. The circle is always radius60.
  const a = mix(originalAngle, targetAngle, gathered);
  return {
    x: CENTER_X + Math.cos(a) * distance,
    y: CENTER_Y + Math.sin(a) * distance,
    angle: a,
    radius: distance,
  };
}

function drawNodeIcon(ctx, index, x, y, opacity, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha *= opacity;
  ctx.strokeStyle = '#4d76d2';
  ctx.lineWidth = 1.15;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (index % 5 === 0) {
    ctx.rect(-7, -8, 14, 16);
    ctx.moveTo(-4, -3);
    ctx.lineTo(4, -3);
    ctx.moveTo(-4, 1);
    ctx.lineTo(4, 1);
    ctx.moveTo(-4, 5);
    ctx.lineTo(1, 5);
  } else if (index % 5 === 1) {
    ctx.moveTo(-8, 5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(1, 3);
    ctx.lineTo(8, -6);
    ctx.moveTo(3, -6);
    ctx.lineTo(8, -6);
    ctx.lineTo(8, -1);
  } else if (index % 5 === 2) {
    ctx.arc(0, 0, 8, 0, TAU);
    ctx.moveTo(-8, 0);
    ctx.lineTo(8, 0);
    ctx.moveTo(0, -8);
    ctx.bezierCurveTo(-6, -3, -6, 3, 0, 8);
    ctx.bezierCurveTo(6, 3, 6, -3, 0, -8);
  } else if (index % 5 === 3) {
    ctx.rect(-8, -6, 16, 13);
    ctx.moveTo(-4, -6);
    ctx.lineTo(-4, -9);
    ctx.lineTo(4, -9);
    ctx.lineTo(4, -6);
    ctx.moveTo(-8, -1);
    ctx.lineTo(8, -1);
  } else {
    ctx.moveTo(-7, 6);
    ctx.lineTo(-7, 1);
    ctx.moveTo(0, 6);
    ctx.lineTo(0, -3);
    ctx.moveTo(7, 6);
    ctx.lineTo(7, -8);
    ctx.moveTo(-10, 9);
    ctx.lineTo(10, 9);
  }
  ctx.stroke();
  ctx.restore();
}

function drawJourney(ctx, time, topics, start, journeyGeometry) {
  const curveProgress = progress(time, 1.1, 3.6);
  const branchProgress = progress(time, 3.6, 5.45);
  const fade = 1 - progress(time, 6.7, 9.0);
  const origin = start || { x: 70, y: 140 };
  const fork = journeyGeometry?.fork || { x: 300, y: 245 };
  const curveControls = journeyGeometry
    ? [
        { x: origin.x + (fork.x - origin.x) * 0.42, y: origin.y },
        { x: fork.x - (fork.x - origin.x) * 0.42, y: fork.y },
      ]
    : [
        { x: 166, y: 142 },
        { x: 169, y: 260 },
      ];
  if (fade <= 0) return;
  const curve = [];
  for (let i = 0; i <= 90; i++) {
    curve.push(cubic(origin, ...curveControls, fork, (i / 90) * curveProgress));
  }
  strokePoints(ctx, curve, '#376be9', 4.5, fade * 0.045);
  strokePoints(ctx, curve, '#597fed', 1.15, fade * 0.82);
  strokePoints(
    ctx,
    curve.map((p) => ({ x: p.x, y: p.y + 1.2 })),
    '#7be4ef',
    0.55,
    fade * 0.5,
  );
  const head = curve.at(-1) || origin;
  luminousPoint(ctx, head.x, head.y, 3.2 + Math.sin(time * 2.5) * 0.35, fade);
  if (branchProgress <= 0) return;
  for (let index = 0; index < 5; index++) {
    const node = studyNode(index, time, journeyGeometry?.destinations);
    const points = [];
    const branchAmount = clamp(branchProgress * 1.25 - index * 0.045);
    for (let i = 0; i <= 75; i++) {
      const t = (i / 75) * branchAmount;
      const spread = (index - 2) * 20;
      points.push(
        cubic(
          fork,
          journeyGeometry
            ? { x: fork.x + (node.x - fork.x) * 0.42, y: fork.y + spread }
            : { x: 385, y: 245 + spread },
          { x: node.x - 112, y: node.y + (index < 2 ? 28 : -27) },
          node,
          t,
        ),
      );
    }
    strokePoints(ctx, points, index % 2 ? '#51c8db' : '#6689eb', 1.2, fade * 0.8);
    strokePoints(
      ctx,
      points.map((p) => ({ x: p.x, y: p.y + 1.3 })),
      '#abcfff',
      0.55,
      fade * 0.55,
    );
    const tip = points.at(-1);
    luminousPoint(ctx, tip.x, tip.y, 1.9, fade * 0.9);
    const labelOpacity =
      progress(time, 4.7 + index * 0.06, 5.5 + index * 0.04) * (1 - progress(time, 6, 7.2));
    if (labelOpacity > 0) {
      const labelScale = journeyGeometry?.labelScale || 1;
      drawNodeIcon(
        ctx,
        topics[index].index,
        node.x + 2,
        node.y - 20 * labelScale,
        labelOpacity,
        labelScale,
      );
      ctx.save();
      ctx.globalAlpha = labelOpacity;
      ctx.fillStyle = '#435d90';
      ctx.font = `500 ${12 * labelScale}px Pretendard, "Noto Sans KR", sans-serif`;
      const label = topics[index].label;
      const labelWidth = ctx.measureText(label).width;
      const placeLeft =
        journeyGeometry && node.x + 19 * labelScale + labelWidth > journeyGeometry.labelRight;
      ctx.textAlign = placeLeft ? 'right' : 'left';
      ctx.fillText(label, node.x + (placeLeft ? -15 : 19) * labelScale, node.y - 16 * labelScale);
      ctx.restore();
    }
  }
}

function drawFormation(ctx, time, journeyGeometry) {
  const appear = progress(time, 6.0, 7.0);
  const finished = progress(time, 7.9, 8.85);
  if (appear <= 0 || finished >= 1) return;
  for (let index = 0; index < 5; index++) {
    const points = [];
    for (let j = 0; j <= 45; j++) {
      const sample = Math.max(6, time - 0.85 + (j / 45) * 0.85);
      points.push(studyNode(index, sample, journeyGeometry?.destinations));
    }
    strokePoints(
      ctx,
      points,
      index % 2 ? '#43cedf' : '#4172ee',
      1.4,
      appear * (1 - finished) * 0.75,
    );
    const point = studyNode(index, time, journeyGeometry?.destinations);
    luminousPoint(ctx, point.x, point.y, 2.5, appear * (1 - finished));
  }
}

function drawRing(ctx, time, loadingOverride, rotationOverride) {
  const opacity = studyRingOpacity(time);
  const loading = loadingOverride || studyLoadingState(time);
  if (opacity <= 0 && loading.reflection <= 0) return;
  const rotation = finite(rotationOverride, loading.rotation);
  const inner = PUPIL_RADIUS;
  const outer = inner + 8;
  ctx.save();
  ctx.globalAlpha *= opacity;

  // Constant annulus: only the reflections travel, never the aperture or band thickness.
  const body = ctx.createRadialGradient(CENTER_X, CENTER_Y, inner, CENTER_X, CENTER_Y, outer);
  for (const [stop, color] of [
    [0, '#224eaa'],
    [0.12, '#4f88ec'],
    [0.27, '#bedfff'],
    [0.4, '#386ecb'],
    [0.66, '#164699'],
    [0.84, '#6298e9'],
    [1, '#c7e4ff'],
  ]) {
    body.addColorStop(stop, color);
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(CENTER_X, CENTER_Y, outer, 0, TAU);
  ctx.arc(CENTER_X, CENTER_Y, inner, TAU, 0, true);
  ctx.fill();

  for (const [radius, width, color] of [
    [inner + 0.45, 0.8, '#d4edff'],
    [outer - 0.5, 0.8, '#5186d3'],
    [outer + 2.7, 0.7, '#95b6ec'],
    [outer + 5.2, 0.45, '#c9dcf6'],
  ]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(CENTER_X, CENTER_Y, radius, 0, TAU);
    ctx.stroke();
  }

  // Broad reflection trails stay legible at 3.5 revolutions per second without blinking.
  ctx.beginPath();
  ctx.arc(CENTER_X, CENTER_Y, outer, 0, TAU);
  ctx.arc(CENTER_X, CENTER_Y, inner, TAU, 0, true);
  ctx.clip();
  // The standalone body dissolves into the iris, but its moving reflection stays alive.
  ctx.globalAlpha = loading.reflection;
  const sheen = ctx.createConicGradient(rotation, CENTER_X, CENTER_Y);
  for (const [stop, color] of [
    [0, '#edfffff2'],
    [0.045, '#c3e8ffb8'],
    [0.15, '#90c9ff00'],
    [0.37, '#90c9ff00'],
    [0.48, '#cceeffb0'],
    [0.52, '#eeffffe8'],
    [0.56, '#a2d5ff00'],
    [0.8, '#90c9ff00'],
    [0.95, '#9bceff58'],
    [1, '#edfffff2'],
  ]) {
    sheen.addColorStop(stop, color);
  }
  ctx.fillStyle = sheen;
  ctx.fillRect(CENTER_X - outer, CENTER_Y - outer, outer * 2, outer * 2);
  ctx.restore();
}

// Unequal upper and lower lid curves preserve an anatomical arch and a small inner tear duct.
function eyeCurve(upper, t) {
  const left = { x: CENTER_X - 478, y: CENTER_Y + 9 };
  const right = { x: CENTER_X + 503, y: CENTER_Y + 7 };
  if (upper) {
    return t <= 0.5
      ? cubic(left, { x: 331, y: 246 }, { x: 362, y: 61 }, { x: 598, y: 62 }, t * 2)
      : cubic({ x: 598, y: 62 }, { x: 809, y: 61 }, { x: 846, y: 230 }, right, (t - 0.5) * 2);
  }
  return t <= 0.5
    ? cubic(left, { x: 320, y: 256 }, { x: 395, y: 446 }, { x: 606, y: 441 }, t * 2)
    : cubic({ x: 606, y: 441 }, { x: 803, y: 444 }, { x: 869, y: 263 }, right, (t - 0.5) * 2);
}

function innerEyeCurve(upper, t) {
  const point = eyeCurve(upper, t);
  return { x: point.x, y: point.y + Math.sin(Math.PI * t) * (upper ? 35 : -39) };
}

function simpleEyeCurve(upper, t) {
  const point = innerEyeCurve(upper, t);
  return { x: point.x, y: point.y + Math.sin(Math.PI * t) * (upper ? -12 : 12) };
}

function traceEyeInterior(ctx, sourceEdge = false) {
  ctx.beginPath();
  for (const upper of [true, false]) {
    for (let step = 0; step <= 100; step++) {
      const t = upper ? step / 100 : 1 - step / 100;
      const point = sourceEdge ? innerEyeCurve(upper, t) : simpleEyeCurve(upper, t);
      if (upper && step === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
  }
  ctx.closePath();
}

function prepareStudyFibres(seed) {
  if (cachedFibres && cachedFibreSeed === seed) return;
  cachedFibres = createStudyFibres(seed, PUPIL_RADIUS, IRIS_RADIUS);
  cachedFibreSeed = seed;
}

/** Restore the original opposing lid strokes at the start of ring acceleration. */
export function studyEyeReveal(time) {
  return [true, false].map((upper, index) => {
    const start = 12.04 + index * 0.09;
    const traceEnd = start + 0.9;
    return { upper, start, traceEnd, trace: progress(time, start, traceEnd) };
  });
}

function drawSimpleEye(ctx, time) {
  const legs = studyEyeReveal(time);
  if (legs.every((leg) => leg.trace <= 0)) return;
  ctx.save();
  // Quiet translucent side surfaces: no starbursts, nested ribbons or raster glass texture.
  const surface = progress(time, 13.05, 14.1);
  if (surface > 0) {
    ctx.save();
    traceEyeInterior(ctx);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(115, 75, 995, 352);
    ctx.moveTo(CENTER_X + IRIS_RADIUS - 1, CENTER_Y);
    ctx.arc(CENTER_X, CENTER_Y, IRIS_RADIUS - 1, 0, TAU, true);
    ctx.clip('evenodd');
    const wash = ctx.createLinearGradient(0, 85, 0, 414);
    wash.addColorStop(0, '#bfdaff42');
    wash.addColorStop(0.4, '#d5eaff0c');
    wash.addColorStop(0.6, '#d5eaff0c');
    wash.addColorStop(1, '#bfdcff42');
    ctx.globalAlpha = surface;
    ctx.fillStyle = wash;
    ctx.fillRect(115, 75, 995, 352);
    ctx.restore();
  }
  for (const leg of legs) {
    if (leg.trace <= 0) continue;
    const points = [];
    const highlight = [];
    for (let step = 0; step <= 140; step++) {
      const position = (step / 140) * leg.trace;
      const t = leg.upper ? position : 1 - position;
      const point = simpleEyeCurve(leg.upper, t);
      points.push(point);
      highlight.push({ x: point.x, y: point.y + Math.sin(Math.PI * t) * (leg.upper ? -5 : 5) });
    }
    const ink = ctx.createLinearGradient(122, 0, 1103, 0);
    ink.addColorStop(0, '#83b4ec50');
    ink.addColorStop(0.23, '#608fde');
    ink.addColorStop(0.5, '#3567be');
    ink.addColorStop(0.78, '#699ce3');
    ink.addColorStop(1, '#83b4ec45');
    strokePoints(ctx, points, '#a9d3fb', 4.5, 0.13);
    strokePoints(ctx, points, ink, 1.25);
    strokePoints(ctx, highlight, '#9ec9ed', 0.7, 0.5);
  }
  // One restrained iris arc accompanies the outline while the radial fibres arrive.
  const arc = progress(time, 12.16, 13.25);
  const arcOpacity = (1 - progress(time, 14.2, 16.1)) * 0.35;
  if (arc > 0 && arcOpacity > 0) {
    ctx.save();
    traceEyeInterior(ctx, true);
    ctx.clip();
    ctx.strokeStyle = '#7c9dca';
    ctx.lineWidth = 0.7;
    ctx.globalAlpha = arcOpacity;
    ctx.beginPath();
    ctx.arc(CENTER_X, CENTER_Y, IRIS_RADIUS, -Math.PI / 2, -Math.PI / 2 + TAU * arc);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawLoadingPercent(ctx, time, scale, loadingOverride) {
  const { percent } = loadingOverride || studyLoadingState(time);
  if (percent === null) return;
  ctx.save();
  ctx.fillStyle = '#234e93';
  ctx.font = `500 ${Math.min(40, Math.max(34, 12 / scale))}px Pretendard, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${percent}%`, CENTER_X, CENTER_Y + 1);
  ctx.restore();
}

function traceFibre(ctx, fibre, amount, offsetX, offsetY) {
  const last = Math.floor(amount * STUDY_FIBRE_STEPS);
  ctx.beginPath();
  ctx.moveTo(offsetX + fibre.points[0].x, offsetY + fibre.points[0].y);
  for (let index = 1; index <= last; index++) {
    ctx.lineTo(offsetX + fibre.points[index].x, offsetY + fibre.points[index].y);
  }
  const tip = studyFibreTip(fibre, amount);
  ctx.lineTo(offsetX + tip.x, offsetY + tip.y);
  ctx.stroke();
}

function drawArtworkIris(ctx, time, seed) {
  if (!artworkLayers || time <= 13.05) return;
  prepareStudyFibres(seed);
  const { source, buffer, irisMask } = artworkLayers;
  // Every independent fibre reveals its own length; the original fine iris stays intact.
  if (time < 17.6 || artworkLayers.completedSeed !== seed) {
    artworkLayers.completedSeed = null;
    const growthMask = irisMask.context;
    growthMask.clearRect(0, 0, ART_IRIS_SIZE, ART_IRIS_SIZE);
    growthMask.strokeStyle = '#fff';
    growthMask.lineCap = 'round';
    growthMask.lineJoin = 'round';
    for (const fibre of cachedFibres) {
      const amount = studyFibreGrowth(fibre, time);
      if (amount <= 0) continue;
      growthMask.lineWidth = fibre.width * (0.8 + amount * 1.8);
      traceFibre(growthMask, fibre, amount, ART_IRIS_RADIUS, ART_IRIS_RADIUS);
    }
    const layer = buffer.context;
    layer.save();
    layer.clearRect(0, 0, ART_IRIS_SIZE, ART_IRIS_SIZE);
    layer.drawImage(source.canvas, 0, 0, ART_IRIS_SIZE, ART_IRIS_SIZE);
    layer.globalCompositeOperation = 'destination-in';
    layer.drawImage(irisMask.canvas, 0, 0, ART_IRIS_SIZE, ART_IRIS_SIZE);
    layer.restore();
    if (time >= 17.6) artworkLayers.completedSeed = seed;
  }
  ctx.drawImage(
    buffer.canvas,
    CENTER_X - IRIS_RADIUS,
    CENTER_Y - IRIS_RADIUS,
    ART_IRIS_SIZE,
    ART_IRIS_SIZE,
  );

  if (time >= 17.6) return;
  ctx.save();
  traceEyeInterior(ctx, true);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(CENTER_X, CENTER_Y, IRIS_RADIUS, 0, TAU);
  ctx.arc(CENTER_X, CENTER_Y, PUPIL_RADIUS, TAU, 0, true);
  ctx.clip('evenodd');
  ctx.lineCap = 'round';
  for (const fibre of cachedFibres) {
    if (!fibre.pioneer && !fibre.accent) continue;
    const amount = studyFibreGrowth(fibre, time);
    if (amount <= 0 || amount >= 1) continue;
    ctx.lineWidth = fibre.width * (fibre.pioneer ? 0.6 : 0.35);
    ctx.strokeStyle = fibre.pioneer ? '#4c83d9' : '#86bde8';
    ctx.globalAlpha = (1 - amount) * 0.75;
    traceFibre(ctx, fibre, amount, CENTER_X, CENTER_Y);
  }
  ctx.restore();
}

function drawEyeArtwork(ctx, time, seed) {
  drawSimpleEye(ctx, time);
  drawArtworkIris(ctx, time, seed);
}

function drawGuides(ctx) {
  ctx.save();
  ctx.strokeStyle = '#9caece80';
  ctx.lineWidth = 0.7;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(CENTER_X - 25, CENTER_Y);
  ctx.lineTo(CENTER_X + 25, CENTER_Y);
  ctx.moveTo(CENTER_X, CENTER_Y - 25);
  ctx.lineTo(CENTER_X, CENTER_Y + 25);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(CENTER_X, CENTER_Y, PUPIL_RADIUS, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#6f82a2';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('고정 중심 (600, 245) · R 60', CENTER_X, CENTER_Y + 211);
  ctx.restore();
}

/** Deterministic scene for the live study and high-resolution storyboard exports. */
export function drawFixedAnchorFrame(
  ctx,
  width,
  height,
  { time = 0, seed = 7, guides = false, layout, origin, rotation, loading, journeyGeometry } = {},
) {
  const safeTime = Math.max(0, finite(time, 0));
  const geometry = layout
    ? { ...studyGeometry(width, height), ...layout }
    : studyGeometry(width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(geometry.offsetX, geometry.offsetY);
  ctx.scale(geometry.scale, geometry.scale);
  const topics = studyTopics(seed);
  drawJourney(ctx, safeTime, topics, origin, journeyGeometry);
  drawFormation(ctx, safeTime, journeyGeometry);
  drawEyeArtwork(ctx, safeTime, seed);
  drawRing(ctx, safeTime, loading, rotation);
  drawLoadingPercent(ctx, safeTime, geometry.scale, loading);
  if (guides) drawGuides(ctx);
  ctx.restore();
  return {
    time: Math.min(STUDY_DURATION, safeTime),
    elapsed: safeTime,
    seed,
    guides,
    stage: studyStageAt(safeTime),
    geometry,
    rotation: finite(rotation, studyRotation(safeTime)),
    ringOpacity: studyRingOpacity(safeTime),
    loading: loading || studyLoadingState(safeTime),
    topics,
    artworkReady: artworkState === 'ready',
    artworkState,
  };
}

export function mountFixedAnchorStudy(canvas, { onFrame } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The motion study requires a 2D canvas.');
  let elapsed = 0;
  let seed = 7;
  let guides = false;
  let playing = false;
  let disposed = false;
  let frame = 0;
  let lastTime = null;
  let size = { width: WIDTH, height: HEIGHT };
  let current = null;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let visible = true;

  function render() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    current = {
      ...drawFixedAnchorFrame(ctx, size.width, size.height, { time: elapsed, seed, guides }),
      playing,
    };
    canvas.dataset.centerX = String(current.geometry.centerX);
    canvas.dataset.centerY = String(current.geometry.centerY);
    canvas.dataset.pupilRadius = String(current.geometry.radius);
    canvas.dataset.stage = current.stage.id;
    canvas.dataset.time = current.time.toFixed(3);
    canvas.dataset.artworkReady = String(current.artworkReady);
    canvas.dataset.artworkState = current.artworkState;
    canvas.dataset.ringOpacity = current.ringOpacity.toFixed(4);
    canvas.dataset.loadingPercent =
      current.loading.percent === null ? '' : String(current.loading.percent);
    canvas.dataset.loadingActive = String(current.loading.active);
    canvas.dataset.reflectionOpacity = current.loading.reflection.toFixed(4);
    canvas.setAttribute(
      'aria-label',
      current.loading.percent === null
        ? '푸른 점에서 곡선과 요소, 회전하는 원으로 이어지는 모션'
        : `모의지원 분석 미리보기 ${current.loading.percent}%. 진행률은 시연용입니다.`,
    );
    onFrame?.(current);
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    size = { width: bounds.width || WIDTH, height: bounds.height || HEIGHT };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    render();
  }

  function shouldAnimate() {
    return playing && !disposed && !document.hidden && visible && !reduced.matches;
  }
  function tick(now) {
    frame = 0;
    if (!shouldAnimate()) {
      lastTime = null;
      return;
    }
    if (lastTime !== null) elapsed += Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    if (elapsed >= STUDY_DURATION) {
      elapsed = STUDY_DURATION;
      playing = false;
    }
    render();
    if (playing) frame = requestAnimationFrame(tick);
  }
  function schedule() {
    if (!frame && shouldAnimate()) frame = requestAnimationFrame(tick);
  }
  function visibilityChanged() {
    lastTime = null;
    if (!shouldAnimate() && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    schedule();
  }
  function pause() {
    playing = false;
    lastTime = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!disposed) render();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const intersection =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting !== false;
          visibilityChanged();
        })
      : null;
  intersection?.observe(canvas);
  document.addEventListener('visibilitychange', visibilityChanged);
  reduced.addEventListener('change', visibilityChanged);
  resize();
  loadStudyArtwork().then(
    () => {
      if (!disposed) render();
    },
    () => {
      if (!disposed) render();
    },
  );

  return {
    seek(seconds) {
      if (disposed) return;
      elapsed = clamp(finite(seconds, 0), 0, STUDY_DURATION);
      lastTime = null;
      render();
    },
    play() {
      if (disposed) return;
      if (elapsed >= STUDY_DURATION) elapsed = 0;
      playing = true;
      lastTime = null;
      if (reduced.matches) {
        elapsed = STUDY_DURATION;
        playing = false;
      }
      render();
      schedule();
    },
    pause,
    restart() {
      if (disposed) return;
      elapsed = 0;
      this.play();
    },
    setGuides(value) {
      if (disposed) return;
      guides = Boolean(value);
      render();
    },
    shuffle() {
      if (disposed) return;
      seed = (seed + 7919) >>> 0;
      render();
      return seed;
    },
    snapshot() {
      return { ...current, playing };
    },
    dispose() {
      if (disposed) return;
      pause();
      disposed = true;
      observer.disconnect();
      intersection?.disconnect();
      document.removeEventListener('visibilitychange', visibilityChanged);
      reduced.removeEventListener('change', visibilityChanged);
    },
  };
}
