import { demoScoreModel } from './demo-score-data.js';

/** Each real report criterion keeps its original weight alongside the chart value. */
export function normalizeRadarCriteria(criteria) {
  if (!Array.isArray(criteria)) return [];
  return criteria
    .filter((criterion) => criterion && typeof criterion === 'object')
    .map((criterion, index) => {
      const score =
        typeof criterion.score === 'number' && Number.isFinite(criterion.score)
          ? criterion.score
          : null;
      const maximum =
        typeof criterion.max_score === 'number' && Number.isFinite(criterion.max_score)
          ? criterion.max_score
          : null;
      const valid = score !== null && score >= 0 && maximum !== null && maximum > 0;
      return {
        index,
        label:
          typeof criterion.label === 'string' && criterion.label.trim()
            ? criterion.label.trim()
            : '이름 없는 평가 기준',
        detail: typeof criterion.detail === 'string' ? criterion.detail : '',
        score,
        maximum,
        normalized: valid ? Math.max(0, Math.min(100, (score / maximum) * 100)) : null,
      };
    });
}

export function radarPosition(index, count, value, radius = 72) {
  const angle = -Math.PI / 2 + (index / Math.max(1, count)) * Math.PI * 2;
  const distance = (radius * Math.max(0, Math.min(100, value))) / 100;
  return { x: 150 + Math.cos(angle) * distance, y: 117 + Math.sin(angle) * distance };
}

export function radarProgress(elapsed) {
  const clock = Math.max(0, Math.min(1, (elapsed - 0.12) / 1.55));
  return 1 - Math.pow(1 - clock, 3);
}

export function radarDescription(axis) {
  if (axis.normalized === null) return `${axis.label} · 점수 미산정`;
  return `${axis.label} · ${axis.score} / ${axis.maximum}점 · 100점 환산 ${Math.round(axis.normalized)}점`;
}

/** Compact display names only; the full criterion stays in descriptions and data. */
export function radarDisplayLabel(label) {
  const labels = new Map([
    ['공고 요구사항 연결', '요구사항 연결'],
    ['희망 직무 경험 연결', '직무 경험'],
    ['수행 맥락', '수행 맥락'],
    ['수치로 표현한 결과·규모', '결과·규모'],
  ]);
  return labels.get(label) ?? label;
}

/** Four independent values are presentation-only and never read the legacy aggregate. */
export function pyramidAxes(report) {
  return demoScoreModel(report).axes;
}

export function pyramidPreview(report) {
  return demoScoreModel(report).preview;
}
export function pyramidTransition(from, to, progress) {
  const t = Math.max(0, Math.min(1, progress));
  const blend = t * t * t * (t * (t * 6 - 15) + 10);
  return from.map((value, index) => value + (to[index] - value) * blend);
}
