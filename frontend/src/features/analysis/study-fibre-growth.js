// Each fibre grows in length from the fixed pupil boundary. No global opacity or water front.
export const STUDY_FIBRE_COUNT = 1152;
export const STUDY_FIBRE_STEPS = 24;
const TAU = Math.PI * 2;
const clamp = (value) => Math.max(0, Math.min(1, value));
const noise = (value) => {
  const sample = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return sample - Math.floor(sample);
};

export function createStudyFibres(seed = 7, inner = 60, outer = 194) {
  // Pick irregular starting sites, rather than eight equally spaced clock spokes.
  const pioneers = new Set(
    Array.from({ length: STUDY_FIBRE_COUNT }, (_, index) => ({
      index,
      priority: noise(index * 7.31 + seed * 19.7),
    }))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 8)
      .map(({ index }) => index),
  );
  return Array.from({ length: STUDY_FIBRE_COUNT }, (_, index) => {
    const rank = noise(index + seed * 23.7);
    const variation = noise(index * 3.13 + seed);
    const pioneer = pioneers.has(index);
    const angle = ((index + (rank - 0.5) * 0.9) / STUDY_FIBRE_COUNT) * TAU;
    const random = (salt) => noise(index * 11.37 + seed * 5.91 + salt * 37.17);
    // Independent control points: no repeated sinusoid, mirrored sector or return-to-root arc.
    const knots = [0, 0.18 + random(1) * 0.1, 0.46 + random(2) * 0.12, 0.76 + random(3) * 0.12, 1];
    const bends = [
      0,
      (random(4) - 0.5) * 0.16,
      (random(5) - 0.5) * 0.17,
      (random(6) - 0.5) * 0.12,
      (random(7) - 0.5) * 0.09,
    ];
    const points = [];
    for (let step = 0; step <= STUDY_FIBRE_STEPS; step++) {
      const amount = step / STUDY_FIBRE_STEPS;
      const radius = inner + (outer - inner) * amount;
      let segment = 0;
      while (segment < knots.length - 2 && amount > knots[segment + 1]) segment++;
      const u = (amount - knots[segment]) / (knots[segment + 1] - knots[segment]);
      const blend = u * u * (3 - 2 * u);
      const theta = angle + bends[segment] + (bends[segment + 1] - bends[segment]) * blend;
      points.push({ x: Math.cos(theta) * radius, y: Math.sin(theta) * radius });
    }
    return {
      index,
      pioneer,
      accent: random(8) < 0.025,
      width: 0.84 + random(9) * 0.32,
      start: pioneer ? 13.05 + variation * 0.12 : 13.75 + Math.pow(rank, 0.6) * 1.2,
      duration: pioneer ? 1.9 + rank * 0.7 : 1.8 + variation * 0.75,
      points,
    };
  });
}

export function studyFibreGrowth(fibre, time) {
  const t = clamp((time - fibre.start) / fibre.duration);
  return t * t * (3 - 2 * t);
}

export function studyFibreTip(fibre, amount) {
  const position = clamp(amount) * STUDY_FIBRE_STEPS;
  const index = Math.min(STUDY_FIBRE_STEPS - 1, Math.floor(position));
  const fraction = position - index;
  const first = fibre.points[index];
  const next = fibre.points[index + 1];
  return { x: first.x + (next.x - first.x) * fraction, y: first.y + (next.y - first.y) * fraction };
}
