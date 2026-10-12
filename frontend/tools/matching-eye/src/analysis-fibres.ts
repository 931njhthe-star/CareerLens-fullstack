export type FibreGroup = 'resume' | 'role' | 'report';
export interface AnalysisFibre {
  id: number;
  group: FibreGroup;
  angle: number;
  innerRadius: number;
  length: number;
  onset: number;
  easing: number;
  bend: number;
  width: number;
  brightness: number;
}
const groups: FibreGroup[] = ['resume', 'role', 'report'];
const clamp = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
const random = (index: number, salt: number): number => {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(salt + 17, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

export const fibreCountForWidth = (width: number): number => (width < 700 ? 120 : 180);

/** Dispersed groups and seeded differences stay still while their tips grow. */
export function createAnalysisFibres(count = 180): AnalysisFibre[] {
  const size = Number.isFinite(count) ? Math.max(12, Math.min(240, Math.floor(count))) : 180;
  return Array.from({ length: size }, (_, index) => {
    const groupIndex = index % groups.length;
    return {
      id: index,
      group: groups[groupIndex],
      angle: -Math.PI / 2 + ((index + (random(index, 1) - 0.5) * 0.58) / size) * Math.PI * 2,
      innerRadius: 62,
      length: 84 + random(index, 2) * 28,
      onset: 0.015 + groupIndex * 0.065 + random(index, 3) * 0.24,
      easing: 0.7 + groupIndex * 0.34 + random(index, 4) * 0.9,
      bend: (random(index, 5) - 0.5) * 4.2,
      width: 0.43 + random(index, 6) * 0.29,
      brightness: 0.72 + random(index, 7) * 0.28,
    };
  });
}

/** All needles stay below their endpoint until the verified global value is 1. */
export function fibreGrowth(fibre: AnalysisFibre, progress: number): number {
  const value = clamp(progress);
  const local = Math.min(1, Math.max(0, (value - fibre.onset) / (1 - fibre.onset)));
  const eased = local ** fibre.easing;
  return Math.min(value < 1 ? 0.999999 : 1, eased * eased * (3 - 2 * eased));
}

/** Shared kernel for the GPU; SVG and callout gauges use fibreGrowth above. */
export const fibreGrowthGLSL = /* glsl */ `
  float fibreGrowth(float progress, float onset, float easing) {
    float value = clamp(progress, 0.0, 1.0);
    float local = clamp((value - onset) / (1.0 - onset), 0.0, 1.0);
    float eased = pow(local, easing);
    return min(value < 1.0 ? .999999 : 1.0, eased * eased * (3.0 - 2.0 * eased));
  }
`;

export function fibrePoint(fibre: AnalysisFibre, along: number): [number, number] {
  const value = clamp(along);
  const radius = fibre.innerRadius + fibre.length * value;
  const bend = fibre.bend * Math.sin(Math.PI * value);
  return [
    Math.cos(fibre.angle) * radius - Math.sin(fibre.angle) * bend,
    Math.sin(fibre.angle) * radius + Math.cos(fibre.angle) * bend,
  ];
}

export function fibreSegment(
  fibre: AnalysisFibre,
  progress: number,
): { start: [number, number]; tip: [number, number]; growth: number } {
  const growth = fibreGrowth(fibre, progress);
  return { start: fibrePoint(fibre, 0), tip: fibrePoint(fibre, growth), growth };
}

export function groupFibreProgress(
  fibres: AnalysisFibre[],
  progress: number,
  groupId: FibreGroup,
): number {
  const group = fibres.filter((fibre) => fibre.group === groupId);
  return group.length
    ? group.reduce((total, fibre) => total + fibreGrowth(fibre, progress), 0) / group.length
    : 0;
}
