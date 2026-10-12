export const DEMO_SCORE_NOTICE = '시연용 점수 · 실제 평가와 무관';

const AXIS_DEFINITIONS = [
  {
    id: 'resume_completeness',
    label: '이력서 완성도',
    subcriteria: [
      { label: '경험 설명의 구체성', weight: 0.4 },
      { label: '성과 근거의 명확성', weight: 0.35 },
      { label: '구성과 가독성', weight: 0.25 },
    ],
  },
  {
    id: 'job_fit',
    label: '직무 적합도',
    subcriteria: [
      { label: '핵심 기술 일치도', weight: 0.45 },
      { label: '담당 업무 연관성', weight: 0.4 },
      { label: '우대 역량 부합도', weight: 0.15 },
    ],
  },
  {
    id: 'eligibility',
    label: '지원 자격 충족도',
    subcriteria: [
      { label: '관련 경력 충족도', weight: 0.6 },
      { label: '학력·전공 충족도', weight: 0.25 },
      { label: '기타 필수조건 충족도', weight: 0.15 },
    ],
  },
  {
    id: 'practical_competitiveness',
    label: '실무 경쟁력',
    subcriteria: [
      { label: '업무 규모·난도 경쟁력', weight: 0.35 },
      { label: '운영·문제 해결 경쟁력', weight: 0.35 },
      { label: '역할·책임 수준 경쟁력', weight: 0.3 },
    ],
  },
];

const models = new WeakMap();

/** Presentation values have an explicit input boundary; no resume or report scores are read. */
export function normalizeDemoScores(values) {
  return AXIS_DEFINITIONS.map((axis, index) => {
    const value = Array.isArray(values) ? values[index] : null;
    const valid = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
    return {
      ...axis,
      subcriteria: axis.subcriteria.map((criterion) => ({ ...criterion })),
      index,
      score: valid ? value : null,
      maximum: 100,
      normalized: valid ? value : null,
    };
  });
}

function randomUnit(random) {
  const value = random();
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1 - Number.EPSILON, value))
    : 0.5;
}

/** Injectable randomness keeps generation testable without deriving anything from a person's data. */
export function createDemoScoreModel(random = Math.random) {
  const values = AXIS_DEFINITIONS.map(() => 35 + Math.floor(randomUnit(random) * 56));
  const previewValues = values.map((value) =>
    Math.min(100, value + 4 + Math.floor(randomUnit(random) * 7)),
  );
  return {
    kind: 'presentation_demo',
    notice: DEMO_SCORE_NOTICE,
    axes: normalizeDemoScores(values),
    preview: {
      basis: 'presentation_demo',
      axes: normalizeDemoScores(previewValues),
      notice: '점수 변화와 색상 전환을 보여 주는 시연입니다. 실제 보완 효과를 예측하지 않습니다.',
    },
  };
}

/** One report object keeps the same demonstration through re-renders and preview toggles. */
export function demoScoreModel(report) {
  if (!report || typeof report !== 'object') return createDemoScoreModel();
  if (!models.has(report)) models.set(report, createDemoScoreModel());
  return models.get(report);
}
